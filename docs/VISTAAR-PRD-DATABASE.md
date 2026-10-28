# Vistaar 2.0 — Database PRD (schema level)

*As of 22 October 2026, latest `beta` (`5113b6c`). File: `docs/VISTAAR-PRD-DATABASE.md`. Developer-facing. Every field, type, default, enum, index and write pattern here is read from the code — the Mongoose schemas in `src/modules/*/schemas/`, the repositories that write them, and the raw-driver repositories for shared collections — and cross-checked against `docs/DATABASE.md` and `docs/PROD-CHECKLIST.md`. Where code and docs disagree, the code is shown and the difference is listed in section 10. Where the code and the production main database disagree (the read-only audit of 21 October 2026), each item is re-checked against this beta and listed in section 10A. Companion documents: `docs/VISTAAR-PRD-OVERALL-FLOW.md` (business flow) and `docs/VISTAAR-PRD-TECHNICAL.md` (APIs, rules, functions).*

---

## Contents

1. Database, ownership and conventions
2. Collection map
3. Id series and counters
4. Identity, onboarding, auth, settings
5. Person spine and farmer leads
6. Cart, draft orders, orders, products
7. Commission and payments
8. Content: stories, banners, events, FAQs, info pages, terms
9. Field operations, feedback, testimonials
9A. Earning cohorts, rules, assignments, rewards
10. Code vs docs: discrepancies
10A. Code vs production main DB (read-only audit, 21 October 2026)
11. Production index list

---

## 1. Database, ownership and conventions

### 1.1 The database

- One MongoDB database, **`CRM-Database`**, shared production data used by ko-sales, Stockship, prasar, franchise, B2B Sales, Sankalp and others.
- Vistaar 2.0 **owns** every `vistaar_v2_*` collection. The old Vistaar (KSS app + `CRM-Backend`) keeps `vistaaragents` / `vistaarfarmers`; this service only reads `vistaaragents` and never writes either.
- **Shared collections Vistaar writes** (each by a recorded decision): `piis`, `leads_v2`, `contacts_v2`, `addresses`, `app_counters` (rows `piis`, `leads`, `contacts`, `addresses`, `draft_orders`, `vistaar_orders`), `carts`, `draft_orders`, `terms_and_conditions`, `product_reviews`, `product_testimonials`. Every write carries Vistaar's marker (`source: 'vistaar'`, `entry_path: 'vistaar'` or `profiles: ['vistaar']`) and every update filters on it, so another app's rows are never changed. The exceptions carry their own key instead: `piis` is written by `pii_id` (a new person, or a `documents.<type>` slot that is empty or already Vistaar's), and `app_counters` by its row `_id` (`$inc` only).
- A partner is **never** written to `leads_v2`, `contacts_v2`, `customers`, `addresses` or `agents_v2`. Nothing in the code writes `userroles` or `lead_sources` (both are production setup steps for other teams — section 10A).
- **Shared collections Vistaar only reads:** `orders_v2`, `products_v2`, `bulk_v2`, `categories_v2`, `combos_v2`, `agents_v2`, `pincode_map_v2`, `franchises`, `prasar_v2_retailers`, `vistaaragents`, and — for KKD & App activity (merged 2026-10-21) — `franchise_v2_walkins`, `franchise_v2_prescriptions`, `franchise_v2_pos_orders` (franchise backend), `kkd_events` (Katyayani app), `franchise_v2_franchises` and `employees` (only `email` + `franchiseId`). The KKD & App activity module owns no collection and writes nothing.
- The partner's own orders in `orders_v2` are found by **`marketplace: 'MKTP-5'`** plus the partner's `VST-` id in `agent` (`VISTAAR_MARKETPLACE`, `orders.domain.ts`). Stockship rewrites `source` / `sub_source` from its `marketplaces_v2` row on create, so `source` never reads `vistaar` on an order.

### 1.2 Schema conventions (owned collections)

Unless a collection says otherwise:

- `@Schema({ collection: 'vistaar_v2_…' })` — the name is always explicit, never Mongoose pluralisation.
- `timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }`. Exceptions: `updatedAt: false` on `vistaar_v2_event_registrations`, `vistaar_v2_earning_assignments` and `vistaar_v2_order_ids` (rows never edited); no `timestamps` option on `vistaar_v2_otp_attempts`, `vistaar_v2_sessions`, `vistaar_v2_counters`, `vistaar_v2_settings` and `vistaar_v2_payment_option_audit` (dates set by the repository or declared as fields).
- `versionKey: false` (no `__v`); concurrency uses an explicit `version` field or a conditional filter instead.
- `_id` declared as `String` (UUID, a derived key, or a series id). Exception: `vistaar_v2_feedback` uses an auto ObjectId.
- `strict` not set (Mongoose default `true`). `minimize: false` on `vistaar_v2_onboarding_data`, `vistaar_v2_leads`, `vistaar_v2_testimonials`, `vistaar_v2_earning_cohorts`, `vistaar_v2_earning_rules` and `vistaar_v2_rewards` (empty objects are kept).
- Free-form sub-documents are `Mixed` typed by a TypeScript interface (no Mongoose validation inside them); validation lives in the DTO and domain layers.
- Every read is `.lean()`.
- `created_by` / `updated_by` hold `'self'` (the partner), a `VST-` id, an HO email, or `'system'`.

### 1.3 How indexes are built

`src/database/index-sync.service.ts` — `IndexSyncService.onApplicationBootstrap`:
- Does nothing when `NODE_ENV === 'production'`; production indexes are created by hand from section 11.
- Covers only models whose collection starts with `vistaar_v2_`; shared collections are never indexed from this service (and no shared schema declares an index).
- Per collection, first `model.diffIndexes()`: when nothing is missing, no build is queued at all. Otherwise `model.createIndexes({ maxTimeMS: 15000, comment: 'vistaar-index-sync:<collection>' })` — **never** `syncIndexes()` (that would drop undeclared indexes on the shared database).
- All collections in parallel; each step races a 15,000 ms timer. On a failure or timeout the service kills its own queued build (`currentOp` with `$ownOps: true` filtered on that comment, then `killOp` — best effort, never another app's operation), logs `Index build failed for <coll>` and boot continues.
- Why: on the shared beta host another app's wedged build left Vistaar's builds queued behind it on every restart (969 by 2026-10-16, per the code comment). `PROD-CHECKLIST.md` records that none of the indexes existed on beta on 2026-10-09 (host out of disk). The code stays correct without them.

---

## 2. Collection map

### 2.1 Owned (`vistaar_v2_*`)

| Collection | Module | `_id` | Lifecycle |
|---|---|---|---|
| `vistaar_v2_agents` | agents | UUID (token `sub`) | Never deleted |
| `vistaar_v2_onboarding_data` | onboarding | UUID | No delete |
| `vistaar_v2_onboarding_configs` | onboarding | `<cohort>@<version>` | Draft deletable; published immutable, later archived |
| `vistaar_v2_cohorts` | onboarding | cohort key | Delete only when unused |
| `vistaar_v2_sessions` | auth | SHA-256 of the refresh token | TTL on `expires_at`; deleted on refresh / logout |
| `vistaar_v2_otp_attempts` | auth | `send:<phone>` / `verify:<phone>` (sign-in); `lead-send:<phone>` / `lead-verify:<phone>` (farmer OTP on lead add) | TTL on `expires_at` |
| `vistaar_v2_counters` | counters | series key (`agent_id`, `product_suggestion`, `withdrawal_id`, `gig_id`) | Never deleted |
| `vistaar_v2_settings` | settings | `'vistaar'` (one row) | Single row, upserted |
| `vistaar_v2_leads` | leads | UUID | Deletable for a non-customer added by mistake |
| `vistaar_v2_order_ids` | orders | `<agent_id>:<request_id>` | Never deleted (a `KSV-` number given out is never given again) |
| `vistaar_v2_commission_plans` | commission | `<cohort>@<YYYY-MM>` | Past months locked; current / future deletable |
| `vistaar_v2_withdrawals` | commission | `WD-n` | Never deleted |
| `vistaar_v2_tds_certificates` | commission | `<agent_id>:<quarter>` | HO deletes with its file |
| `vistaar_v2_payment_options` | payments | provider | Never deleted |
| `vistaar_v2_payment_option_audit` | payments | UUID | Insert-only |
| `vistaar_v2_payment_credentials` | payments | UUID | Never deleted; secrets nulled on retire. Never written for Cashfree (keyless since 2026-10-21: submit refused `400 CREDENTIALS_NOT_USED`) |
| `vistaar_v2_stories` | stories | UUID | Partner deletes; beyond 20 evicted with files |
| `vistaar_v2_story_stats` | stories | `<agent_id>:<date>` | Never deleted |
| `vistaar_v2_story_templates` | stories | card key | Custom cards deletable; built-ins hide only |
| `vistaar_v2_story_designs` | stories | UUID | HO deletes |
| `vistaar_v2_story_festivals` | stories | UUID | HO deletes |
| `vistaar_v2_story_samples` | stories | UUID | HO deletes |
| `vistaar_v2_banners` | banners | UUID | HO deletes |
| `vistaar_v2_events` | events | UUID | HO deletes (with its registrations) |
| `vistaar_v2_event_registrations` | events | `<event_id>:<agent_id>` | Deleted on un-register or with the event |
| `vistaar_v2_faq_sections` | faqs | section key | Delete only when empty |
| `vistaar_v2_faqs` | faqs | UUID | HO deletes |
| `vistaar_v2_info_pages` | info-pages | page key (enum) | HO can delete (app falls back to built-in text) |
| `vistaar_v2_meetings` | meetings | app UUID | Never deleted (cancel instead) |
| `vistaar_v2_gigs` | gigs | `GIG-n` | Deleted only while open and never taken |
| `vistaar_v2_attendance` | attendance | `<agent_id>:<YYYY-MM-DD>` | Never deleted |
| `vistaar_v2_feedback` | feedback | ObjectId | Never deleted |
| `vistaar_v2_product_suggestions` | feedback | `SUG-n` | Never deleted |
| `vistaar_v2_testimonials` | testimonials | app UUID | Never deleted (ends at `removed`) |
| `vistaar_v2_testimonial_consents` | testimonials | = testimonial id | Never deleted (DPDP proof) |
| `vistaar_v2_earning_cohorts` | earning | `ec_<key>` (built-in `ec_default`) | Archived, never deleted |
| `vistaar_v2_earning_rules` | earning | UUID | Archived, never deleted (rewards name the rule) |
| `vistaar_v2_earning_assignments` | earning | UUID | One open stretch per partner; closed, never edited or deleted |
| `vistaar_v2_rewards` | rewards | `<trigger>:<the event's once-only key parts>:<kind>` (e.g. `lead_created:<pii_id>:coin`, `follow_up_done:<pii_id>:<IST due day>:gig`, `reorder:<order_id>:coin`, `event_registered:<event_id>:<agent_id>:coin`, `attendance_streak:<agent_id>:<day>:coin`) | Never deleted (pending → approved / rejected) |
| `vistaar_v2_crop_calendar` | — (retired 2026-10-14) | — | No code reads it; beta rows remain; drop when ready |

Not a collection of its own: KKD & App activity (module `kkd-activity`) reads only — `vistaar_v2_leads` (the partner's held farmers and the start of each hold) and `vistaar_v2_agents` (the partner's signup point or pincode), plus the shared reads in 2.3.

### 2.2 Shared — written by Vistaar

| Collection | Owner | Vistaar marker / filter | What Vistaar writes |
|---|---|---|---|
| `piis` | ko-sales spine | — (by `pii_id`) | New person at first OTP verify; `documents.<type>` on KYC verify / reject, and `documents.bank_details` when HO approves a bank-account change (only a slot that is empty or already `source: 'vistaar'`); `addresses[]` add |
| `leads_v2` | ko-sales | `source: 'vistaar'` | New farmer leads only; updates filter `lead_id` + `source`; the partner's follow-up is mirrored to `follow_up_date` on Vistaar's own rows (decision 2026-10-16) |
| `contacts_v2` | ko-sales | `source: 'vistaar'` | New farmer contacts only |
| `addresses` | ko-sales | `source: 'vistaar'` | One Vistaar address row per farmer (+ `geo`) |
| `app_counters` | shared | row `_id` | `$inc` on `piis`, `leads`, `contacts`, `addresses`, `draft_orders`, `vistaar_orders` (`KSV-n`, row created once by hand); never upserted except `piis` (section 10, item 2) |
| `carts` | B2B Sales | `_id` + `source: 'vistaar'` | One active cart per partner (derived `_id`) |
| `draft_orders` | B2B order portal, Sankalp | `entry_path: 'vistaar'` + `agent_id` + `status` | Saved carts as drafts (`DFT-n`) |
| `terms_and_conditions` | Krishi Sampark, B2B Portal, RLM | `profiles: 'vistaar'` | Vistaar's T&C rows (`TOC-n`) |
| `product_reviews` | Stockship v3 | `_id` + `source: 'vistaar'` | On HO testimonial approval only |
| `product_testimonials` | Stockship v3 | `_id` + `source: 'vistaar'` | On HO approval (video / photo) and HO-filed rows |

### 2.3 Shared — read only

| Collection | Owner | Read for |
|---|---|---|
| `orders_v2` | Stockship | Partner orders (`marketplace: 'MKTP-5'` + `agent`), customers' business, commission, performance; the old Vistaar's `KSV-` numbers, once per process at boot (`order_id` regex — a full scan, no `order_id` index); **KKD & App activity:** the held farmers' own orders, `pii_id $in` + `marketplace $in ['MKTP-2', 'MKTP-3', 'MKTP-4']` + `date ≥` the earliest hold (MKTP-4 kept only when tied to a store and not `sub_source: 'founder_office'`) |
| `products_v2` | Stockship | Order line names, images, sizes; catalogue facts (hourly) — also the KKD activity line labels |
| `bulk_v2` | Stockship | GST rate, category, trade name |
| `categories_v2` | Stockship | Category names |
| `combos_v2` | Stockship | Combo family check and combo name on testimonials |
| `agents_v2` | ko-sales | HO role and capabilities, owner names, the owner's phone (`contact.phone_number`) for the app's reporting officer, Offline Head lookup |
| `pincode_map_v2` | ko-sales | Pincode → state / district / centre (also the KKD stores' centre when the partner has no signup point) |
| `franchises` | franchise | KKD stores (radar), nearby-network warning, KKD & App activity store list (address, contact, email, map point, `warehouse.warehouseId`) |
| `franchise_v2_franchises` | franchise HO portal | KKD & App activity: newer stores (`franchise_id`, address, city, state, pincode, phone, email) |
| `employees` | Stockship (POS logins) | KKD & App activity: `email` + `franchiseId` only, of rows with both set — ties an MKTP-4 order's `created_by` to its store |
| `franchise_v2_walkins` | franchise backend | KKD & App activity: walk-ins, by `pii_id $in` or `phone $in`, from the earliest hold |
| `franchise_v2_prescriptions` | franchise backend | KKD & App activity: crop advice, same match |
| `franchise_v2_pos_orders` | franchise backend | KKD & App activity: the old POS archive, same match (rows with `in_stockship` true are dropped in memory — that order is shown from `orders_v2`) |
| `kkd_events` | Katyayani app | KKD & App activity: `APP_LAUNCH` and `Cart Abandoned`, by `user_id $in` (the farmer's 10-digit mobile), from the earliest hold |
| `prasar_v2_retailers` | prasar | Nearby-network warning |
| `vistaaragents` | old Vistaar | Nearby-network warning (coordinates stored swapped `[lat, lng]`, matched with a box) |

---

## 3. Id series and counters

| Id | Format | Source | Operation |
|---|---|---|---|
| Partner | `VST-000001` | `vistaar_v2_counters._id: 'agent_id'` | `findOneAndUpdate({_id}, {$inc: {seq: 1}, $set: {updated_at}}, {upsert: true, returnDocument: 'after'})` |
| Product suggestion | `SUG-000001` | `vistaar_v2_counters._id: 'product_suggestion'` | same |
| Withdrawal | `WD-000001` | `vistaar_v2_counters._id: 'withdrawal_id'` | same |
| Gig | `GIG-000001` | `vistaar_v2_counters._id: 'gig_id'` | same |
| Person | `PII-n` | `app_counters._id: 'piis'` | `PiiRepository.nextPiiNumber`: `findOneAndUpdate({_id: 'piis'}, {$inc: {count: 1}, $set: {updated_at}}, {upsert: true, returnDocument: 'after'})` (the only `app_counters` call with `upsert: true`); retry with the next number on collision |
| Org lead | `L-(100000+n)` | `app_counters._id: 'leads'` | `OrgCounterRepository.next`: the same `$inc {count: 1}` + `updated_at`, **never upserted** (a missing row throws); retry with the next number on collision |
| Org contact | `C0-n` | `app_counters._id: 'contacts'` | same as Org lead |
| Address | `ADDR-n` | `app_counters._id: 'addresses'` | same as Org lead |
| Vistaar order number | `KSV-n` (from `KSV-1`; no zero padding) | `app_counters._id: 'vistaar_orders'` (row created once by hand, `count: 0`) | `OrgCounterRepository.tryNext`: `findOneAndUpdate({_id: 'vistaar_orders'}, {$inc: {count: 1}, $set: {updated_at}}, {returnDocument: 'after'})`, never upserted; missing row → `null` → API 503 `ORDER_ID_UNAVAILABLE`. A number already on an old `KSV-` order in `orders_v2` (read once per process at boot) is skipped with another `$inc`, up to 100 per call. The number issued is kept in `vistaar_v2_order_ids` under `<agent_id>:<request_id>` |
| Draft order | `DFT-n` | `app_counters._id: 'draft_orders'` | same `$inc` the B2B portal and Sankalp make; missing row → API 503 `DRAFT_ID_UNAVAILABLE` |
| Terms | `TOC-n` | Highest `TOC-n` across every app's rows + 1 | Insert; on E11000 (unique `{toc_id}`) retry, up to 5 tries → 503 `TERMS_ID_UNAVAILABLE` |
| Derived keys | `<cohort>@<version>`, `<cohort>@<YYYY-MM>`, `<agent_id>:<date>`, `<event_id>:<agent_id>`, `<agent_id>:<quarter>`, `<agent_id>:<request_id>` (order-number attempt) | Built in code | — |
| Earning cohort | `ec_<key>` (`/^ec_[a-z0-9_]{1,40}$/`), built-in `ec_default` | Key given by HO, else a slug of the name (`_2`, `_3` … when taken) | Never changes |
| Earning-cohort plan | `ec_<id>@<YYYY-MM>` | Derived | Stored in `vistaar_v2_commission_plans` |
| Reward | `<trigger>:<the event's once-only key>:<kind>` — `lead_created:<pii_id>:<kind>`, `follow_up_done:<pii_id>:<YYYY-MM-DD IST due day>:<kind>`, `lead_stage_advanced:<pii_id>:<to_stage>:<kind>`, `reorder:<order_id>:<kind>`, `meeting_attendee_captured:<meeting_id>:<pii_id>:<kind>`, `gig_approved:<gig_id>:<kind>`, `event_registered:<event_id>:<agent_id>:<kind>`, `attendance_streak:<agent_id>:<YYYY-MM-DD>:<kind>`, `onboarding_approved:<agent_id>:<kind>`, `story_created:<story_id>:<kind>` | Derived (`rewardIdOf(trigger, kind, …parts)`) | One per event and kind; a duplicate insert is skipped |
| OTP attempt rows | `send:<phone>`, `verify:<phone>` (sign-in); `lead-send:<phone>`, `lead-verify:<phone>` (farmer) | Derived | — |
| Client ids | UUID | The app (meetings, testimonials, stories' first save; the order-number `request_id`) | Retry-safe: a duplicate key answers the first row |

`vistaar_v2_counters` is not `app_counters` (ko-sales') and not the legacy `sequences` (whose `vagent` belongs to the old Vistaar). The `app_counters` rows Vistaar `$inc`s are `piis`, `leads`, `contacts`, `addresses`, `draft_orders` and `vistaar_orders`; only `piis` is upserted, the rest must already exist.

---

## 4. Identity, onboarding, auth, settings

### `vistaar_v2_agents`  (`src/modules/agents/schemas/agent.schema.ts`; `Agent`)

- Owner module: `agents`. Written by: `AgentRepository` (auth OTP send/verify, onboarding preview/place, HO pipeline transitions, owner, monthly target, the partner's Edit Profile `PATCH /me` via `editProfile`, HO verification calls via `addVerificationCall`, HO name-change decisions via `decideNameChange`, the profile's bank-account copy on an approved bank change via `editProfile`, earning module via `setEarningCohorts`). Read by: agents, auth, onboarding (`GET /me`: timeline, pending name, reporting officer), earning, HO lists/summary/detail.
- Schema options: `collection: 'vistaar_v2_agents'` (const `AGENTS_COLLECTION`), `timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }`, `versionKey: false`, strict default (true), minimize default (true), `_id: String`.
- `_id`: String, `randomUUID()` set by `$setOnInsert` in `upsertForOtp`; it is the partner token's `sub`.

| Field | Type | Required | Default | Enum / validation | Notes |
|---|---|---|---|---|---|
| `_id` | String | – | – | – | UUID |
| `agent_id` | String | no | `null` | – | `VST-000001` (6-digit pad), set at OTP verify |
| `pii_id` | String | no | `null` | – | `piis` link, set at OTP verify |
| `phone` | String | yes | – | – | ten digits, as `piis.phone_number` |
| `country_code` | String | yes | `'+91'` | – | |
| `user_role` | String | no | `'USR-1040'` (`PARTNER_ROLE_CODE`) | – | |
| `otp_verified` | Boolean | no | `false` | – | |
| `otp_verified_at` | Date | no | `null` | – | |
| `last_login_at` | Date | no | `null` | – | |
| `stage` | String | no | `'signed_up'` | `STAGES`: signed_up, onboarding, kyc_review, changes_requested, approved, rejected, blocked | |
| `stage_history` | [Mixed] | no | `[]` | – | `StageHistoryEntry` |
| `blocked_from` | String | no | `null` | (typed `Stage`, no enum on schema) | stage a block interrupted |
| `onboarding_id` | String | no | `null` | – | `vistaar_v2_onboarding_data._id` |
| `cohort` | String | no | `null` | – | |
| `preview` | Mixed | no | `{}` | – | `AgentPreview` |
| `owner_agent_id` | String | no | `null` | – | `agents_v2.agent_id` of HO owner |
| `is_approved` | Boolean | no | `false` | – | |
| `decided_by` | String | no | `null` | – | |
| `decided_at` | Date | no | `null` | – | |
| `rejection_reason` | String | no | `null` | – | |
| `profile` | Mixed | no | `null` | – | `AgentProfile`, mapped at approval |
| `location` | Mixed | no | `undefined` | – | `GeoPoint` `{type:'Point', coordinates:[lng,lat]}` |
| `earning_cohort` | Mixed | no | `undefined` | – | `EarningCohortRef \| null`; earning module only |
| `verification_calls` | [Mixed] | no | `[]` | (outcome typed `CallOutcome`, no enum on schema) | `VerificationCall[]`; HO calls before a decision; absent on partners created before calls were logged (HO detail answers `[]` then) |
| `pending_name` | Mixed | no | `null` | – | `PendingName \| null`; a name the partner asked for, waiting for HO |
| `name_change` | Mixed | no | `null` | – | `NameChangeResult \| null`; HO's last decision on a name change |
| `monthly_target` | Number | no | `null` | – | ₹; `null` = settings default |
| `is_active` | Boolean | no | `true` | – | |
| `created_by` | String | no | `'self'` | – | |
| `updated_by` | String | no | `'self'` | – | |
| `created_at` / `updated_at` | Date | auto | – | – | timestamps |

`vistaar_v2_agents.stage_history[]` (`StageHistoryEntry`, Mixed — not schema-enforced)

| Field | Type | Required | Notes |
|---|---|---|---|
| `from` | Stage \| null | yes (TS) | `null` on OTP verify entry |
| `to` | Stage | yes (TS) | |
| `by` | string | yes (TS) | `'self'` or HO id |
| `at` | Date | yes (TS) | |
| `reason` | string | optional | e.g. `'otp_verified'` |

`vistaar_v2_agents.preview` (`AgentPreview`, Mixed): `name?`, `district?`, `state?`, `pincode?` — all string, optional. Refreshed on every onboarding save; after approval the Edit Profile mirrors `district` / `state` / `pincode` into it, and an approved name change sets `preview.name`.

`vistaar_v2_agents.profile` (`AgentProfile`, Mixed): `name?`, `email?`, `sub_cohort?`, `address_line?`, `village?`, `district?`, `state?`, `pincode?`, `photo?` (string, optional), `details?` (`Record<string, unknown>`). Keys come from form `maps_to` (closed list `MAPS_TO`: name, email, sub_cohort, address_line, village, district, state, pincode, location, or `details.<key>`) at approval. After approval the partner's Edit Profile (`PATCH /me`) sets `email`, `village`, `district`, `state`, `pincode`, `photo` (private storage path under `KO-documents/<pii_id>/`, set only from the profile edit) and `details.language_pref`; `name` changes only through HO's name-change approval; `details.bank_account` (`{account_holder, account_number, ifsc}`) is replaced when HO approves a bank-account change.

`vistaar_v2_agents.verification_calls[]` (`VerificationCall`, Mixed — not schema-enforced)

| Field | Type | Notes |
|---|---|---|
| `at` | Date | server time of the log |
| `by` | string | HO email |
| `outcome` | `'reached' \| 'not_reached' \| 'verified'` | `CallOutcome` (`CALL_OUTCOMES`) |
| `note` | string \| null | ≤ 300 (DTO), trimmed; empty = `null` |

`vistaar_v2_agents.pending_name` (`PendingName`, Mixed): `value` string (3–100, DTO), `requested_at` Date. `null` = none waiting.

`vistaar_v2_agents.name_change` (`NameChangeResult`, Mixed)

| Field | Type | Notes |
|---|---|---|
| `value` | string | the name decided |
| `approved` | boolean | |
| `reason` | string \| null | HO's reason on a refusal (≤ 300); `null` on approval |
| `by` | string | HO email (not sent to the app) |
| `at` | Date | |

`vistaar_v2_agents.location` (`GeoPoint`): `type: 'Point'`, `coordinates: [lng, lat]`.

`vistaar_v2_agents.earning_cohort` (`EarningCohortRef`): `id` string, `since` Date — copy of the open `vistaar_v2_earning_assignments` row.

Indexes:
- `{ phone: 1, country_code: 1 }` `{ unique: true }`
- `{ agent_id: 1 }` `{ unique: true, partialFilterExpression: { agent_id: { $type: 'string' } } }`
- `{ pii_id: 1 }` `{ unique: true, partialFilterExpression: { pii_id: { $type: 'string' } } }`
- `{ otp_verified: 1, stage: 1, updated_at: -1 }`
- `{ owner_agent_id: 1, stage: 1 }`
- `{ otp_verified: 1, stage: 1, decided_at: -1 }`
- `{ location: '2dsphere' }`
- `{ otp_verified: 1, stage: 1, last_login_at: -1 }`

Write patterns:
- `upsertForOtp`: `findOneAndUpdate({phone, country_code}, {$setOnInsert:{_id: randomUUID(), phone, country_code}}, {upsert, returnDocument:'after', setDefaultsOnInsert:true})`; on duplicate key (race) re-reads by phone.
- `completeVerification`: conditional `findOneAndUpdate({_id, otp_verified:false}, {$set:{otp_verified:true, otp_verified_at, last_login_at, agent_id, pii_id, owner_agent_id}, $push:{stage_history:{from:null,to:'signed_up',by:'self',at,reason:'otp_verified'}}})` — only the first verify writes ids.
- `touchLogin`: `updateOne({_id}, {$set:{last_login_at:new Date()}}, {timestamps:false})`.
- `transition`: conditional `findOneAndUpdate({_id, stage:{$in: from}}, {$set:{...set, stage: entry.to, updated_by: entry.by}, $push:{stage_history: entry}})`; `null` = lost race.
- `linkOnboarding`: `updateOne({_id, onboarding_id:null}, {$set:{onboarding_id}})`.
- `setPreview`: `updateOne({_id}, {$set:{cohort, preview}})`.
- `setPlace`: `updateOne({_id}, {$set: {'preview.<state|district>', and 'profile.<…>' only when approved}})` (dotted).
- `setOwner`: `findOneAndUpdate({_id}, {$set:{owner_agent_id, updated_by}})`.
- `setMonthlyTarget`: `findOneAndUpdate({agent_id, otp_verified:true}, {$set:{monthly_target, updated_by}})`.
- `addVerificationCall`: conditional `findOneAndUpdate({_id, stage:{$in: CALLABLE_STAGES}}, {$push:{verification_calls: {at, by, outcome, note}}, $set:{updated_by: by}}, {returnDocument:'after'})`, `.select('agent_id stage verification_calls')`; `CALLABLE_STAGES` = signed_up, onboarding, kyc_review, changes_requested; `null` = the partner was decided meanwhile.
- `editProfile`: conditional `findOneAndUpdate({_id, stage:'approved'}, {$set:{...set, updated_by:'self'}}, {returnDocument:'after'})`; `null` = no longer approved. From `PATCH /me`, `set` = dotted `profile.<email|village|district|state|pincode|photo>` (the whole `profile` object when it is `null`), `profile.details.language_pref` (or `profile.details: {language_pref}` when `details` is absent), `preview.<district|state|pincode>`, and `pending_name: {value, requested_at}` for a new name. Also used by the bank-change approval with `{'profile.details.bank_account': {account_holder, account_number, ifsc}}`, only when `profile.details` exists (that HO-side write also records `updated_by: 'self'`).
- `decideNameChange`: conditional `findOneAndUpdate({_id, 'pending_name.value': value}, {$set:{pending_name:null, name_change:{value, approved, reason, by, at}, updated_by, + 'profile.name' and 'preview.name' on approval}}, {returnDocument:'after'})`, `.select('-stage_history')`; `null` = no name waiting, or a newer one than HO saw.
- `setEarningCohorts`: `bulkWrite` of `updateOne {filter:{agent_id}, update:{$set:{earning_cohort}}, timestamps:false}`, `{ordered:false}`.
- Reads use `.lean()`; most HO reads filter `otp_verified: true` (and `stage: 'approved'` for directory/earning).

Lifecycle: created at OTP send (`otp_verified:false`, no ids) → OTP verify gives `agent_id` + `pii_id` + `stage_history` entry → stage moves signed_up → onboarding → kyc_review ⇄ changes_requested → approved / rejected; blocked (with `blocked_from`) and unblock. HO may push `verification_calls` until a decision (the stage does not move). Once approved, the partner edits their own `profile` (a new name waits in `pending_name` until HO approves or rejects it, the result kept in `name_change`); an edit of `state`, `district` or `pincode` re-places the partner in an earning cohort at once (when the cohort changes, a new `vistaar_v2_earning_assignments` stretch with reason `profile_changed`, copied to `earning_cohort`), a village alone does not. Never deleted (schema comment).

- DISCREPANCY: `docs/PROD-CHECKLIST.md` lists the `{ otp_verified, stage, last_login_at: -1 }` index separately (line 97) from the main block (lines 31-37); all 8 code indexes are present across the file — consistent, just split. No index was added for the new fields.
- DISCREPANCY: on a bank-account change approval the code replaces `profile.details.bank_account` (`BankChangeService.approve` → `AgentsService.setProfileBankAccount`); `docs/ONBOARDING-HO.md` §3 and `docs/ONBOARDING-APP.md` §6 say that copy is **not** updated. `docs/DATABASE.md` does not mention it.

---

### `vistaar_v2_onboarding_data`  (`src/modules/onboarding/schemas/onboarding-data.schema.ts`; `OnboardingData`)

- Owner module: `onboarding`. Written by: `OnboardingRepository` (app form saves, submit, HO KYC review / remarks / edits, bank-account change request / withdraw / HO approve / reject via `BankChangeService`, the one-off `scripts/backfill-id-keys`). Read by: onboarding, agents (pipeline progress), nearby-network check, the Aadhaar / PAN duplicate check (`idHolders`), payouts and the wallet (`forPayout`, incl. `bank_change.status`).
- Schema options: `collection: 'vistaar_v2_onboarding_data'`, `timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }`, `versionKey: false`, `minimize: false`, strict default, `_id: String`.
- `_id`: String, `randomUUID()` at create.

| Field | Type | Required | Default | Enum / validation | Notes |
|---|---|---|---|---|---|
| `_id` | String | – | – | – | UUID |
| `agent_ref` | String | yes | – | – | `vistaar_v2_agents._id` |
| `agent_id` | String | yes | – | – | `VST-` |
| `pii_id` | String | yes | – | – | |
| `cohort` | String | yes | – | – | |
| `config_id` | String | yes | – | – | `<cohort>@<version>` |
| `config_version` | Number | yes | – | – | |
| `raw_data` | Mixed | no | `{}` | checked by `form.domain` against config field types | `RawData = Record<string, unknown>` |
| `current_step` | String | no | `null` | – | |
| `completed_steps` | [String] | no | `[]` | – | |
| `completion_pct` | Number | no | `0` | – | |
| `documents_review` | Mixed | no | `{}` | – | `Record<fieldKey, DocumentReview>` |
| `remarks` | Mixed | no | `{}` | – | `Record<fieldKey, string>`; only these fields editable during changes |
| `location` | Mixed | no | `undefined` | – | `GeoPoint`, copied from form GPS field |
| `submitted_at` | Date | no | `null` | – | |
| `submit_count` | Number | no | `0` | – | |
| `updated_data` | [Mixed] | no | `[]` | – | `AdminEdit[]` (HO edits and approved bank changes); `$push … $slice: -200` (onboarding.service.ts:812, onboarding.repository.ts:190) |
| `id_keys` | Mixed | no | `undefined` | – | `IdKeys`; rewritten on every form write, for the cross-partner duplicate check; never returned. Absent on rows not saved since the check (until the backfill) |
| `bank_change` | Mixed | no | `undefined` | – | `BankChange`; the partner's latest payout-account change request only (one pending at a time) |
| `source` | String | no | `'vistaar_app'` | – | |
| `created_by` | String | no | `'self'` | – | |
| `updated_by` | String | no | `'self'` | – | |
| `version` | Number | no | `0` | – | optimistic lock, `$inc` 1 on every write |
| `created_at` / `updated_at` | Date | auto | – | – | |

`vistaar_v2_onboarding_data.documents_review.<key>` (`DocumentReview`)

| Field | Type | Notes |
|---|---|---|
| `status` | `'pending' \| 'verified' \| 'rejected'` | `DocumentStatus` |
| `reason` | string \| null | |
| `by` | string \| null | |
| `at` | Date \| null | |
| `sig` | string | signature of the reviewed value; a re-upload makes it pending again |

`vistaar_v2_onboarding_data.updated_data[]` (`AdminEdit`): `field` string, `old_value` unknown, `new_value` unknown, `by` string, `at` Date. An approved bank change pushes two entries (the payout-account field and the bank-proof field, old and new value, `by` = HO email).

`vistaar_v2_onboarding_data.id_keys` (`IdKeys`, `id-keys.domain.ts`)

| Field | Type | Notes |
|---|---|---|
| `aadhaar_hash` | string \| null | SHA-256 hex of the 12 Aadhaar digits (spaces and `-` removed) from the field with `org_document: 'adhar'` (`.number`); `null` when absent or not 12 digits. The number itself stays only in `raw_data` |
| `pan` | string \| null | PAN from the field with `org_document: 'pan'` (`.number`), spaces removed, upper case; `null` when absent |

`vistaar_v2_onboarding_data.bank_change` (`BankChange`, `bank-change.domain.ts`)

| Field | Type | Notes |
|---|---|---|
| `status` | `'pending' \| 'approved' \| 'rejected' \| 'withdrawn'` | `BankChangeStatus` |
| `account_holder` | string | ≤ 100 (DTO), then the form's own rules |
| `account_number` | string | 9–18 digits (DTO) |
| `ifsc` | string | `^[A-Za-z]{4}0[A-Za-z0-9]{6}$` (DTO), saved upper case |
| `proof_path` | string | cheque / passbook photo under `KO-documents/<pii_id>/` |
| `requested_at` | Date | also the key the decision filters on |
| `decided_at` | Date \| null | |
| `decided_by` | string \| null | HO email, or `'self'` when the partner withdrew it |
| `reason` | string \| null | HO's reason on a rejection |

The form's own payout account (`raw_data.<field with maps_to: details.bank_account>`) and bank proof (`raw_data.<field with org_document: bank_details>` + its `documents_review` entry) change only on approval.

`vistaar_v2_onboarding_data.raw_data` value shapes per config field type (`form.domain.ts` `FIELD_TYPES`): text, textarea, number, boolean, date, phone, email, pincode, select, multi_select; `file` = `{ path }`; `document` = `{ files: [path, …], number? }`; `location` = `{ lat, lng, accuracy?, captured_at? }`; `object` = `{ key: value }`; `object_list` = `[{ key: value }, …]`. Nested (`object`/`object_list`) allow only the non-document, non-location, non-group types (one level).

Indexes:
- `{ agent_ref: 1 }` `{ unique: true }`
- `{ location: '2dsphere' }`
- `{ 'id_keys.aadhaar_hash': 1 }` `{ partialFilterExpression: { 'id_keys.aadhaar_hash': { $exists: true } } }` — not unique (the save refuses a clash; older rows may already hold duplicates)
- `{ 'id_keys.pan': 1 }` `{ partialFilterExpression: { 'id_keys.pan': { $exists: true } } }` — not unique, same reason

Write patterns:
- `create`: `model.create({_id: randomUUID(), agent_ref, agent_id, pii_id, cohort, config_id, config_version, raw_data:{}})`; on E11000 (racing first save) returns the existing row by `agent_ref`.
- `updateIfVersion(id, version, update)`: `findOneAndUpdate({_id, version}, {...update, $inc:{...update.$inc, version:1}}, {returnDocument:'after'})`; `null` = stale, caller re-reads and retries. `updated_data` pushed with `$each` + `$slice: -200`. Every form write through it (partner save, HO edit, submit, moving to a newer version or another cohort) also `$set`s `id_keys` from the merged `raw_data`; the backfill script `$set`s only `id_keys` (a stale `version` = row skipped).
- `startBankChange(agentRef, change)`: conditional `findOneAndUpdate({agent_ref, 'bank_change.status':{$ne:'pending'}}, {$set:{bank_change: change, updated_by:'self'}, $inc:{version:1}}, {returnDocument:'after'})` — replaces the previous request whole; `null` = one is pending.
- `closeBankChange(agentRef, requestedAt, version, set, audit)`: conditional `findOneAndUpdate({agent_ref, 'bank_change.status':'pending', 'bank_change.requested_at': requestedAt, version}, {$set: set, $inc:{version:1}, $push?:{updated_data:{$each: audit, $slice:-200}}}, {returnDocument:'after'})`. `set` = dotted `bank_change.status` / `bank_change.decided_at` / `bank_change.decided_by` (+ `bank_change.reason` on reject) and `updated_by`; on approve also `raw_data.<account key>`, `raw_data.<proof key>` (`{files:[proof_path]}`) and `documents_review.<proof key>` (status verified, `by` HO email, `sig` of the new value). `null` = decided, withdrawn or replaced meanwhile, or another write landed.
- Reads: `near` (`$geoWithin $centerSphere`, excludes own `agent_ref`), `progressFor`, `forPayout` (projection `agent_ref cohort config_version raw_data documents_review bank_change.status`), `countForCohort`, `idHolders` (`find({agent_ref:{$ne: own}, $or:[{'id_keys.aadhaar_hash'}, {'id_keys.pan'}]}).select('agent_ref agent_id id_keys').limit(50)`), `pageAfter` (pages by `_id`, for the backfill) — all `.lean()`.

Lifecycle: one row per partner, created on first save; saved repeatedly during onboarding (each save rewrites `id_keys`); submitted (`submitted_at`, `submit_count`); HO reviews documents / remarks / edits; values mapped onto `vistaar_v2_agents.profile` at approval. After approval, `bank_change` holds the latest payout-account request: pending → approved / rejected (HO) or withdrawn (partner); approval rewrites the form's account and proof. No delete in repository.

- Note: `id_keys` / `bank_change` and the two `id_keys` indexes match `docs/DATABASE.md` (index line: "partial", not unique) and `docs/PROD-CHECKLIST.md` lines 40-41 (exact `$exists: true` filter); the checklist's data step (line 128) runs the backfill after building them.

---

### `vistaar_v2_onboarding_configs`  (`src/modules/onboarding/schemas/onboarding-config.schema.ts`; `OnboardingConfig`)

- Owner module: `onboarding`. Written by: `ConfigRepository` (HO form editor). Read by: onboarding (app form, validation, mapping).
- Schema options: `collection: 'vistaar_v2_onboarding_configs'`, `timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }`, `versionKey: false`, strict/minimize default, `_id: String`.
- `_id`: `` `${cohort}@${version}` ``.

| Field | Type | Required | Default | Enum / validation | Notes |
|---|---|---|---|---|---|
| `_id` | String | – | – | – | `<cohort>@<version>` |
| `cohort` | String | yes | – | – | |
| `version` | Number | yes | – | – | next = `maxVersion + 1` |
| `status` | String | yes | – | `CONFIG_STATUSES`: draft, published, archived | |
| `steps` | [Mixed] | no | `[]` | – | `StepDef[]` |
| `notes` | String | no | `null` | – | |
| `published_at` | Date | no | `null` | – | |
| `published_by` | String | no | `null` | – | |
| `created_by` | String | no (no default) | – | – | |
| `updated_by` | String | no (no default) | – | – | |
| `created_at` / `updated_at` | Date | auto | – | – | |

`vistaar_v2_onboarding_configs.steps[]` (`StepDef`): `step_id` string, `order` number, `title` Localized, `description?` Localized, `icon?` string, `is_active` boolean, `fields` FieldDef[].

`…steps[].fields[]` (`FieldDef`): `key` string, `type` FieldType (list above), `label` Localized, `placeholder?` Localized, `help?` Localized, `required` boolean, `options?` Option[], `validation?` Validation, `visible_if?` VisibleIf, `maps_to?` MapsTo, `org_document?` string (`piis.documents` key, ko-sales spelling: `adhar`, `pan`, `bank_details`, `selfie`…), `fields?` FieldDef[] (sub-fields of object / object_list).

- `Localized` = `Record<string,string>` (`en` required, others optional).
- `Option`: `value` string, `label` Localized.
- `Validation`: `min?`, `max?`, `min_length?`, `max_length?`, `regex?`, `max_items?` (number/string), `number_required?`, `must_accept?` (boolean).
- `VisibleIf`: `field` string, `op` `'eq'|'ne'|'in'|'filled'`, `value?` unknown.

Indexes:
- `{ cohort: 1, version: -1 }` `{ unique: true }`
- `{ cohort: 1, status: 1 }` `{ unique: true, partialFilterExpression: { status: 'draft' } }` (one draft per cohort)

Write patterns:
- `createDraft`: `create({_id:'<cohort>@<version>', cohort, version, status:'draft', steps, notes, created_by, updated_by})`.
- `updateDraft`: `findOneAndUpdate({cohort, status:'draft'}, {$set:{steps, notes, updated_by}})`.
- `publish`: conditional `findOneAndUpdate({_id, status:'draft'}, {$set:{status:'published', published_at:new Date(), published_by, updated_by}})`.
- `archiveOlder`: `updateMany({cohort, status:'published', version:{$lt: version}}, {$set:{status:'archived', updated_by}})`.
- `deleteDraft`: `deleteOne({cohort, status:'draft'})`.

Lifecycle: draft (≤1 per cohort, editable, deletable) → published (immutable) → archived when a newer version publishes. Applications keep the version they were filled with.

- DISCREPANCY: `docs/DATABASE.md` lists only `_id`, `status`, `steps[]`, `published_at/by`; code also has `cohort`, `version`, `notes`, `created_by/updated_by`, timestamps (omission).

---

### `vistaar_v2_cohorts`  (`src/modules/onboarding/schemas/cohort.schema.ts`; `Cohort`)

- Owner module: `onboarding`. Written by: `CohortRepository` (HO). Read by: onboarding (app cohort picker, HO).
- Schema options: `collection: 'vistaar_v2_cohorts'`, `timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }`, `versionKey: false`, strict/minimize default, `_id: String`.
- `_id`: the cohort key, e.g. `vistaar_agent`; never renamed once used.

| Field | Type | Required | Default | Enum / validation | Notes |
|---|---|---|---|---|---|
| `_id` | String | – | – | – | key |
| `label` | Mixed | yes | – | – | Localized |
| `description` | Mixed | no | `null` | – | Localized \| null |
| `icon` | String | no | `null` | – | |
| `sub_types` | [Mixed] | no | `[]` | – | SubType[] |
| `order` | Number | no | `0` | – | |
| `is_active` | Boolean | no | `true` | – | |
| `created_by` | String | no (no default) | – | – | |
| `updated_by` | String | no (no default) | – | – | |
| `created_at` / `updated_at` | Date | auto | – | – | |

`vistaar_v2_cohorts.sub_types[]` (`SubType`): `key` string, `label` Localized.

Indexes: none declared (only `_id_`).

Write patterns: `create(row)`; `update`: `findOneAndUpdate({_id}, {$set})`; `remove`: `deleteOne({_id})`. Reads: `list(activeOnly)` sorted `{order:1, _id:1}`, `find(key)`.

Lifecycle: HO-managed; can be deactivated or deleted (service decides when delete allowed; `ConfigRepository.existsForCohort` exists for that check).

---

### `vistaar_v2_sessions`  (`src/modules/auth/schemas/session.schema.ts`; `Session`)

- Owner module: `auth`. Written/read by: `SessionRepository` (login, refresh, logout).
- Schema options: `collection: 'vistaar_v2_sessions'`, `versionKey: false`, no timestamps option, strict/minimize default, `_id: String`.
- `_id`: SHA-256 of the refresh token (token itself never stored).

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `_id` | String | – | – | SHA-256 hash |
| `agent_ref` | String | yes | – | `vistaar_v2_agents._id` |
| `created_at` | Date | yes | – | set by caller (not timestamps) |
| `expires_at` | Date | yes | – | TTL |
| `user_agent` | String | no | `null` | |

Indexes:
- `{ agent_ref: 1 }`
- `{ expires_at: 1 }` `{ expireAfterSeconds: 0 }` (TTL)

Write patterns: `create(row)`; `consume`: `findOneAndDelete({_id: hash, expires_at:{$gt:new Date()}})` (rotate, single use even under race); `remove`: `deleteOne({_id: hash, agent_ref})`.

Lifecycle: one row per signed-in device (many per partner); deleted on refresh (consume), logout, or TTL.

- DISCREPANCY: `docs/DATABASE.md` lists `_id`, `agent_ref`, `expires_at`; code also has `created_at` (required) and `user_agent` (omission).

---

### `vistaar_v2_otp_attempts`  (`src/modules/auth/schemas/otp-attempt.schema.ts`; `OtpAttempt`)

- Owner module: `auth`. Written/read by: `OtpAttemptRepository` (OTP send/verify limits; per docs also lead-OTP limits).
- Schema options: `collection: 'vistaar_v2_otp_attempts'`, `versionKey: false`, no timestamps, strict/minimize default, `_id: String`.
- `_id`: `<kind>:<phone>`, e.g. `verify:9876543210`.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `_id` | String | – | – | `<kind>:<phone>` |
| `hits` | [Date] | no | `[]` | hits still inside the window, oldest first |
| `allowed` | Boolean | no | `true` | whether the last take was let through |
| `expires_at` | Date | yes | – | TTL; `now + windowMs` |

Indexes: `{ expires_at: 1 }` `{ expireAfterSeconds: 0 }`.

Write patterns:
- `take(id, limit, windowMs, now)`: one pipeline `findOneAndUpdate({_id}, [ $set hits = $filter(hits > cutoff); $set allowed = size(hits) < limit; $set hits = allowed ? hits+[now] : hits, expires_at = now+windowMs ], {upsert:true, returnDocument:'after', updatePipeline:true})`. Returns 0 or seconds until a slot frees.
- `reset(id)`: `deleteOne({_id})`.

Lifecycle: upserted per take; TTL deletes once the window passes; reset deletes.

- Note: limits per `docs/PROD-CHECKLIST.md` line 13: 3 SMS and 5 guesses per number per 10 min (values live in the service, not the schema).

---

### `vistaar_v2_counters`  (`src/modules/counters/schemas/counter.schema.ts`; `Counter`)

- Owner module: `counters`. Written/read by: `CounterRepository` via `CountersService` (used by auth, feedback, withdrawals, gigs).
- Schema options: `collection: 'vistaar_v2_counters'` (`COUNTERS_COLLECTION`), `versionKey: false`, no timestamps, strict/minimize default, `_id: String`.
- `_id`: series key.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `_id` | String | – | – | series key |
| `seq` | Number | yes | `0` | last number issued |
| `updated_at` | Date | no | – | set on every `$inc` |

Series keys (counters.service.ts): `agent_id` → `VST-` + 6-digit pad; `product_suggestion` → raw number (feedback module formats `SUG-`); `withdrawal_id` → `WD-` + 6-digit pad; `gig_id` → `GIG-` + 6-digit pad.

Indexes: none declared.

Write patterns: `next(key)`: `findOneAndUpdate({_id:key}, {$inc:{seq:1}, $set:{updated_at:new Date()}}, {upsert:true, returnDocument:'after'})` — atomic; first call creates the row with seq 1.

Lifecycle: rows created lazily on first use; never deleted. Not `app_counters`, not legacy `sequences`.

- DISCREPANCY: CLAUDE.md "Collections" table says `VST-`, `WD-` and `GIG-` series only; code and `docs/DATABASE.md` also have `product_suggestion` (`SUG-`).

---

### `vistaar_v2_settings`  (`src/modules/settings/schemas/settings.schema.ts`; `Settings`)

- Owner module: `settings`. Written by: `SettingsRepository.write` (HO `PUT /admin/settings`). Read by: settings service (consumed by agents, leads, commission, gigs, feedback, testimonials, approvals).
- Schema options: `collection: 'vistaar_v2_settings'`, `versionKey: false`, no timestamps option (manual `updated_at`), strict/minimize default, `_id: String`.
- `_id`: single document `'vistaar'` (`SETTINGS_ID`, also schema default).

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `_id` | String | – | `'vistaar'` | single row |
| `default_owner_agent_id` | String | no | `null` | `agents_v2.agent_id` owning new signups |
| `lead_owner_agent_id` | String | no | `null` | `null` = the Offline Head (USR-1037) head office picked in franchise-offline-hub (`franchise_v2_crm_settings`), or the only active one |
| `farmer_consent` | Mixed | no | `null` | FarmerConsent; `null` = built-in v1 |
| `lead_release_days` | Number | no | `15` | |
| `customer_release_days` | Number | no | `45` | |
| `testimonial_consent` | Mixed | no | `null` | FarmerConsent; `null` = built-in v1 |
| `feedback_reasons` | Mixed | no | `null` | FeedbackReasons; `null` = app built-in |
| `return_window_days` | Number | no | `7` | |
| `min_withdrawal` | Number | no | `500` | ₹ |
| `tds_rate_with_pan` | Number | no | `2` | % |
| `tds_rate_without_pan` | Number | no | `20` | % |
| `monthly_target` | Number | no | `100000` | ₹ |
| `gig_payout` | Number | no | `250` | |
| `gig_min_farmers` | Number | no | `15` | |
| `gig_photos_required` | Number | no | `3` | |
| `gig_checkin_radius_m` | Number | no | `500` | flagged, never refused |
| `gig_pay_enabled` | Boolean | no | `false` | |
| `gig_pay_enabled_at` | Date | no | `null` | set once, never cleared |
| `conflict_radius_km` | Number | no | `5` | |
| `updated_by` | String | no | – | |
| `updated_at` | Date | no | – | set on every write |

`vistaar_v2_settings.farmer_consent` / `.testimonial_consent` (`FarmerConsent`): `version` number, `text` `{ en: string; hi?: string }`.

`vistaar_v2_settings.feedback_reasons` (`FeedbackReasons` = `Record<string, {question: string; chips: string[]}>`), keys per NPS bucket `detractor`, `passive`, `promoter`.

Indexes: none declared.

Write patterns: `write(set)`: `findOneAndUpdate({_id:'vistaar'}, {$set:{...set, updated_at:new Date()}}, {upsert:true, returnDocument:'after'})`. `read()`: `findById('vistaar').select('-_id').lean()`. Defaults for a missing row/field are applied in the service layer (`SettingsRecord`).

Lifecycle: single row, upserted on first HO save; never deleted.

- DISCREPANCY: `docs/DATABASE.md` gives `conflict_radius_km` with no default; code default is `5`. Docs also omit `updated_by` / `updated_at`.

---

### `agents_v2`  (shared, read-only)  (`src/modules/access/schemas/staff-account.schema.ts`; `StaffAccount`)

- Owner: ko-sales (company staff directory, shared with every portal). Here: module `access`, read-only via `StaffAccountRepository` (HO capability check, owner picker / owner names, Offline Head lookup, the app's reporting officer on `GET /me`: owner name, phone and role). Never written.
- Schema options: `collection: 'agents_v2'`, `autoIndex: false`, `strict: false`, timestamps/versionKey not set (Mongoose defaults; irrelevant, read-only); `_id`: ObjectId (default, not declared) — exposed as hex `ref` (= what `leads_v2.lead_owner.agent_ref` holds).

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `email` | String | (declared `!`, no `required`) | – | SSO lookup key |
| `agent_id` | String | no | – | |
| `first_name` | String | no | – | |
| `last_name` | String | no | – | |
| `user_role` | String | no | – | e.g. USR-1037 Offline Head |
| `is_active` | Boolean | no | – | `true` only when exactly `true` |
| `contact` | Mixed | no | – | `{ country_code?: string; phone_number?: number \| string }` — ko-sales stores the number as a Number |

Deliberately undeclared (exist on documents, never selected): `password`, `otp`, `refresh_token`, `sipPassword`.

Indexes: none declared (`autoIndex: false`; also excluded by `IndexSyncService` prefix rule).

Read patterns (projection `_id email agent_id first_name last_name user_role is_active contact`, `.lean()`): `findByEmail` `findOne({email})`; `findActiveByRole(role, limit)` `find({user_role: role, is_active: true}).limit(limit)`; `findByAgentIds` `find({agent_id:{$in}})`. Mapped to `StaffRecord {ref, email, agent_id, name (first+last), user_role, is_active, phone}` — `phone` = `String(contact.phone_number)`, `null` when missing or `''`. The reporting officer is read by `findByAgentIds` (`AccessService.staffByIds`) with no `is_active` filter.

Lifecycle: managed by ko-sales; not touched here.

---

## 5. Person spine and farmer leads

Sources read (beta `5113b6c`): src/modules/spine/schemas/{pii,address,app-counter,pincode}.schema.ts; spine/repositories/{pii,address,org-counter,pincode,product-facts}.repository.ts; spine/services/pii.service.ts (incl. `tryNextOrgNumber`), pincode.service.ts (REFRESH_MS, `withTrustedCentres`), product-facts.service.ts (REFRESH_MS); leads/schemas/{vistaar-lead,org-lead}.schema(s).ts; leads/repositories/{vistaar-leads,org-leads,kkd-store}.repository.ts; leads/leads.domain.ts; leads/lead-otp.domain.ts; leads/services/leads.service.ts (writeOrgRecords, createLead/createContact, placeOf, follow-up mirror, leadOwner, heldFarmers); leads/services/customers.service.ts (recordOrder); leads/services/lead-otp.service.ts; access/services/access.service.ts (offlineHead); auth/services/otp.service.ts (attemptKey); auth/schemas/otp-attempt.schema.ts; auth/repositories/otp-attempt.repository.ts; onboarding/services/{onboarding,bank-change}.service.ts (mirrorReviewed); orders/services/order-id.service.ts; partner-desk/repositories/network.repository.ts; kkd-activity/repositories/{farmer-orders,store-activity,kkd-events,store-directory}.repository.ts and kkd-activity.domain.ts; docs/DATABASE.md; docs/PROD-CHECKLIST.md.

### `vistaar_v2_leads`  (src/modules/leads/schemas/vistaar-lead.schema.ts; Vistaar)
- Access: owned; module `leads` (VistaarLeadsRepository). Also read by other modules through LeadsService (carts, draft orders, meetings, radar, customers).
- Schema options: `collection: 'vistaar_v2_leads'`, `timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }`, `versionKey: false`, `minimize: false`. autoIndex not disabled (IndexSyncService builds outside prod).
- `_id`: String, UUID (per DATABASE.md; set by the service).

| Field | Type | Required | Default | Enum / validation | Notes |
|---|---|---|---|---|---|
| `_id` | String | — | — | — | UUID |
| `pii_id` | String | yes | — | unique index | the farmer; one farmer, one partner |
| `agent_id` | String | yes | — | — | partner `VST-…` |
| `lead_id` | String | no | `null` | — | org lead `L-…`; `null` until written or for a contact-only person |
| `origin` | String | yes | — | `created` \| `linked` | created = Vistaar wrote org records; linked = existing Katyayani farmer |
| `name` | String | yes | — | — | Title Case copy (`farmerCopyOf`) |
| `phone` | String | yes | — | — | 10 digits |
| `village` | String | yes | — | — | Title Case |
| `district` | String | no | `null` | — | dto.district, else pincode district |
| `state` | String | no | `null` | — | upper case (pincode state, else partner's state); `''` stored as `null` |
| `pincode` | String | no | `null` | — | |
| `crops` | [String] | no | `[]` | max 10 (`MAX_CROPS`) | Title Case, de-duplicated (`cropsOf`) |
| `acreage` | Number | yes | — | — | total acres |
| `found_via` | String | no | `null` | `meeting` `referral` `walk_in` `self` `campaign` | |
| `expected_value` | Number | no | `null` | — | |
| `stage` | String | no | `'prospect'` | `prospect` `contacted` `interested` `negotiation` `won` `lost` | partner may not set `won` (only first order, actor `system`) |
| `stage_history` | [Mixed] | no | `[]` | last 50 (`MAX_STAGE_HISTORY`) | StageMove, below |
| `next_follow_up` | Date | no | `null` | — | mirrored to `leads_v2.follow_up_date` |
| `lost_reason` | String | no | `null` | — | |
| `activities` | [Mixed] | no | `[]` | newest last, last 100 (`MAX_ACTIVITIES`) | LeadActivity, below |
| `consent` | Mixed | yes | — | — | `{ version: number, at: Date }` |
| `ex_employee_declared_at` | Date | no | `null` | — | cohort `ex_employee` declaration |
| `otp_verified_at` | Date | no | `null` | — | farmer mobile OTP on the partner's last add (mandatory from 2026-10-16); `null` on older rows |
| `customer_at` | Date | no | `null` | — | first order (won) |
| `last_order_at` | Date | no | `null` | — | every order |
| `held_since` | Date | no | `null` | — | `null` = since `created_at` |
| `last_worked_at` | Date | no | `null` | — | last save/stage/follow-up/expected value/activity |
| `holder_history` | [Mixed] | no | `[]` | oldest first, last 20 (`MAX_HOLDER_HISTORY`) | HolderMove, below; HO only |
| `location` | Mixed | no | `null` | GeoJSON point (lng first) | radar dot |
| `location_source` | String | no | `null` | `pincode` `order` `add` `visit` (weakest → strongest) | |
| `location_at` | Date | no | `null` | — | |
| `created_at` / `updated_at` | Date | — | timestamps | — | `updated_at` is the takeover guard |

StageMove (`stage_history[]`):

| Field | Type | Notes |
|---|---|---|
| `from` | LeadStage \| null | |
| `to` | LeadStage | |
| `at` | Date | |
| `by` | string | `VST-…` or `system` |

LeadActivity (`activities[]`):

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `type` | `call` `visit` `whatsapp` `note` \| `stage_change` | |
| `text` | string | |
| `at` | Date | |
| `by` | string | |

HolderMove (`holder_history[]`):

| Field | Type | Notes |
|---|---|---|
| `agent_id` | string | earlier holder |
| `from` / `to` | Date | |
| `reason` | `released` \| `partner_blocked` \| `transferred` | |
| `by` | string | taking partner `VST-…` or HO email (transfer) |
| `note` | string (optional) | HO's transfer reason |

- Indexes (declared): `{pii_id:1}` unique; `{agent_id:1, created_at:-1}`; `{agent_id:1, stage:1}`; `{agent_id:1, next_follow_up:1}`; `{created_at:-1}`; `{stage:1, created_at:-1}`; `{phone:1}`; `{last_order_at:-1, _id:1}`; `{next_follow_up:1, _id:1}`; `{agent_id:1, location:'2dsphere'}`. All 10 are listed in PROD-CHECKLIST.md.
- Write patterns:
  - insert: `model.create(row)`; E11000 (unique `pii_id`) → `false` (race decided by the index). Partner row written before org rows.
  - update: `findOneAndUpdate({ pii_id, agent_id, ...expect }, update, { returnDocument:'after' })` where `expect` may be `{stage}` or `{customer_at: null}`; `null` = not theirs / moved meanwhile.
  - confirmed order (`CustomersService.recordOrder`, from `POST /hooks/orders/confirmed`): the first one `$set {stage:'won', customer_at, last_order_at, lost_reason:null, next_follow_up:null}` + `$push` a `stage_history` move (`by: 'system'`) and an activity, with `expect` `{stage, customer_at: null}`; a later one `{$max: {last_order_at}, $min: {customer_at}}` (safe to repeat). A row the event's partner does not hold is ignored.
  - Rewards (rows in `vistaar_v2_rewards`, section 9A), written after the partner's row: a forward stage move (never to `lost`; `won` only from an order) calls `lead_stage_advanced`; a confirmed order newer than `last_order_at` on a row already a customer calls `reorder` (keyed by `order_id`, with the IST days since the last order). A replay or an older order pays nothing.
  - setLocation: `updateOne({ pii_id, agent_id, location_source: { $in: [...replaceable, null] } }, { $set: { location, location_source, location_at } })` — replaceable = same and weaker sources.
  - takeOver: `findOneAndUpdate({ pii_id, agent_id: from.agent_id, updated_at: from.updated_at }, update)`.
  - remove: `deleteOne({ pii_id, agent_id, stage: { $ne: 'won' } })` — customers never deleted.
  - Reads: `.lean()` finds/aggregations by `pii_id`, `agent_id`+`phone $in`, radar `$geoWithin $centerSphere` with `agent_id`, `stage $ne lost`; `all()` capped at 5000 (projection drops `activities`, `stage_history`, `holder_history`). KKD & App activity reads every row the partner holds (`heldFarmers`: `all({agent_id}, 5000)`, open, won and lost) and takes `held_since ?? created_at` as the start of each hold.
- Never-write: a customer (`won`) is never deleted; partner cannot set `won`.

### `vistaar_v2_otp_attempts` — farmer-OTP rows  (src/modules/auth/schemas/otp-attempt.schema.ts; Vistaar)
- Access: owned; module `auth` (OtpService, used by `leads/services/lead-otp.service.ts` with scope `'lead'`).
- Schema options: `collection: 'vistaar_v2_otp_attempts'`, `versionKey: false`. `_id` String: `attemptKey(scope, kind, phone)` = `send:<phone>` / `verify:<phone>` for login, `lead-send:<phone>` / `lead-verify:<phone>` for a farmer on lead add.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `_id` | String | — | — | as above |
| `hits` | [Date] | no | `[]` | hits inside the window, oldest first |
| `allowed` | Boolean | no | `true` | whether the last take was let through |
| `expires_at` | Date | yes | — | now + window; TTL |

- Indexes: `{expires_at:1}` with `expireAfterSeconds: 0` (in PROD-CHECKLIST).
- Write pattern: one `findOneAndUpdate({_id}, [pipeline], { upsert: true, returnDocument: 'after', updatePipeline: true })` — `$filter` hits > cutoff, `$set allowed = size(hits) < limit`, append `now` if allowed, `$set expires_at`.
- The farmer OTP's verified state is **not stored**: `lead-otp.domain.ts` is stateless — `POST /leads/otp/verify` returns `otp_token` = base64url(JSON `{v:1, a: agent_id upper, p: phone, iat, exp}`) + `.` + HMAC-SHA256 (key = HMAC-SHA256(`VISTAAR_JWT_SECRET`, `'vistaar-lead-otp-v1'`)), TTL 15 min (`LEAD_OTP_TTL_MS`). `POST /leads` checks it (malformed / signature / expired / mismatch) and persists only `vistaar_v2_leads.otp_verified_at` = token `iat`.

### `piis`  (src/modules/spine/schemas/pii.schema.ts; owner ko-sales)
- Access: shared-written; module `spine` (PiiService / PiiRepository).
- Schema options: `collection: 'piis'`, `timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }`, `autoIndex: false`. `_id` ObjectId (default; not declared). `referral_id` deliberately not declared.
- Declared fields: `pii_id` String required; `phone_number` [String] default undefined; `country_code` String; `addresses` [Mixed] default undefined; `gst_numbers` [Mixed] default undefined; `documents` Mixed default undefined.

Insert (`PiiRepository.insert`, only when no PII holds the phone):

| Field | Value |
|---|---|
| `pii_id` | `PII-<n>`, n from `app_counters._id:'piis'` |
| `phone_number` | `[phone]` (bare 10 digits) |
| `country_code` | given country code |
| `addresses` | `[]` |
| `gst_numbers` | `[]` |
| `created_at` / `updated_at` | Mongoose timestamps |

Updates:

| Call | Filter | Update |
|---|---|---|
| addAddressRef | `{pii_id}` | `$addToSet: {addresses: addressId}`, `$set: {updated_at}` |
| setOwnDocument | `{pii_id, $or: [{documents.<type>: {$exists:false}}, {documents.<type>: null}, {documents.<type>.source: 'vistaar'}]}` | `$set: {'documents.<type>': entry, updated_at}` |
| unverifyOwnDocument | `{pii_id, 'documents.<type>.source': 'vistaar'}` | `$set: {'documents.<type>.is_verified': false, updated_at}` |

`documents.<type>` entry (recordVerifiedDocument): `...OrgDocument` + `is_verified: true`, `validity: null`, `source: 'vistaar'`, `verified_at: new Date()`. `OrgDocument` is built by `OnboardingService.mirrorReviewed` from the form value: `id` = the field's `number` (or `null`), `image` = URL of the first file, `back_image` = URL of the second file (only when there is one). Two callers, both only for a form field with an `org_document`: HO verifies a KYC document (reject → `unverifyOwnDocument`), and HO approves a bank-account change (`BankChangeService.approve`: the new proof as `documents.bank_details`, `{ id: null, image }` since the proof has no number). Best-effort: errors logged, never fail the review; a slot held by another portal is left as is (`matchedCount` 0, logged). Section 10A items 5 and 9 compare this shape with main's rows.

- Reads: `findOne({phone_number}).sort({_id:1}).select('pii_id')` (oldest first); `findOne({pii_id, 'addresses.0': {$exists:true}})`.
- Indexes relied on (none declared): `pii_id` unique, `phone_number` (ko-sales).
- Write pattern `resolve`: read by phone → else up to 2 attempts: next `PII-n`, insert; on E11000 re-read phone (raced → use it), else retry; then 503 `IDENTITY_UNAVAILABLE`.
- Never-write: `referral_id`; whole `documents` object; another portal's `documents.<type>`.

### `addresses`  (src/modules/spine/schemas/address.schema.ts; owner ko-sales)
- Access: shared-written; module `spine` (AddressRepository via PiiService.saveAddress / setAddressGeo), called by `leads`.
- Schema options: `collection: 'addresses'`, `autoIndex: false`, no timestamps option (dates set by the repository). `_id` ObjectId (default).

| Field | Type | Required | Default | Vistaar value |
|---|---|---|---|---|
| `address_id` | String | yes | — | `ADDR-<n>` (`app_counters._id:'addresses'`) |
| `pii_id` | String | yes | — | farmer |
| `address_line` | String | no | `''` | = village (Title Case) |
| `village` | String | no | `null` | village |
| `district` | String | no | `null` | district or null |
| `city` | String | no | `''` | district ?? `''` |
| `state` | String | no | `''` | upper-case state |
| `zipcode` | String | no | `''` | pincode ?? `''` |
| `country` | String | no | `'India'` | `'India'` |
| `is_primary` | Boolean | no | `false` | `true` only when the PII had no addresses |
| `source` | String | no | `null` | `'vistaar'` |
| `geo` | Object | no | undefined | `{lat, lng}` GPS fix |
| `created_by` | String | no | `null` | `VST-…` |
| `created_at` / `updated_at` | Date | — | — | `now` |

- Write patterns: `ownRow` = `findOne({pii_id, source})`; if found → `updateOne({address_id}, {$set: {address_line, village, district, city, state, zipcode, updated_at}})`; else up to 3 attempts (`create`, E11000 → next id), then `piis.addresses` `$addToSet`; else 503 `IDENTITY_UNAVAILABLE`. setGeo: `updateOne({pii_id, source:'vistaar'}, {$set: {geo, updated_at}})`.
- Indexes relied on: `address_id` unique, `pii_id` (ko-sales). None declared.
- Never-write: another source's row (`update` filters only `address_id`, but that id always comes from `ownRow({pii_id, source})`).
- No unique key on `{pii_id, source}`: two concurrent first adds for one person can each find no own row and insert one (section 10A, item 10).

### `app_counters`  (src/modules/spine/schemas/app-counter.schema.ts; owner ko-sales)
- Access: shared-written; module `spine`. Options: `autoIndex: false`, `versionKey: false`. `_id` String key.
- Fields: `_id` String, `count` Number, `updated_at` Date.

| Key | Repo | Update | Upsert |
|---|---|---|---|
| `piis` | PiiRepository.nextPiiNumber | `findOneAndUpdate({_id:'piis'}, {$inc:{count:1}, $set:{updated_at}})` | **`upsert: true`** |
| `leads`, `contacts`, `addresses` | OrgCounterRepository.next | `findOneAndUpdate({_id:key}, {$inc:{count:1}, $set:{updated_at}}, {returnDocument:'after'})` | never; missing row → throws `app_counters has no "<key>" row` |
| `vistaar_orders` | OrgCounterRepository.tryNext (via `PiiService.tryNextOrgNumber`, called by `OrderIdService.issue`) | same | never; missing row → `null` → 503 `ORDER_ID_UNAVAILABLE`. The row is created once by hand (`{ _id: 'vistaar_orders', count: 0, updated_at }`, PROD-CHECKLIST *Order numbers*) |
| `draft_orders` | draft-order module (section 6) | same `$inc` | never; missing row → 503 `DRAFT_ID_UNAVAILABLE` |

- Id formats: `PII-n`, `L-(100000+n)`, `C0-n`, `ADDR-n`, `KSV-n` (from 1; `DFT-n` in section 6). Retries: leads/contacts `ID_TRIES = 3`, addresses 3, piis 2. `KSV-n`: a number the old Vistaar already used in `orders_v2` (read once per process at boot, `order_id` regex `^KSV-\d+$`, held in memory) is skipped — one `$inc` per skip, at most `MAX_TAKEN_SKIPS = 100` per call, then 503; the number given out is kept in `vistaar_v2_order_ids` (section 6).

### `leads_v2`  (src/modules/leads/schemas/org-lead.schemas.ts `OrgLead`; owner ko-sales)
- Access: shared-written; module `leads` (OrgLeadsRepository, raw `collection.insertOne/updateOne`). Options: `autoIndex: false`. Declared (read/filter) fields: `lead_id, pii_id, first_name, last_name, state, pin_code, source, status, created_by` (String), `created_at, updated_at` (Date).
- Insert only when `leadOf(pii_id)` finds no lead (`leadDocOf`):

| Field | Value |
|---|---|
| `lead_id` | `L-(100000+n)` |
| `pii_id` | farmer |
| `lead_owner` | `{ agent_id, agent_ref: ObjectId(ref) or null if invalid }` — settings `lead_owner_agent_id` when set (that `agents_v2` account must be active), else the **one** active Offline Head (`AccessService.offlineHead`: `find({user_role:'USR-1037', is_active:true}).limit(2)`, used only when exactly one comes back). Neither → 503 `LEADS_NOT_CONFIGURED` for a new person, refused before anything is written (no `piis`, no partner row, no org rows). Set at insert only |
| `profiled_agent` | `null` |
| `first_name` / `last_name` | first word / rest, lower case |
| `state` | upper case; `pin_code` pincode ?? `''` |
| `tags` `[]`, `source` `'vistaar'`, `interakt_id` `null`, `agent_category` `'vistaar'`, `call_status` `''` | |
| `call_count` | `{answered:0, missed_call:0, not_connected:0, switched_off:0}` |
| `disposition` `null`, `follow_up_date` `null`, `assigned_date` now, `assigned_by` owner.agent_id | |
| `status` `'contact_created'`, `incoming_msg_count` 0, `last_incoming_msg_at` null, `rating` null, `pipeline_id` null | |
| `updated_data` `[]`, `owner_history` `[]`, `last_updated_by` null, `updated_by` null | |
| `created_by` | `VST-…` |
| `phone_verified` false, `is_profiled` true, `last_call_at` null, `bucket_id` null, `with_doc` false, `has_app` false, `is_kyc` false, `probability_doc` null, `role` null | |
| `contact_profile` `'farmer'`, `lqs` `{}`, `created_at`/`updated_at` now, `__v` 0 | |

- Updates:
  - re-submit (only if existing lead `source === 'vistaar'` AND `created_by === agentId`): `updateOne({lead_id, source:'vistaar'}, {$set: {first_name, last_name, state, pin_code, updated_by, last_updated_by, updated_at}})`.
  - follow-up mirror `setFollowUp`: `updateOne({lead_id, source:'vistaar'}, {$set: {follow_up_date: <Date|null>}})` — nothing else, not `updated_at`. Row without `lead_id` skipped; failure logged only.
- Insert result: E11000 with `pii_id` in keyPattern → `taken_person`; else `taken_id` → retry next id.
- Indexes relied on: `lead_id`, `pii_id` unique; `source` (ko-sales). None declared.
- Never-write: `profiled_at`, pipeline, LQS score, webhook; another channel's lead.

### `contacts_v2`  (org-lead.schemas.ts `OrgContact`; owner ko-sales)
- Access: shared-written; module `leads`. Options `autoIndex: false`. Declared: `contact_id, pii_id, profile, source` (String), `farm_details` (Mixed).
- Insert only when `contactOf(pii_id)` is null (`contactDocOf`): `contact_id` `C0-n`, `pii_id`, `eg_id` null, `notes` [], `profile` `'farmer'`, `profile_details {name: Title Case}`, `profile_category` band, `status` `'active'`, `farm_details {farm_area: acreage, farm_area_type: 'Acre', sub_profile: band, crops: [{crop_name}]}`, `query` [], `prescription_count` 0, `last_updated_by` `VST-…`, `call_status` null, `call_count` zeros, `disposition` null, `follow_up_date` null, `prospect_value` 0, `licences` [], `profile_image` false, `agent_category` `'vistaar'`, `source` `'vistaar'`, `pipeline_id` null, `fps` 0, `rps` 0, `updated_data` [], `tags` [], `created_at`/`updated_at` now, `__v` 0. Band: ≤5 `small_farmer`, ≤30 `medium_farmer`, else `super_farmer`.
- Update (if `contact.source === 'vistaar'`): `updateOne({pii_id, source:'vistaar'}, {$set: {'profile_details.name', profile_category, farm_details, last_updated_by, updated_at}})`.
- Reads: `findOne({pii_id}).select('profile source')`; non-farmer profile (not empty/`farmer`/`key_account_farmer`) → refused.
- Indexes relied on: `contact_id`, `pii_id` unique. None declared.

### `pincode_map_v2`  (spine/schemas/pincode.schema.ts; owner ko-sales)
- Fields read: `pincode`, `state`, `district`, `taluk` (String), `geo {lat?, lng?}`. `all()`: `find({pincode: {$type:'string'}}).select('-_id pincode state district taluk geo')` (~19,400 rows) held in memory, `REFRESH_MS` 24 h; `find(pincode)`: `findOne({pincode})`. No index on `pincode` (per code comment).
- Centres (`withTrustedCentres`, once per book load): a pincode keeps its own `geo` point only when it lies within `MAX_FROM_DISTRICT_KM = 60` of its district's median point; a missing or farther point is replaced by that district median, or by `null` when the district has none. Used by the radar's pincode fallback and by KKD & App activity's 50 km store list when the partner has no signup point.

### `products_v2`, `bulk_v2`, `categories_v2`  (raw driver in spine/repositories/product-facts.repository.ts; owner Stockship)
- `products_v2`: `find({sku:{$type:'string'}})`, projection `_id:0, sku, name, hero_image, images:{$slice:1}, variant, item_qty, 'bulk.sku'`.
- `bulk_v2`: `find({sku:{$type:'string'}})`, projection `_id:0, sku, gst_rate, 'category.cat_id'`; `gst_rate` string/number → number or null (e.g. `"#REF!"` → null).
- `categories_v2`: `find({})`, projection `_id:0, category_id, name`.
- Joined in memory, refreshed hourly (`REFRESH_MS` 1 h, retry 60 s). `bulk.category` is read as an object (`category.cat_id`); a bulk without it gets category `null`, shown as `Other` in the HO orders summary's by-category split and My Performance (section 10A, item 12). A `gst_rate` that does not parse is `null`, and commission then uses `UNKNOWN_GST_RATE = 18`.
- Also read by KKD & App activity for line labels (name + pack size by `sku`).

### `franchises`, `prasar_v2_retailers`, `vistaaragents`  (raw driver in partner-desk/repositories/network.repository.ts)
- `franchises`: filter `location $geoWithin $centerSphere [[lng,lat], km→rad]`; projection `franchiseId, city, location` (GeoJSON `[lng, lat]`).
- `prasar_v2_retailers`: bounding box on `latitude` / `longitude`; projection `retailer_id, shop_name, latitude, longitude`; limit ×4, then haversine filter.
- `vistaaragents`: `$or` of both box orders on `latestCoordinates.coordinates.0/.1` (stored `[lat, lng]`); projection `vagentId, firstName, lastName, latestCoordinates`; limit ×4, haversine filter.
- Never writes; no schema or index declared.
- `franchises` is also read whole for the radar's KKD stores (`leads/repositories/kkd-store.repository.ts`): `find({'location.coordinates.1': {$exists: true}})`, projection `franchiseId, city, state, address, pincode, contact, location`, limit 5,000, held 60 s (`STORES_TTL_MS`).

### KKD & App activity reads  (raw driver in src/modules/kkd-activity/repositories/*; read-only, module owns no collection)
- Who: `LeadsService.heldFarmers(agent_id)` (above) gives the partner's farmers, each with `since` = start of the hold. Every source is read from the **earliest** `since`, by the farmers' `pii_id`s and/or 10-digit mobiles (`normalizeMobile`), at most `READ_CAP = 2,000` rows per source, newest first; then each row is kept only when it matches one held farmer (`pii_id` first, else mobile) **and** happened on or after that farmer's own `since`. The merged feed is cached 60 s per partner (`TtlCache`, ≤ 2,000 partners); one source failing is logged and left out (`Promise.allSettled`).

| Collection (owner) | Filter | Projection | Kept in memory |
|---|---|---|---|
| `orders_v2` (Stockship) | `{pii_id: {$in}, marketplace: {$in: ['MKTP-2','MKTP-3','MKTP-4']}, date: {$gte: since}}`, sort `{date:-1}` | `_id:0, order_id, date, created_at, pii_id, marketplace, sub_source, created_by, 'warehouse.warehouse_id', order_status, total_amount, 'items.sku', 'items.qty'` | a sale only (`isCounted` and not cancelled / returned); MKTP-2 / MKTP-3 as app orders; MKTP-4 only when tied to a store — the POS login in `created_by` (lower case) → `employees` / store email, else `warehouse.warehouse_id` (string or ObjectId) → the store's warehouse — and never `sub_source: 'founder_office'`. Rides Stockship's `{pii_id: 1, date: -1}` (PROD-CHECKLIST) |
| `franchise_v2_pos_orders` (franchise backend) | `{$or: [{pii_id: {$in}}, {phone: {$in}}], order_date: {$gte: since}}`, sort `{order_date:-1}` | `_id:0, order_id, franchise_id, order_date, pii_id, phone, amount, in_stockship, 'items.product', 'items.sku', 'items.quantity'` | drops `in_stockship` true and any `order_id` already shown from `orders_v2` |
| `franchise_v2_walkins` (franchise backend) | same `$or`, `walked_in_at: {$gte: since}`, sort `{walked_in_at:-1}` | `_id, franchise_id, walked_in_at, pii_id, phone, status, notes, crop` | drops `status: 'rejected'` |
| `franchise_v2_prescriptions` (franchise backend) | same `$or`, `rx_date: {$gte: since}`, sort `{rx_date:-1}` | `_id, rx_id, franchise_id, rx_date, pii_id, phone, crop, problem, solution, 'products.name', 'products.sku'` | — |
| `kkd_events` (Katyayani app) | `{user_id: {$in: mobiles}, event_name: {$in: ['APP_LAUNCH', 'Cart Abandoned']}, created_at: {$gte: since}}`, sort `{created_at:-1}` | `_id, user_id, event_name, created_at, 'event_values.total_price', 'event_values.items.name', 'event_values.items.quantity'` | one app open per farmer per IST day |
| `franchises` (store list) | `{}`, limit 5,000 | `_id:0, franchiseId, address, city, state, pincode, contact, email, 'location.coordinates', 'warehouse.warehouseId'` | the store book (held 60 s) |
| `franchise_v2_franchises` (franchise HO portal) | `{}`, limit 5,000 | `_id:0, franchise_id, address, city, state, pincode, phone, email` | newer stores |
| `employees` (POS logins) | `{franchiseId: {$nin: [null, '']}, email: {$nin: [null, '']}}`, limit 5,000 | `_id:0, email, franchiseId` — nothing else of theirs | login email → store |

- Indexes: none declared and none built by Vistaar. Per PROD-CHECKLIST (2026-10-21): the three franchise collections have no `pii_id` / `phone` index (48 / 11 / 507 rows then — a scan is fine), `kkd_events` has only `_id` (43 test rows); asking the owning teams for `{pii_id: 1}` + `{phone: 1}` and `{user_id: 1, event_name: 1, created_at: -1}` is listed for scale (section 11).
- Nearby stores (`GET /kkd-activity/stores`): the partner's signup point (`vistaar_v2_agents.location`), else the centre of `profile.pincode ?? preview.pincode`; stores with a map point within `STORE_RADIUS_KM = 50`.
- Never writes.

---

## 6. Cart, draft orders, orders, products

Sources read: src/modules/cart/schemas/cart.schema.ts, cart/repositories/cart.repository.ts, cart/cart.domain.ts; draft-order/schemas/draft-order.schema.ts, draft-order/repositories/draft-order.repository.ts (+ customer-lookup.repository.ts collection list), draft-order/draft-order.domain.ts; orders/schemas/order.schema.ts, orders/schemas/order-id.schema.ts, orders/repositories/order.repository.ts, orders/repositories/order-id.repository.ts, orders/repositories/product-lookup.repository.ts, orders/services/order-id.service.ts, orders/orders.domain.ts; spine/repositories/org-counter.repository.ts; docs/DATABASE.md (carts, draft_orders, app_counters, vistaar_v2_order_ids, orders_v2/products_v2 rows); docs/PROD-CHECKLIST.md (carts, draft_orders, orders_v2/products_v2, order numbers, go-live items).

### `carts`  (src/modules/cart/schemas/cart.schema.ts; owner: B2B Sales)

- **Access:** read + write (shared; Vistaar rows only). Module: `cart` (`CartRepository`).
- **Schema options:** `@Schema({ collection: 'carts', timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })`. Default version key `__v` (kept; used as compare-and-set counter). No `index:` / `schema.index()` (CLAUDE.md rule 7).
- **`_id`:** `ObjectId`, derived from the partner id (`activeCartId`):
  ```ts
  const hex = createHash('sha256')
    .update(`${CART_SOURCE}:active-cart:${partnerId}`)   // 'vistaar:active-cart:VST-…'
    .digest('hex');
  return new Types.ObjectId(hex.slice(0, 24));
  ```
  The partner appears nowhere else on the row; "one cart per partner" rests on the built-in `_id` index.
- Constant: `CART_SOURCE = 'vistaar'`.

| Field | Type | Required | Default | Enum / validation | Notes |
|---|---|---|---|---|---|
| `_id` | ObjectId | — | derived | — | **Vistaar writes** `activeCartId(partnerId)` |
| `source` | String | yes | `'vistaar'` | — | **Vistaar writes** `'vistaar'` |
| `pii_id` | String | yes | — | — | **Vistaar writes** farmer `PII-n`, or partner's own `pii_id` for shop stock |
| `items` | [CartLine] | — | `[]` | max 100 lines (`MAX_LINES`, domain) | see sub-table |
| `subtotal` | Number | — | 0 | — | **Vistaar writes** Σ line totals |
| `tax` | Number | — | 0 | — | Kept at 0 (never set by Vistaar writes) |
| `discount` | Number | — | 0 | — | Kept at 0 |
| `total` | Number | — | 0 | — | **Vistaar writes** = subtotal |
| `created_at` / `updated_at` | Date | — | timestamps | — | Mongoose |
| `__v` | Number | — | 0 on create | — | Compare-and-set counter (`CartRecord` type) |
| `user_id` | (not declared) | — | — | — | `$unset` on every update (legacy rows before 2026-10-09) |

**`items[]` — `CartLine`** (sub-schema via `SchemaFactory`, so Mongoose gives each line its own `_id` ObjectId). Values from `lineFrom()`:

| Field | Type | Required | Default | Validation | Vistaar value |
|---|---|---|---|---|---|
| `product_id` | String | yes | — | — | `variant.product_id` (bulk_sku) |
| `sku` | String | yes | — | — | pack sku (line key) |
| `product_name` | String | yes | — | — | catalogue name |
| `product_image` | String | no | — | — | omitted when catalogue has none |
| `price` | Number | yes | — | — | dealer price at write |
| `quantity` | Number | yes | — | capped `min(qty, available_qty, 9999)` (`MAX_QUANTITY = 9_999`) | — |
| `total` | Number | yes | — | — | `money(price × quantity)` |
| `gst` | Number | — | 0 | — | `variant.gst` |
| `moq` | Number | — | 1 | — | `variant.moq` |
| `packaging_size` | String | yes | — | — | pack weight string e.g. `'0.92'` |
| `packaging_type` | String | — | `''` | — | `''` |
| `uom` | String | yes | — | — | `variant.uom` |
| `requested_weight` | Number | — | 0 | — | `0` |
| `item_type` | String | — | `'bulk'` | — | `'bulk'` |
| `packaging_sku` | String\|null | — | null | — | `null` |
| `is_custom_packaging` | Boolean | — | false | — | `false` |

- **Indexes:** none declared; relies only on `_id`. PROD-CHECKLIST: nothing to build; if sharded, `{ _id: "hashed" }`.
- **Writes:**
  - Insert (`insertActive`): `create({ _id: activeCartId, source: 'vistaar', items, subtotal, total, pii_id })`; duplicate key `11000` → returns false (caller re-reads, retries).
  - Update (`updateActive`): `updateOne({ _id, source: 'vistaar', __v: version }, { $set: {items, subtotal, total, pii_id}, $unset: { user_id: 1 }, $inc: { __v: 1 } }, { strict: false })`; `matchedCount === 1` else stale.
  - No upsert, no delete.
- **Reads:** `findActive` = `findOne({ _id, source:'vistaar' }).lean()`. `adminList(ids)` = `{ _id: {$in: ids}, source: 'vistaar', 'items.0': {$exists: true} }`, sort `{ updated_at:-1, _id:-1 }`, skip/limit + countDocuments.
- **Rules:** every filter = `_id` + `source`. No `user_id`, no Vistaar-only fields. MRP, pack label, item count not stored.

### `draft_orders`  (src/modules/draft-order/schemas/draft-order.schema.ts; shared: B2B order portal `deal`/`customer`, Sankalp `sankalp`)

- **Access:** read + write (Vistaar rows only). Module: `draft-order` (`DraftOrderRepository`; `CustomerLookupRepository` reads `piis`, `leads_v2`, `contacts_v2` only).
- **Schema options:** `collection: 'draft_orders'`, `timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }`, `minimize: false`. Default `__v`. No index declarations.
- **`_id`:** auto ObjectId. Business id `draft_order_id = 'DFT-' + count` (`draftOrderId(count)`), count from `app_counters`.
- Constants: `DRAFT_ENTRY_PATH = 'vistaar'`; `DRAFT_STATUSES = ['draft','converted']`.

| Field | Type | Required | Default | Enum / validation | Vistaar writes |
|---|---|---|---|---|---|
| `draft_order_id` | String | yes | — | — | `DFT-n` |
| `agent_id` | String | yes | — | — | partner `VST-` id |
| `deal_id` | String\|null | — | null | — | `null` |
| `contact_id` | String\|null | — | null | — | `contacts_v2.contact_id` (`C0-n`) or `null` |
| `customer_name` | String\|null | — | null | — | customer name; `null` = own stock |
| `contact_number` | String\|null | — | null | — | phone; `null` = own stock |
| `status` | String | yes | — | `draft`/`converted` | `'draft'` on insert |
| `order_id` | String\|null | — | null | — | `null` |
| `form_data` | Object (DraftFormData) | yes | — | — | `formDataFor(customer, products)` |
| `entry_path` | String | yes | `'vistaar'` | — | `'vistaar'` |
| `grand_total` | Number | — | 0 | — | `money(Σ products[].total)` |
| `reminder_sent` | Boolean | — | false | — | `false` on insert/replace; `true` via markReminderSent (Vistaar-only field) |
| `created_at`/`updated_at` | Date | — | timestamps | — | — |
| `__v` | Number | — | 0 | — | `$inc` on replace |

**`form_data` (DraftFormData)** — values from `formDataFor()`:

| Field | Type | Vistaar value |
|---|---|---|
| `customerType` | string\|null | `'farmer'`, or `null` for own stock |
| `orderId` | string | `''` |
| `leadId` | string | `customer.lead_id ?? ''` |
| `customerName` | string | `customer.name ?? ''` |
| `businessName` | string | same as customerName |
| `contactNumber` | string | `customer.phone ?? ''` |
| `email`, `gstNumber` | string | `''` |
| `shippingAddresses` | DraftAddress[] | `[emptyAddress('Primary')]` |
| `billingAddress` | DraftAddress | `emptyAddress('Billing')` |
| `sameAsBilling` | boolean | `true` |
| `profileData` | Record<string, never> | `{}` |
| `orderType` | string | `'new'` |
| `customization` | object | see below |
| `products` | DraftProduct[] | `productsFrom(lines)` |
| `priceType` | string | `''` |
| `transportMode` | string | `'delivery'` |
| `orderWeight`, `preferredCourier`, `notes`, `quotationId`, `discountCode`, `codeValue` | string | `''` |
| `codeType` | string\|null | `null` |
| `codeApplied` | boolean | `false` |
| `payment` | object | see below |

`DraftAddress` (`emptyAddress(label)`): `label` (`'Primary'`/`'Billing'`), `line1`,`line2`,`line3`,`city`,`state`,`pincode` = `''`, `country` = `'India'` (all string).

`customization`: `label`,`packaging`,`material`,`attachments` = `[]` (string[]); `otherComments`,`labelOther`,`packagingOther`,`materialOther` = `''`.

`payment`: `paymentMode` `''`; `suggestedPrepaid`,`confirmedPrepaid`,`advancePct`,`advanceAmount`,`codAmount`,`couponDiscount` = `0`; `prepaidAcceptable`,`termsAccepted`,`otpVerified` = `false`; `utrInfo`,`rtgsPayments` = `[]`; `couponCode`,`otpCode` = `''`.

`products[]` (DraftProduct, `productsFrom()`):

| Field | Type | Value |
|---|---|---|
| `id` | string | `sku` |
| `productName` | string | `product_name` |
| `variant` | string | `size_label` |
| `sku` | string | `sku` |
| `quantity` | number | line qty |
| `unitPrice` | number | live price |
| `mrp` | number | mrp |
| `gstPercent` | number | gst |
| `discount` | number | `0` |
| `total` | number | `line_total` |
| `weight` | number | `0` |
| `inStock` | boolean | `available` |
| `_source` | `'products'` | `'products'` |
| `imageUrl` | string? | only when `product_image` present |

- **Indexes:** none declared. Relied on (existing): `draft_order_id` (unique), `agent_id`, `status`. PROD-CHECKLIST: at scale ask B2B for `{ entry_path: 1, status: 1, updated_at: -1 }`.
- **Writes:**
  - Insert: `create({ draft_order_id, agent_id, deal_id: null, status: 'draft', order_id: null, entry_path: 'vistaar', reminder_sent: false, contact_id, customer_name, contact_number, form_data, grand_total })`.
  - Replace: `findOneAndUpdate({ agent_id, entry_path:'vistaar', status:'draft', draft_order_id }, { $set: { ...data, reminder_sent: false }, $inc: { __v: 1 } }, { returnDocument: 'after' })` — no `__v` compare in the filter.
  - markReminderSent: same filter, `$set: { reminder_sent: true }`.
  - Delete: `deleteOne` same filter.
  - No upsert.
- **Reads:** `findOpen(partner, {contact_number, customer_name})` sort `updated_at:-1`; `findOne` by `draft_order_id`; `list` sort `{updated_at:-1,_id:-1}` + count; `adminList` `{ entry_path:'vistaar', status:'draft', [agent_id] }`.
- **Rules:** partner filter always `agent_id` + `entry_path: 'vistaar'` + `status: 'draft'`. "This customer's draft" = same `contact_number` + `customer_name` (both `null` for own stock).

### `app_counters` row `_id: 'draft_orders'`  (no schema; raw `connection.collection('app_counters')`; owner: shared B2B/Sankalp)

- Access: write one row only. Module: `draft-order` (`DraftOrderRepository.nextCount`).
- Fields touched: `_id` String `'draft_orders'`; `count` Number; `updated_at` Date.
- Write: `findOneAndUpdate({ _id: 'draft_orders' }, { $inc: { count: 1 }, $set: { updated_at: new Date() } }, { returnDocument: 'after', projection: { count: 1 } })`. Never upserted; missing row → `null` (API 503 `DRAFT_ID_UNAVAILABLE` per PROD-CHECKLIST).

### `orders_v2`  (src/modules/orders/schemas/order.schema.ts — mirror of Stockship's schema; owner: Stockship)

- **Access:** read only. Module: `orders` (`OrderRepository`). The same rows are also read by `commission` (`CommissionOrderRepository`, raw aggregation — see section 7) and `kkd-activity` (the held farmers' own MKTP-2 / 3 / 4 orders, raw `connection.collection`).
- **Schema options:** `collection: 'orders_v2'`, `timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }`, `versionKey: false`, `autoIndex: false`, `strict: false`.
- **`_id`:** ObjectId (Stockship's). Business id `order_id` (`KSK-341382` style; Vistaar's own numbers `KSV-n`, see `vistaar_v2_order_ids` below).
- Constant `VISTAAR_MARKETPLACE = 'MKTP-5'` (replaced `VISTAAR_ORDER_SOURCE = 'vistaar'`). Vistaar order = `marketplace: 'MKTP-5'` + `agent: <VST id>`. Not `source`: the app's orders reach Stockship with `source: 'MKTP-5'`; Stockship keeps that id in `marketplace` and rewrites `source` / `sub_source` from its `marketplaces_v2` row, so `source` never reads `vistaar`.

All `@Prop`s are optional unless noted; no defaults except `marketplace` (`null`); no enums.

| Field | Type | Notes |
|---|---|---|
| `order_id` | String, **required** | unique across channels |
| `date` | Date | placed at; sort/filter key |
| `pii_id` | String | buyer (farmer, or partner's own for shop stock) |
| `customer` | {first_name, last_name, phone, gst_number: String} | |
| `customer_type` | String | |
| `billing_address`, `shipping_address` | Address | see sub-table |
| `alternate_address` | Address + `primary` Boolean | |
| `payment_mode` | String | `cod`/`prepaid`/`partial`/`credit` (comment) |
| `currency_code` | String | |
| `exchange_rate` | Number | |
| `items` | [Item] | see sub-table |
| `total_weight`, `total_amount`, `original_total_amount`, `cod_amount`, `prepaid_amount` | Number | |
| `discounts` | [{discount_amount Number, discount_code String, discount_percent Number}] | |
| `coin` | Number | |
| `extra_charges` | {delivery_charge, small_cart_charge, cod_charge: Number} | not in Stockship schema, set by writers |
| `order_type` | String | `new_order`/`replacement_order`/`new_replacement_order`/`penalty_order` |
| `filter` | String | `b2b`/`b2c` any case |
| `order_status` | String | not an enum; see mapping |
| `order_status_map` | [{stage_name String, timestamp Date, user String}] | history |
| `marketplace` | String\|null | default `null`; `MKTP-5` on every order this service reads (the Vistaar filter) |
| `source` | String | Stockship's channel type, set from its `marketplaces_v2` row — not `vistaar` |
| `sub_source` | String | |
| `agent` | String\|null | partner `VST-` id |
| `created_by`, `invoice_number`, `reference_id`, `notes`, `go_invoice_number`, `deal_id`, `deal_code`, `quotation_id` | String | |
| `booking_details` | object | awb_number, booking_courier, shipping_label, b2b_shipping_label, pseudo_shipping_label, delhivery_job_id, delhivery_lr_number, delhivery_doc_waybill, ewaybill, ewaybill_job_id, courier_status (String); previous_awb_number, child_awbs ([String]); is_cross_dock (Boolean); freight_charges_applied (Number) |
| `warehouse` | {warehouse_id String} | |
| `logistics_partner_rates` | [{courier String, charge Number}] | |
| `by_csv` | Boolean | |
| `bighaat_order` | {bighaat_order_id String, version Number} | |
| `payment_screenshots` | String, `select: false` | never read |
| `utr_infos` | [{utr_number String, amount Number, bank_name String, timestamp Date, un_linked Boolean}] | |
| `unpacked_items` | [{sku String, qty Number, case_qty Number, is_promotional Boolean}] | |
| `tracking_details` | {tracking_timestamp [{status String, date Date}], last_tracking_time Date, being_tracked Boolean} | |
| `outbound_order` | ObjectId | |
| `auto_confirm` | {attempted Boolean, condition String, validation_errors [String]} | |
| `mrv_check`, `rca` | Boolean | |
| `merged` | {status Boolean, orders [String]} | |
| `is_customized` | {status Boolean, message String, timestamp Date, user String} | |
| `is_mistake` | {status Boolean, chats ObjectId} | |
| `user_messages` | [{stage String, message String, user String, timestamp Date}] | |
| `failure_message` | [{type String, message [String], timestamp Date}] | |
| `provisional_invoice` | {path String, timestamp Date} \| null | |
| `created_at`/`updated_at` | Date | timestamps |

Address (`ADDRESS`, all String): `address_id, first_name, last_name, phone, email, address1, address2, address3, city, pincode, state, state_code, country, country_code`.

Order line `items[]`: `sku` String, `qty` Number, `unit_price` Number, `total_price` Number, `is_combo` Boolean, `is_free` Boolean, `is_promotional` Boolean, `item_discount` String (TS type `string | number`).

- **Indexes:** none declared (`autoIndex: false`). Relied on (Stockship's): `{ agent, order_status, date }` (PROD-CHECKLIST: `{ agent: 1, order_status: 1, date: -1 }`); repository comment for `adminList` now cites `{ marketplace, order_status, date }` (ORDERS-HO.md still says `{ source, order_status, date }`; neither is in PROD-CHECKLIST); HO customers ride `{ pii_id }`. **No `order_id` index:** PROD-CHECKLIST asks Stockship for `{ order_id: 1 }` (unique if the data allows) — without it `takenNumbers` is a full scan (~3 s on beta's 534k orders) and so is Stockship's own duplicate check on create-order. This gap is beta's only: the production main DB already has a unique `order_id_1` (read-only check, 21 October 2026), so there the scan is a prefix index scan.
- **Writes:** none.
- **Projections:** `PROJECTION` = `order_id, date, pii_id, customer, shipping_address, payment_mode, items, total_amount, original_total_amount, cod_amount, prepaid_amount, discounts, coin, extra_charges, order_status, order_status_map, booking_details.awb_number, booking_details.booking_courier, created_at`. `ADMIN_PROJECTION` = PROJECTION + `agent`.
- **Read patterns:**
  - `ownFilter` = `{ agent: partnerId, marketplace: 'MKTP-5' }` on every partner read.
  - `searchFilter(OrderSearch)` (the app's `q`; HO's with `name` always null) — exactly one of: `{ order_id: <exact, upper case> }`; `{ 'customer.phone': { $regex: '<last ≤10 digits>$' } }`; or, for a name, `{ $and: [ per word { $or: [ { 'customer.first_name': /word/i }, { 'customer.last_name': /word/i } ] } ] }` (words regex-escaped). It only adds conditions beside `agent` / `marketplace`, never widens a filter.
  - `list`: ownFilter + optional `order_status $in`, `pii_id`, `date {$gte from, $lt to}` + `searchFilter`; sort `{date:-1,_id:-1}`; skips count when page is short.
  - `findOne`: ownFilter + `order_id`.
  - `customerStats`: aggregate `$match` (ownFilter, or `{marketplace:'MKTP-5'}` for HO) + `order_status $in statuses` + `pii_id` `$in`/`$type:'string'`; `$sort date:-1`; `$group` by `pii_id` (count, Σ `total_amount` ifNull 0, first `date`, first `order_status`).
  - `buyersBetween`: `distinct('pii_id', ownFilter + order_status $nin except + date [from,to))` (customers' `ordered_in`: except = `NOT_COUNTED` + every cancelled raw value).
  - `takenNumbers(prefix)` (order numbers): `find({ order_id: /^KSV-\d+$/ }, { _id: 0, order_id: 1 })` over **every** channel's orders (no `marketplace` filter); returns the numbers. Called once per process (at boot, again only after a failed read).
  - `adminFilter`: `marketplace:'MKTP-5'` + optional `agent`, `order_status $in`, `date`, `pii_id`, `payment_mode`, `shipping_address.state` (`^…$` regex, `i`) + `searchFilter` with `order_id` (exact) or `customer.phone` (ends-with regex) only. Used by `adminList` (sort date/_id desc + count), `adminSummary` ($facet by_status / distinct agents / distinct pii_id), `adminBreakdown` (status `$nin off` or `$in statuses minus off`; facets by IST day `+05:30`, top-10 partner, top-15 upper-trimmed state & city, per `items.sku` excluding `is_free`, repeat buyers n≥2).
  - `adminFindOne`: `{ marketplace:'MKTP-5', order_id }`.

**Raw `order_status` → app stage** (`RAW_STATUS` in `orders.domain.ts`; lookup normalised `trim().toLowerCase()`; unknown → `placed`, step via tracking falls to 0). Steps: 0 placed, 1 confirmed, 2 shipped, 3 out for delivery, 4 delivered, -1 off line. Since 2026-10-21 it also holds Stockship's V2 names (`status_v2`; Stockship's `order-status.const.ts`).

| Raw status | Stage | Step |
|---|---|---|
| created, new_order, ready_to_confirm, pending, inventory_short, processing, hod_pending, blocked, blocked_order, blocked_orders, pseudo, pseudo_order, split, nsz, non_servicable_zone, ambiguous | placed | 0 |
| confirmed, ready_to_invoice, ready_to_book, outbound_pending, ready_to_outbound, booked, ready_to_pick, picklist_assigned, picking, picked, ready_to_pack, packed, ready_to_check, sent_to_xd, ready_to_racked, received_from_xd, ready_to_rack, racked, booking_cancelled, ready_to_manifest, manifested, ready_to_dispatch | punched | 1 |
| dispatched, `in transit`, in_transit, ndr | shipped | 2 |
| out_for_delivery | shipped | 3 |
| delivered | delivered | 4 |
| cancel, cancelled, failed, outbound_cancelled, destroy, destroyed, lost, merged, merge | cancelled | -1 |
| rto, rto_initiated, `rto in transit`, rto_in_transit, rto_intransit, `rto received`, rto_received, rto_delivered, partially_rto, partial_rto | returned | -1 |

Changed since 17 October: `failed` moved placed → cancelled; `ready_to_check` moved placed → punched; added `new_order`, `inventory_short`, `hod_pending`, `blocked_order`, `blocked_orders`, `pseudo_order`, `ambiguous` (placed), `ready_to_invoice`, `picking`, `picked`, `sent_to_xd`, `ready_to_racked`, `received_from_xd`, `manifested` (punched), `outbound_cancelled`, `merge` (cancelled), `partial_rto` (returned).

Derived sets: `BUSINESS_STATUSES` = punched + shipped + delivered raw values; `NOT_AN_ORDER` = {failed, pseudo, pseudo_order}; `NOT_COUNTED` = `NOT_AN_ORDER` + {split, merged, merge}; `MARK_STATUSES` = delivered + cancelled + returned raw values. App stages: `placed, punched, shipped, delivered, cancelled, returned`. Tracking line labels: Order placed / Confirmed / Shipped / Out for delivery / Delivered (+ Cancelled / Returned off-line). Search id shape `ORDER_ID_PATTERN` = `/^[A-Z0-9][A-Z0-9_/-]{1,39}$/` (now in the domain; also the `:id` param check).

### `vistaar_v2_order_ids`  (src/modules/orders/schemas/order-id.schema.ts; `OrderId`; owner: Vistaar)

- **Access:** read + write (insert only). Module: `orders` (`OrderIdRepository`, used by `OrderIdService`).
- **Schema options:** `@Schema({ collection: 'vistaar_v2_order_ids', timestamps: { createdAt: 'created_at', updatedAt: false }, versionKey: false })`.
- **`_id`:** String `<agent_id>:<request_id>` (`attemptId`) — one number per checkout attempt rests on `_id` alone, so two racing copies of one request can never both keep a number, even where a declared index was never built.

| Field | Type | Required | Default | Enum / validation | Notes |
|---|---|---|---|---|---|
| `_id` | String | — | — | — | `<agent_id>:<request_id>` |
| `order_id` | String | yes | — | — | the number, `KSV-n` |
| `agent_id` | String | yes | — | — | the partner it was issued to (`VST-…`) |
| `request_id` | String | yes | — | UUID (checked on the DTO, `IsUUID('all')`) | the app's id for one checkout attempt |
| `created_at` | Date | — | timestamps | — | when first issued (`issued_at` in the API) |

- **Indexes:** `{ order_id: 1 }` (declared; support lookups "which attempt got this number" — not unique, uniqueness comes from the counter). PROD-CHECKLIST: `db.vistaar_v2_order_ids.createIndex({ order_id: 1 })`.
- **Writes:** `create({ _id, order_id, agent_id, request_id })`; duplicate key `11000` → `null` (a concurrent copy of the request won; the caller re-reads and returns the winner's number, its own `$inc` stays a gap). Never updated, **never deleted** — a number given out is never given again.
- **Reads:** `findByRequest` = `findById('<agent_id>:<request_id>').read('primary').lean()` (read from the primary: it follows a lost insert race).
- **Rules:** a `request_id` is only ever looked up together with the caller's own `agent_id`, so another partner's `request_id` never returns the number.

### `app_counters` row `_id: 'vistaar_orders'`  (schema `AppCounter`, `spine/schemas/app-counter.schema.ts`; `OrgCounterRepository`; owner: shared ko-sales `app_counters`)

- Access: write one row only, through `PiiService.tryNextOrgNumber('vistaar_orders')` (`OrgCounterKey` now `'addresses' | 'leads' | 'contacts' | 'vistaar_orders'`). Module: `orders` (`OrderIdService`) via `spine`.
- Fields touched: `_id` String `'vistaar_orders'`; `count` Number; `updated_at` Date.
- Write: `findOneAndUpdate({ _id: 'vistaar_orders' }, { $inc: { count: 1 }, $set: { updated_at: new Date() } }, { returnDocument: 'after' })` (`tryNext`). Never upserted; missing row → `null` → API 503 `ORDER_ID_UNAVAILABLE`.
- The row is created once by hand, `{ _id: 'vistaar_orders', count: 0, updated_at: new Date() }` (user's decision 2026-10-16: the series starts at `KSV-1`; PROD-CHECKLIST).
- Old numbers: the old Vistaar's `KSV-` orders are still in `orders_v2` (DATABASE.md: beta holds 127 of `KSV-1`…`KSV-271`; PROD-CHECKLIST: the last is from 2026-05-30). Each process reads them once (`takenNumbers`, above) into memory; a counter value already taken is skipped with another `$inc` (logged), at most 100 skips per call (`MAX_TAKEN_SKIPS`) → else 503. Numbers taken later by another writer would not be seen — PROD-CHECKLIST: nothing else may issue `KSV-` numbers.

### `products_v2`  (no schema; raw `connection.collection('products_v2')` in orders/repositories/product-lookup.repository.ts; owner: Stockship)

- Access: read only. Module: `orders` (`ProductLookupRepository.bySku`).
- Read: `find({ sku: { $in: uniqueSkus } }, { projection: { _id: 0, sku: 1, name: 1, hero_image: 1, images: { $slice: 1 }, variant: 1, item_qty: 1 } })`; empty input → no query.

| Field read | Type (as typed in code) | Use |
|---|---|---|
| `sku` | string | map key |
| `name` | string? | line name |
| `hero_image` | string? | `firstUrl()` keeps first URL (some rows concatenate two) |
| `images` | string[]? (first only) | |
| `variant` | {value?: string\|number, uom?: string} | `sizeLabel()` → `250 ML` |
| `item_qty` | string\|number? | multi-pack `× n` when > 1 |

- Index relied on: `sku` (PROD-CHECKLIST).

---

## 7. Commission and payments

Source: BETA (`5113b6c`) `src/modules/commission/**`, `src/modules/payments/**`, `src/modules/orders/orders.domain.ts`, `src/modules/onboarding/services/onboarding.service.ts` (bank-change flag read by the wallet), `docs/DATABASE.md`, `docs/PROD-CHECKLIST.md`. The commission, withdrawal, TDS and payment schemas, indexes and repositories are unchanged since `8f1f1c1`; what changed is the `orders_v2` filter (now `marketplace`), the withdrawal guard for a waiting bank change, and which fields a payment-credential row holds (Razorpay Key ID only, Cashfree keyless, mode chosen by HO).

### `vistaar_v2_commission_plans`  (`src/modules/commission/schemas/commission-plan.schema.ts`; `CommissionPlan`)

- Owner module: `commission`. Written by `CommissionPlanRepository` (`insert`, `update`, `remove`); read by the same (`all`, `findById`). The whole collection is read and held in memory by the service.
- Schema options: `collection: 'vistaar_v2_commission_plans'`, `timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }`, `versionKey: false`.
- `_id`: String, `<cohort>@<YYYY-MM>` — one plan per cohort and month by construction. Cohort is a partner type (e.g. `vistaar_agent`) or an earning cohort (`ec_…`).

| Field | Type | Required | Default | Enum / validation | Notes |
|---|---|---|---|---|---|
| `_id` | String | — | — | — | `<cohort>@<YYYY-MM>` |
| `cohort` | String | yes | — | — | partner type or `ec_…` earning cohort |
| `effective_from` | String | yes | — | — | IST month the plan starts, `YYYY-MM` |
| `kind` | String | no | `'slabs'` | `PLAN_KINDS = ['slabs','fixed']` | rows before 2026-10-16 have none: read as `slabs`. `fixed` = one rate, stored as one slab from ₹0 with no top |
| `slabs` | [Mixed] (`Slab[]`) | yes | — | — | see Slab |
| `min_order_value` | Number | no | `null` | — | ₹ of base an order needs to earn on this plan (earning cohorts only); below it the order earns the default earning cohort's plan; `null` = no minimum |
| `notes` | [String] | no | `[]` | — | |
| `draft` | Boolean | no | `true` | — | rates not signed off by HO; app shows "Draft" |
| `created_by` | String | yes | — | — | |
| `updated_by` | String | yes | — | — | |
| `history` | [Mixed] (`PlanChange[]`) | no | `[]` | — | oldest first; every earlier state |
| `created_at` / `updated_at` | Date | auto | — | — | timestamps |

`Slab` (commission.domain.ts):

| Field | Type | Notes |
|---|---|---|
| `from` | number | ₹ of delivered sales in the month, included |
| `to` | number \| null | excluded; `null` = no top |
| `rate` | number | % |

`PlanChange` (schema file):

| Field | Type | Notes |
|---|---|---|
| `at` | Date | |
| `by` | string | |
| `action` | `'created' \| 'updated'` | |
| `kind` | PlanKind, optional | absent on changes before plans had kinds |
| `slabs` | Slab[] | |
| `min_order_value` | number \| null, optional | |
| `notes` | string[] | |
| `draft` | boolean | |

- Indexes: none declared ("No index: the whole collection … is read and held in memory"). `_id` only.
- Write patterns:
  - `insert`: `create({...row, history: []})`; duplicate key (11000) → returns `false` (cohort already has a plan from that month).
  - `update(id, seen, set, before)`: `findOneAndUpdate({_id, updated_at: seen}, {$set: set, $push: {history: before}})` — optimistic on `updated_at`; settable fields `kind, slabs, min_order_value, notes, draft` + `updated_by`. `null` when changed or gone.
  - `remove(id, seen)`: `deleteOne({_id, updated_at: seen})`.
  - Reads: `find().sort({cohort:1, effective_from:1}).lean()`, `findById`.
- Lifecycle: a plan applies from its month until the next plan for that cohort starts. Partner type with no plan → PRD's built-in rates (shown as draft); earning cohort with none → default cohort's plan. Past months are locked (paid on) — enforced in the service, not in the repository (repo `remove` filters only `_id` + `updated_at`).
- Docs: DATABASE.md line 21 matches the code fields. Index list (line 80): "commission_plans: `_id` only (read whole)" — matches. PROD-CHECKLIST line 285: no new index needed — matches.

---

### `vistaar_v2_withdrawals`  (`src/modules/commission/schemas/withdrawal.schema.ts`; `Withdrawal`)

- Owner module: `commission`. Written/read by `WithdrawalRepository`.
- Schema options: `collection: 'vistaar_v2_withdrawals'`, timestamps `created_at`/`updated_at`, `versionKey: false`.
- `_id`: String `WD-000001` (series in `vistaar_v2_counters` per CLAUDE.md).

| Field | Type | Required | Default | Enum / validation | Notes |
|---|---|---|---|---|---|
| `_id` | String | — | — | — | `WD-000001` |
| `agent_id` | String | yes | — | — | partner `VST-` id |
| `amount` | Number | yes | — | — | whole ₹, before TDS |
| `status` | String | yes | — | TS type `WITHDRAWAL_STATUSES = requested, approved, paid, rejected, cancelled` (no Mongoose `enum`) | |
| `open` | Boolean (`true`) | no | — | — | `true` while requested/approved, else unset; drives partial unique index |
| `tds_rate` | Number | yes | — | — | %; set at request, fixed at approval |
| `tds_amount` | Number | yes | — | — | ₹ to the paisa |
| `net_amount` | Number | yes | — | — | |
| `account_last4` | String | no | `null` | — | last 4 of the form's bank account at request; never updated (an account change approved later does not change it) |
| `requested_at` | Date | yes | — | — | |
| `approved_at` | Date | no | `null` | — | |
| `approved_by` | String | no | `null` | — | |
| `paid_at` | Date | no | `null` | — | |
| `paid_by` | String | no | `null` | — | |
| `utr` | String | no | `null` | — | bank reference |
| `rejected_at` | Date | no | `null` | — | |
| `rejected_by` | String | no | `null` | — | |
| `rejection_reason` | String | no | `null` | — | |
| `cancelled_at` | Date | no | `null` | — | |
| `created_at` / `updated_at` | Date | auto | — | — | |

`OPEN_STATUSES = ['requested','approved']`.

- Indexes:
  - `{ agent_id: 1, requested_at: -1 }`
  - `{ status: 1, requested_at: 1 }`
  - `{ status: 1, paid_at: 1 }`
  - `{ agent_id: 1 }` `{ unique: true, partialFilterExpression: { open: true } }`
- Write patterns:
  - `insert`: `create(row)`; 11000 → `false` (partner already has an open one).
  - `transition(id, from[], to, set, agentId?)`: `findOneAndUpdate({_id, status: {$in: from}, [agent_id]}, {$set: {...set, status: to}, [$unset: {open: 1} when to ∉ OPEN_STATUSES]})`, `returnDocument: 'after'`. Conditional on current status.
  - Reads: `findById`, `forAgent` (sort `requested_at:-1`), `list` (filter status `$in` / agent_id / `paid_at` `$gte`/`$lt`; sort default `requested_at:-1` + `_id:1`, skip/limit + count), `all(filter, cap)` (sort `requested_at:1,_id:1`), `sums` (group by status: count, Σamount, Σtds_amount, Σnet_amount), `paidByAgent` (status `paid`, group by agent_id, sort, `$facet` page + count).
- Insert guard (service, `WalletService.request`, before `insert`): no new row while the partner's bank account change waits for HO — `vistaar_v2_onboarding_data.bank_change.status === 'pending'` (read as `bank_change_pending` through the onboarding service) → `409 BANK_CHANGE_PENDING`. Rows already requested / approved are not touched.
- Lifecycle: requested → approved → paid; requested/approved → rejected or cancelled. Never deleted (payment record). No delete method in repo.
- Docs: DATABASE.md line 22 and index line 81 match; PROD-CHECKLIST lines 103–106 (and the "unique partial first" note, line 204) match.

---

### `vistaar_v2_tds_certificates`  (`src/modules/commission/schemas/tds-certificate.schema.ts`; `TdsCertificate`)

- Owner module: `commission`. Written/read by `TdsCertificateRepository`.
- Schema options: `collection: 'vistaar_v2_tds_certificates'`, timestamps `created_at`/`updated_at`, `versionKey: false`.
- `_id`: String `<agent_id>:<quarter>` (`certificateId()`).

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `_id` | String | — | — | `<agent_id>:<quarter>` |
| `agent_id` | String | yes | — | |
| `quarter` | String | yes | — | e.g. `FY2026-Q2` (no validator in schema) |
| `path` | String | yes | — | private PDF in org bucket |
| `uploaded_by` | String | yes | — | |
| `created_at` / `updated_at` | Date | auto | — | |

- Indexes: `{ quarter: 1, agent_id: 1 }`.
- Write patterns:
  - `put`: `findOneAndUpdate({_id}, {$set: {path, uploaded_by}, $setOnInsert: {agent_id, quarter}}, {upsert: true, returnDocument: 'before'})` → returns previous `path` so its file can be removed.
  - `remove`: `findOneAndDelete({_id})` → returns the removed row (file deleted too).
  - Reads: `find` (by `_id`), `forAgents` (`_id $in`), `list` (`{quarter, [agent_id]}` sort `agent_id:1`, skip/limit + count).
- Lifecycle: one per partner per quarter; replaced by re-upload; deleted by HO with its file.
- Docs: DATABASE.md line 23, index line 82, PROD-CHECKLIST line 107 match.

---

### `vistaar_v2_payment_options`  (`src/modules/payments/schemas/payment-option.schema.ts`; `PaymentOption`)

- Owner module: `payments`. Written/read by `PaymentOptionRepository`.
- Schema options: `collection: 'vistaar_v2_payment_options'`, timestamps `created_at`/`updated_at`, `versionKey: false`.
- `_id`: String, enum `PAYMENT_PROVIDERS = ['razorpay','cashfree','phonepe']`.

| Field | Type | Required | Default | Enum / validation | Notes |
|---|---|---|---|---|---|
| `_id` | String | — | — | `PAYMENT_PROVIDERS` | provider |
| `label` | String | yes | — | — | |
| `hint` | String | no | `null` | — | |
| `is_active` | Boolean | no | `false` | — | |
| `order` | Number | no | `0` | — | lower first |
| `cohorts` | [String] | no | `[]` | — | empty = every partner |
| `version` | Number | no | `1` | — | optimistic lock |
| `updated_by` | String | no | — | — | |
| `created_at` / `updated_at` | Date | auto | — | — | |

- Indexes: none ("Three rows at most, read whole — `_id` is the only index needed").
- Write patterns:
  - `save(id, version, set, by)`: `version === 0` → `create` with `PROVIDER_DEFAULTS[id]` label/hint/order, `is_active: false`, `cohorts: []`, `...set`, `version: 1`, `updated_by`; 11000 → `null`. Else `findOneAndUpdate({_id, version}, {$set: {...set, updated_by}, $inc: {version: 1}})`; `null` = changed. Patchable: `label, hint, is_active, cohorts`.
  - `reorder(ids, by)`: `bulkWrite` of `updateOne({_id}, {$set: {order: index, updated_by}, $inc: {version: 1}, $setOnInsert: {label, hint (defaults), is_active: false, cohorts: []}}, upsert: true)`.
  - Reads: `listAll`, `find(id)`.
- Lifecycle: no row = off; row written at HO's first save; no delete method.
- Cashfree's row is the same shape: it is keyless (`KEYLESS_PROVIDERS` in `payments.domain.ts`, KO Utils holds its keys), so `is_active: true` alone puts it on the app's list — no `vistaar_v2_payment_credentials` row is needed or accepted for it. The row never holds a key, secret or URL for any provider.
- Docs: DATABASE.md line 43 matches. PROD-CHECKLIST 270: "needs none" — matches.

---

### `vistaar_v2_payment_option_audit`  (`src/modules/payments/schemas/payment-option-audit.schema.ts`; `PaymentOptionAudit`)

- Owner module: `payments`. Written by `PaymentOptionRepository.log` (`create`); read by `auditPage`.
- Schema options: `collection: 'vistaar_v2_payment_option_audit'`, `versionKey: false`, **no timestamps**.
- `_id`: String UUID.

| Field | Type | Required | Default | Enum / validation | Notes |
|---|---|---|---|---|---|
| `_id` | String | — | — | — | UUID |
| `option_id` | String | yes | — | — | provider, or `*` for a reorder |
| `action` | String | yes | — | `update, reorder, credentials_submitted, credentials_tested, credentials_approved, credentials_rejected, credentials_revoked` | |
| `before` | Mixed | no | `null` | — | |
| `after` | Mixed | yes | — | — | |
| `by` | String | yes | — | — | HO SSO email |
| `at` | Date | yes | — | — | |

- Indexes: `{ at: -1 }`; `{ option_id: 1, at: -1 }`.
- Write patterns: insert-only (`create`), never updated or deleted. Credential rows carry ids and masked values only, never a secret.
- Reads: `auditPage(optionId?, skip, limit)` sort `at:-1` + count.
- Docs: DATABASE.md line 45, PROD-CHECKLIST 98–99 match.

---

### `vistaar_v2_payment_credentials`  (`src/modules/payments/schemas/payment-credential.schema.ts`; `PaymentCredential`)

- Owner module: `payments`. Written/read by `PaymentCredentialRepository`.
- Schema options: `collection: 'vistaar_v2_payment_credentials'`, timestamps `created_at`/`updated_at`, `versionKey: false`.
- `_id`: String UUID.

| Field | Type | Required | Default | Enum / validation | Notes |
|---|---|---|---|---|---|
| `_id` | String | — | — | — | UUID |
| `provider` | String | yes | — | `PAYMENT_PROVIDERS = razorpay, cashfree, phonepe` | schema enum still lists `cashfree`, but no new Cashfree set is accepted (submit → `400 CREDENTIALS_NOT_USED`) |
| `mode` | String | yes | — | `CREDENTIAL_MODES = test, live` | HO's pick on any server (user's decision, 2026-10-16); never read from the key — a `rzp_live_` Key ID may sit under `test` |
| `status` | String | yes | — | `CREDENTIAL_STATUSES = pending, approved, active, superseded, revoked, rejected, expired` | |
| `public_fields` | Mixed `Record<string,string>` | yes | — | — | non-secret ids, shown in full: Razorpay `{key_id}`, PhonePe `{client_id, client_version}`. The active Razorpay `key_id` is what `GET /payment-options` hands the app |
| `secrets` | Mixed `Record<string, SealedValue>` \| null | no | `null` | — | sealed; PhonePe `{client_secret}`; Razorpay has none — the empty object is not stored, so the field is **missing** on a Razorpay row until it is retired; set to `null` on retire/reject/expire (`null` = wiped, missing = nothing to open) |
| `masked` | Mixed `Record<string,string>` | yes | — | — | `••••abcd` per secret; **missing** on a Razorpay row (empty object not stored) — every reader treats it as `{}` |
| `note` | String | no | `null` | — | |
| `submitted_by` | String | yes | — | — | |
| `expires_at` | Date | yes | — | — | `PENDING_TTL_MS` = 24 h |
| `test` | Mixed `CredentialTest` \| null | no | `null` | — | |
| `decided_by` | String | no | `null` | — | |
| `decided_at` | Date | no | `null` | — | |
| `reason` | String | no | `null` | — | |
| `activated_at` | Date | no | `null` | — | |
| `retired_at` | Date | no | `null` | — | |
| `retired_by` | String | no | `null` | — | |
| `created_at` / `updated_at` | Date | auto | — | — | |

`SealedValue` (`providers/credential-cipher.ts`): `kid` (string, which env key sealed it), `iv` (string), `tag` (string), `ct` (string). IV is 12 random bytes.

`CredentialTest`: `ok` boolean, `message` string, `by` string, `at` Date.

- Indexes:
  - `{ provider: 1 }` `{ unique: true, name: 'one_active_per_provider', partialFilterExpression: { status: 'active' } }`
  - `{ provider: 1, status: 1 }` `{ unique: true, name: 'one_pending_per_provider', partialFilterExpression: { status: 'pending' } }`
  - `{ provider: 1, created_at: -1 }`
- Write patterns (every non-decrypt read uses projection `{ secrets: 0 }`):
  - `insertPending`: `create(row)`; 11000 → `null` (provider already has a pending set). Returned object has `secrets: null`.
  - `setTest`: `{_id, status: 'pending'}` → `$set {test}`.
  - `claimApproval` (step 1): `{_id, status: 'pending', expires_at: {$gt: now}, submitted_by: {$ne: by}, 'test.ok': true}` → `$set {status: 'approved', decided_by, decided_at}`.
  - `retireActive` (step 2): `updateOne({provider, status: 'active', [_id: {$ne: exceptId}]}, $set retire(status ∈ superseded|revoked, by, reason))`.
  - `promote` (step 3): `{_id, status: 'approved'}` → `$set {status: 'active', activated_at}`.
  - `reject`: `{_id, status: {$in: ['pending','approved']}}` → `$set {...retire('rejected', by, reason), decided_by, decided_at}`.
  - `expire`: `updateOne({_id, status: 'pending', expires_at: {$lte: now}}, $set retire('expired', 'system', 'Not approved within 24 hours'))`.
  - `retire()` sets `{status, secrets: null, retired_at: new Date(), retired_by, reason}` — **secrets nulled** on superseded, revoked, rejected, expired.
  - Reads: `find` (no secrets), `findSealed`, `activeSealed(provider)` (with secrets), `current()` (status in active/pending/approved, no secrets), `history(provider)` (sort `created_at:-1`, skip/limit + count), `approving(provider)` (`exists status: 'approved'`).
  - `current()` also feeds a per-process copy (≤ 60 s) of the active rows' `mode` and `public_fields` per provider — the app's option list and Razorpay `key_id` come from it; no secret is in that copy.
- Submit writes no row for Cashfree (refused before any write); a Razorpay row is inserted with `public_fields: {key_id}` and no stored `secrets` / `masked`. No repository or index change came with these rules.
- Lifecycle: pending → (test) → approved → active → superseded/revoked; pending/approved → rejected; pending → expired after 24 h. Never deleted (no delete method). Cashfree rows written before it went keyless (if any) stay as history; the options screen ignores them (`keys_required: false`, `mode: null`).
- Docs: DATABASE.md line 44, PROD-CHECKLIST 100–102 match the indexes. CLAUDE.md (*Payment keys*) matches: HO picks test or live on any server; Razorpay takes the Key ID alone.
- DISCREPANCY: DATABASE.md line 44 and schema comment say secrets are `null` "once not pending/active"; code keeps secrets on `approved` too (claimApproval and promote do not touch `secrets`) — consistent only if `approved` counts as on the way to active.
- DISCREPANCY: DATABASE.md line 44 still gives `public_fields{}` as "(Key ID, App ID…)" — App ID is Cashfree's, which takes no keys any more — and does not say that a Razorpay row has no `secrets` / `masked` stored. Neither DATABASE.md nor CLAUDE.md mentions Cashfree being keyless (PAYMENTS-HO.md / PAYMENTS-APP.md do).

---

### `orders_v2` — read by commission (aggregation only)  (`src/modules/commission/repositories/commission-order.repository.ts`; `CommissionOrderRepository.factsFor`)

- Owner: Stockship. Read-only via `connection.collection('orders_v2').aggregate`. Never written here.
- Stage 1 `$match`:
  - `agent: <agentId>` (partner `VST-` id)
  - `marketplace: 'MKTP-5'` (`VISTAAR_MARKETPLACE`) — was `source: 'vistaar'` at `8f1f1c1`. The app's orders reach Stockship with `source: 'MKTP-5'`; Stockship keeps that id in `marketplace` and rewrites `source` / `sub_source` from its `marketplaces_v2` row, so `source` never reads `vistaar`.
  - `order_status: { $nin: [...NOT_COUNTED] }` where `NOT_COUNTED = {'failed', 'pseudo', 'pseudo_order', 'split', 'merged', 'merge'}` (`NOT_AN_ORDER` = failed / pseudo / pseudo_order, plus split / merged / merge — `pseudo_order` and `merge` are Stockship V2 names added since `8f1f1c1`). Raw value match (no normalising in the DB stage).
- Stage 2 `$project`:
  - `_id: 0`, `order_id`, `date`, `created_at`, `pii_id`, `order_status`, `coin`
  - `first_name: '$customer.first_name'`, `last_name: '$customer.last_name'`
  - `items`: `$map` over `$ifNull: ['$items', []]` → `{ sku: '$$i.sku', qty: '$$i.qty', total: '$$i.total_price', free: '$$i.is_free' }`
  - `discount: { $sum: '$discounts.discount_amount' }`
  - `marks`: `$filter` of `$ifNull: ['$order_status_map', []]` where `toLower(trim(stage_name ?? ''))` ∈ `MARK_STATUSES` (raw statuses of stages delivered + cancelled + returned; the status map now also reads `failed`, `outbound_cancelled`, `merge` as cancelled and `partial_rto` as returned, so those are in the list too)
  - `last_at: { $max: '$order_status_map.timestamp' }`
- Mapped in code to `OrderFact`: `placed_at = date ?? created_at ?? new Date(0)`, `customer_name = personName(first, last)`, lines with non-finite numbers → 0, `deduction = discount + coin`, plus `markTimes(marks, order_status, last_at ?? placed_at)`.
- Index relied on: Stockship's `{ agent, order_status, date }` (code comment).
- Docs: COMMISSION-LOGIC.md ("marketplace MKTP-5") and PROD-CHECKLIST line 209 (commission only for `marketplace: 'MKTP-5'` + the partner's `VST-` id in `agent`) match the code; PROD-CHECKLIST 211 "Nothing to build in `orders_v2`".
- DISCREPANCY: DATABASE.md line 303 still says "one aggregation on `{ agent, source }`" with `order_status $nin` "failed / pseudo / split / merged"; code's `$match` is `{ agent, marketplace: 'MKTP-5', order_status $nin }` and the `$nin` list also holds `pseudo_order` and `merge`. (DATABASE.md's `orders_v2` row for the orders module itself was updated to `marketplace: 'MKTP-5'`; the commission row was not.)
- DISCREPANCY: code excludes statuses by raw `$nin`, while `isCounted()` in orders.domain normalises the status first — a differently spelled/cased `failed`/`split` would pass the DB filter (code-internal inconsistency, not a doc one).

---

## 8. Content: stories, banners, events, FAQs, info pages, terms

**Conventions (content collections).** Every `vistaar_v2_*` schema below uses `@Schema({ collection: '<explicit name>', timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }, versionKey: false })`. The exception is `vistaar_v2_event_registrations`, which sets `updatedAt: false`. `_id` is declared `@Prop({ type: String })`, so there are no ObjectIds. It holds a UUID, a natural key, or a composite string. HO-written rows carry `created_by` / `updated_by` as `String` with no `required` and no default. `Localized` = `Record<string, string>` (from `onboarding/form.domain.ts`) and is stored as `SchemaTypes.Mixed`. Reads are `.lean()`. HO updates go through `findOneAndUpdate({_id}, {$set}, {returnDocument:'after'})`. HO pages sort on `{...sort, _id: 1}` (banners use `sort` alone) with `countDocuments` beside it. `terms_and_conditions` is shared and does not follow these options (see its section). Since the rewards merge (2026-10-21) two writes here also call `RewardsService`, which may insert rows in `vistaar_v2_rewards` (section 9A): a brand-new My Story (`story_created`) and a taken event seat (`event_registered`). None of the content schemas changed for it. As of beta `5113b6c`, checked against `docs/DATABASE.md` and `docs/PROD-CHECKLIST.md`.

### `vistaar_v2_stories`  (src/modules/stories/schemas/story.schema.ts; `Story`)
- Owner module: stories. Written by the Vistaar app (`StoriesService`: save, share, delete) and by HO (`AdminStoriesService` delete). Read by the app (own list) and HO (`page` filtered by `agent_id` / `template`).
- Options: common. `_id`: String UUID.

| Field | Type | Required | Default | Enum / validation | Notes |
|---|---|---|---|---|---|
| `_id` | String | – | – | – | UUID |
| `agent_id` | String | yes | – | – | partner `VST-` id, from the token |
| `signature` | String | yes | – | – | `signatureOf(config, photo_path)`: SHA-256 hex of the canonical config + photo path (selection left out) |
| `template` | String | yes | – | `STORY_TEMPLATES`: product, testimonial, tip, meeting, festival, custom | |
| `lang` | String | yes | – | `STORY_LANGS`: hi, en | |
| `theme` | String | yes | – | – | a design key (`StoryTheme = string`). Built-in: green, harvest, earth, sky |
| `fields` | Mixed (`StoryFields`) | yes | – | – | see sub-table |
| `card` | String | no | null | – | key of an HO custom card; null = the layout's own card |
| `show_whatsapp` | Boolean | no | true | – | |
| `photo_mode` | String | no | 'inset' | `PHOTO_MODES`: background, inset | |
| `selection` | Mixed (`StorySelection`) | no | null | – | see sub-table |
| `image_path` | String | yes | – | – | finished 9:16 image, private, under `vistaar/stories/<agent_id>/` |
| `image_width` / `image_height` | Number | no | null | – | |
| `photo_path` | String | no | null | – | the partner's own photo |
| `share_count` | Number | no | 0 | – | |
| `last_shared_at` | Date | no | null | – | |
| `last_used_at` | Date | yes | – | – | list order |
| `created_at` / `updated_at` | Date | – | – | – | timestamps |

`fields` (`StoryFields`)

| Field | Type |
|---|---|
| `emoji`, `headline`, `body`, `detail1`, `detail2`, `detail3`, `price`, `mrp` | string |
| `stars` | number |

`selection` (`StorySelection`)

| Field | Type |
|---|---|
| `product_id`, `testimonial_id`, `crop_id`, `meeting_key`, `festival` | string |
| `stage_idx` | number |

- Indexes: `{ agent_id: 1, signature: 1 }` unique; `{ agent_id: 1, last_used_at: -1 }`.
- Write patterns:
  - Save: `findOneAndUpdate({agent_id, signature}, {$set: {...content, last_used_at: now}, $setOnInsert: {_id, share_count: 0, last_shared_at: null}}, {upsert: true})`. On duplicate key (11000) it retries once. `created` = (returned `_id` === the new id).
  - After a save that `created` a row: `trim()` (below), then `RewardsService.storyCreated(agent_id, story._id, template)` — reward id `story_created:<story _id>:<kind>`, `ref_id` = the story's `_id`; an edit or re-share of a saved story never fires it.
  - Share: `findOneAndUpdate({_id, agent_id}, {$inc: {share_count: 1}, $set: {last_shared_at: now, last_used_at: now}})`.
  - Eviction: after a save, `trim()` runs `beyond(agentId, MAX_SAVED_STORIES = 20)` (find by agent, sort `{last_used_at:-1, _id:1}`, skip 20). It then runs `deleteMany({agent_id, _id: {$in}})` and deletes the image and photo files (`dropFiles`).
  - Delete: `deleteOne({_id, agent_id})`, by the partner or by HO. `countUsing(agent_id, path)` checks image/photo use before a file is removed.
  - Every partner read and write filters on `agent_id`.
- Lifecycle: upserted by signature, so a re-save moves the row to the top. Capped at 20 per partner, with the oldest deleted along with their files.

### `vistaar_v2_story_stats`  (src/modules/stories/schemas/story-stat.schema.ts; `StoryStat`)
- Owner module: stories. Written by `StoriesService` on save and share (`bump`). Read by HO aggregations (`perDay`, `totals`, `perPartner`) and `forPartner`.
- Options: common. `_id`: String `<agent_id>:<YYYY-MM-DD>` (IST day).

| Field | Type | Required | Default | Enum / validation | Notes |
|---|---|---|---|---|---|
| `_id` | String | – | – | – | `<agent_id>:<date>` |
| `agent_id` | String | yes | – | – | |
| `date` | String | yes | – | – | IST `YYYY-MM-DD` |
| `saved` | Number | no | 0 | – | new stories saved |
| `shares` | Number | no | 0 | – | |
| `templates` | Mixed `Record<string, number>` | no | {} | keys = StoryTemplate | shares per template |
| `channels` | Mixed `Record<string, number>` | no | {} | keys = `SHARE_CHANNELS`: status, download, farmer, copy | shares per channel |
| `created_at` / `updated_at` | Date | – | – | – | |

- Indexes: `{ date: 1, agent_id: 1 }`.
- Write pattern: `updateOne({_id: '<agent>:<date>'}, {$inc: {saved?:1, shares?:1, 'templates.<t>':1, 'channels.<c>':1}, $setOnInsert: {agent_id, date}}, {upsert: true})`. It is a no-op when there is nothing to increment.
- Reads: HO ranges `$match {date: {$gte, $lte}}`; one partner's days use an `_id` range `{$gte: '<agent>:<from>', $lte: '<agent>:<to>'}`.
- Lifecycle: `$inc` upserts only. The repository has no delete.

### `vistaar_v2_story_templates`  (src/modules/stories/schemas/story-template.schema.ts; `StoryTemplateRow`)
- Owner module: stories. Written by HO (`StoryTemplatesService`: create, update, delete, seed). Read by the app (cached ≤ 60 s) and HO (`all()`: sort `{suggested:-1, order:1, _id:1}`, limit 200).
- Options: common. `_id`: String card key. For the six built-in cards it is the layout name; otherwise it is HO's own key (e.g. `diwali_offer`).

| Field | Type | Required | Default | Enum / validation | Notes |
|---|---|---|---|---|---|
| `_id` | String | – | – | – | card key |
| `base` | String | yes | – | StoryTemplate (type only; no `enum` on the Prop) | the layout the app draws |
| `builtin` | Boolean | no | false | – | one of the six: edit and hide only, never deleted |
| `label` | Mixed Localized | yes | – | – | card title |
| `hint` | Mixed Localized | yes | – | – | card subtitle |
| `texts` | Mixed `Record<lang, TemplateTexts>` | yes | – | `templateTextsError`: `en` required; langs hi/en only; `kicker` non-empty; `cta` is a string | words printed on the story |
| `fields` | Mixed `Record<lang, TemplateFields>` | no | {} | `templateFieldsError`: langs hi/en; keys emoji, headline, body, detail1–3; strings; body ≤ 400, others ≤ 120 | pre-fill |
| `emojis` | [String] | no | [] | – | |
| `default_design` | String | no | null | – | design key; null = keep the current one |
| `suggested` | Boolean | no | false | – | |
| `starts_at` / `ends_at` | Date | no | null | – | |
| `order` | Number | no | 0 | – | |
| `is_active` | Boolean | no | true | – | hidden cards still open their saved stories |
| `created_by` / `updated_by` | String | no | – | – | |
| `created_at` / `updated_at` | Date | – | – | – | |

`texts.<lang>` (`TemplateTexts`): `kicker` string; `cta` string ('' = none).
`fields.<lang>` (`TemplateFields`): Partial of `emoji`, `headline`, `body`, `detail1`, `detail2`, `detail3` (all strings).

- Indexes: none declared (only `_id`).
- Write patterns:
  - `create`: `model.create`.
  - `insertIfMissing`: `updateOne({_id}, {$setOnInsert: row}, {upsert: true})`, used for seeding.
  - `backfillBuiltins`: for each of the six it runs `updateOne({_id: key, base: {$exists: false}}, {$set: {base: key, builtin: true, suggested: false, fields: {}, starts_at: null, ends_at: null}})`.
  - `update`: `$set`.
  - `remove`: `deleteOne({_id, builtin: false})`.
  - `countActive`: `{is_active: true}`.
- Lifecycle: built-in rows are never deleted (the delete filter requires `builtin: false`). Custom rows are hard-deleted.

### `vistaar_v2_story_designs`  (src/modules/stories/schemas/story-design.schema.ts; `StoryDesign`)
- Owner module: stories. Written by HO (`StoryDesignsService`). Read by the app (`listActive`, cached ≤ 60 s) and HO (`page` by status).
- Options: common. `_id`: String UUID.

| Field | Type | Required | Default | Enum / validation | Notes |
|---|---|---|---|---|---|
| `_id` | String | – | – | – | UUID |
| `key` | String | yes | – | `DESIGN_KEY` = `/^[a-z][a-z0-9_]{1,40}$/` (service) | what a saved story's `theme` keeps |
| `label` | Mixed Localized | yes | – | – | |
| `colors` | Mixed `DesignColors` | yes | – | `HEX_COLOR` `#RRGGBB` / `#RRGGBBAA`; required bg_from, bg_to, text, accent (the rest filled by `completeColors`) | always the full palette |
| `image_path` | String | no | null | – | public art under `vistaar/story-designs/`; null = colours only |
| `image_url` | String | no | null | – | |
| `image_width` / `image_height` | Number | no | null | – | |
| `overlay` | Number | no | 0 | 0–0.9 (comment) | ignored without art |
| `templates` | [String] | no | [] | StoryTemplate | empty = all |
| `starts_at` / `ends_at` | Date | no | null | – | |
| `order` | Number | no | 0 | – | the first live row is the app default |
| `is_active` | Boolean | no | true | – | |
| `created_by` / `updated_by` | String | no | – | – | |
| `created_at` / `updated_at` | Date | – | – | – | |

`colors` keys (all strings): `bg_from`, `bg_to`, `text`, `subtext`, `accent`, `accent_text`, `soft`, `deco`, `avatar`.

- Indexes: `{ key: 1 }` unique; `{ is_active: 1, order: 1 }`.
- Write patterns:
  - `create`, `$set` update, and `deleteOne({_id})` (hard delete).
  - `countByImage(path)` runs before the image file is removed.
  - `findByKey` looks up by `key`.
  - `listActive` filters `{is_active: true, $or: [{ends_at: null}, {ends_at: {$gt: now}}]}`, sorts `{order:1, created_at:1}`, limit 100.
  - Status filters are live, scheduled, expired and inactive.
- Lifecycle: HO hard-deletes. Saved stories keep the key and their image.

### `vistaar_v2_story_festivals`  (src/modules/stories/schemas/story-festival.schema.ts; `StoryFestival`)
- Owner module: stories. Written by HO (`StoryFestivalsService`). Read by the app (cached ≤ 60 s) and HO.
- Options: common. `_id`: String UUID.

| Field | Type | Required | Default | Enum / validation | Notes |
|---|---|---|---|---|---|
| `_id` | String | – | – | – | UUID |
| `key` | String | yes | – | `FESTIVAL_KEY` `/^[a-z][a-z0-9_]{1,40}$/` (service) | a saved story's `selection.festival` |
| `label` | Mixed Localized | yes | – | – | |
| `emoji` | String | yes | – | – | |
| `text` | Mixed `Record<lang, FestivalText>` | yes | – | `festivalTextError`: `en` required; every lang needs headline + body | |
| `starts_at` / `ends_at` | Date | no | null | `windowError`: end after start | |
| `order` | Number | no | 0 | – | |
| `is_active` | Boolean | no | true | – | |
| `created_by` / `updated_by` | String | no | – | – | |
| `created_at` / `updated_at` | Date | – | – | – | |

`text.<lang>` (`FestivalText`): `headline` string, `body` string.

- Indexes: `{ key: 1 }` unique; `{ is_active: 1, order: 1 }`.
- Write patterns: `create`, `$set` update and `deleteOne({_id})`. `listActive` uses the same filter as designs, sorts `{order:1, created_at:-1}`, limit 200.
- Lifecycle: HO hard-deletes.

### `vistaar_v2_story_samples`  (src/modules/stories/schemas/story-sample.schema.ts; `StorySample`)
- Owner module: stories. Written by HO (`StorySamplesService`). Read by the app (Farmer story template) and HO. It is never shown on product pages.
- Options: common. `_id`: String UUID.

| Field | Type | Required | Default | Enum / validation | Notes |
|---|---|---|---|---|---|
| `_id` | String | – | – | – | UUID |
| `key` | String | yes | – | – | stable key; a saved story's `selection.testimonial_id` |
| `name` | String | yes | – | – | |
| `village` / `district` / `state` | String | no | null | – | |
| `product` | String | yes | – | – | |
| `crop` | String | no | null | – | |
| `quote` | String | yes | – | – | |
| `stars` | Number | no | 5 | 1–5 (comment) | |
| `order` | Number | no | 0 | – | |
| `is_active` | Boolean | no | true | – | |
| `created_by` / `updated_by` | String | no | – | – | |
| `created_at` / `updated_at` | Date | – | – | – | |

- Indexes: `{ key: 1 }` unique; `{ is_active: 1, order: 1 }`.
- Write patterns: `create`, `$set` update and `deleteOne({_id})`. `listActive` filters `{is_active: true}`, sorts `{order:1, created_at:-1}`, limit 200. HO `page` can filter on `is_active`.
- Lifecycle: HO hard-deletes.

### `vistaar_v2_banners`  (src/modules/banners/schemas/banner.schema.ts; `Banner`)
- Owner module: banners. Written by HO (`BannersService`). Read by the app (`listActive`, cached ≤ 60 s) and HO (`page` by status and cohort).
- Options: common. `_id`: String UUID.

| Field | Type | Required | Default | Enum / validation | Notes |
|---|---|---|---|---|---|
| `_id` | String | – | – | – | UUID |
| `title` | Mixed Localized | yes | – | – | drawn on a text banner; the name / alt text on an image banner |
| `subtitle` | Mixed Localized | no | null | required without an image (service) | |
| `cta` | Mixed Localized | no | null | required without an image (service) | button text |
| `image_path` | String | no | null | `BANNER_IMAGE_PATTERN`, folder `vistaar/banners`; ≤ 2 MB, min width 600, ratio 2.4 | |
| `image_url` | String | no | null | – | download URL |
| `image_width` / `image_height` | Number | no | null | – | |
| `link` | String | yes | – | `LINK_PATTERN` `/^\/[A-Za-z0-9\-._~/?=&%]*$/` | in-app route |
| `tone` | String | no | 'primary' | `BANNER_TONES`: primary, warning, success, info | |
| `emoji` | String | no | null | – | |
| `cohorts` | [String] | no | [] | – | empty = every partner |
| `starts_at` / `ends_at` | Date | no | null | – | |
| `order` | Number | no | 0 | – | |
| `is_active` | Boolean | no | true | – | `MAX_LIVE_BANNERS = 10` (domain) |
| `created_by` / `updated_by` | String | no | – | – | |
| `created_at` / `updated_at` | Date | – | – | – | |

- Indexes: `{ is_active: 1, order: 1 }`.
- Write patterns:
  - `create`, `$set` update and `deleteOne({_id})`.
  - `reorder(ids, by)`: `bulkWrite` of `updateOne({_id}, {$set: {order: index, updated_by}})`, at most `BANNER_REORDER_MAX = 200`.
  - `countByImage` runs before the file is removed.
  - The cohort filter is `{$or: [{cohorts: c}, {cohorts: {$size: 0}}]}`.
  - `listActive` filters `{is_active: true, $or: [{ends_at: null}, {ends_at: {$gt: now}}]}`, sorts `{order:1, created_at:-1}`, limit 200.
- Lifecycle: HO hard-deletes. The image is removed when no banner uses it.

### `vistaar_v2_events`  (src/modules/events/schemas/event.schema.ts; `FarmerEvent`)
- Owner module: events. Written by HO (`AdminEventsService`) and by partner register / unregister (`registered_count`). Read by the app (`listActiveFrom`) and HO, and it feeds My Story meetings.
- Options: common. `_id`: String UUID.

| Field | Type | Required | Default | Enum / validation | Notes |
|---|---|---|---|---|---|
| `_id` | String | – | – | – | UUID |
| `title` | String | yes | – | – | |
| `type` | String | yes | – | `EVENT_TYPES`: kisan_mela, training, webinar, field_day | |
| `starts_at` | Date | yes | – | – | |
| `location` | String | yes | – | – | venue or "Online (Google Meet)" |
| `note` | String | no | null | – | |
| `seats` | Number | yes | – | `MAX_SEATS = 100_000` (domain) | |
| `registered_count` | Number | no | 0 | – | kept in step with registrations |
| `cohorts` | [String] | no | [] | – | empty = everyone |
| `is_active` | Boolean | no | true | – | |
| `created_by` / `updated_by` | String | no | – | – | |
| `created_at` / `updated_at` | Date | – | – | – | |

- Indexes: `{ is_active: 1, starts_at: 1 }`.
- Write patterns:
  - `takeSeat`: `findOneAndUpdate({_id, is_active: true, starts_at: {$gt: now}, $expr: {$lt: ['$registered_count', '$seats']}}, {$inc: {registered_count: 1}})`. The service inserts the registration first; if `takeSeat` returns null, it deletes the registration. Once the seat is taken, `RewardsService.eventRegistered(agent_id, event_id)` — reward id `event_registered:<event_id>:<agent_id>:<kind>`, `ref_id` = the event id: once per event per partner, ever (an un-register and register again pays nothing more).
  - `releaseSeat`: `findOneAndUpdate({_id, registered_count: {$gt: 0}}, {$inc: {registered_count: -1}})`, run after the registration is deleted.
  - `update`: `$set`. When `seats` is in the update, the filter adds `registered_count: {$lte: seats}`.
  - Delete: `deleteOne({_id})`, then `registrations.removeAll(id)`.
  - Status: `upcoming` = `is_active` + `starts_at > now`; `past` = `starts_at ≤ now`; `inactive`.
  - `listActiveFrom(since)` sorts `{starts_at:1, _id:1}`, limit 300.
- Lifecycle: HO hard-deletes, and the event's registrations go with it.

### `vistaar_v2_event_registrations`  (src/modules/events/schemas/event-registration.schema.ts; `EventRegistration`)
- Owner module: events. Written by partners (register / unregister) and by HO event delete. Read by HO (`page` by event) and the partner (`heldBy`, `_id` lookups).
- Options: `timestamps: { createdAt: 'created_at', updatedAt: false }`, `versionKey: false`. `_id`: String `<event_id>:<agent_id>` (`registrationId`).

| Field | Type | Required | Default | Enum / validation | Notes |
|---|---|---|---|---|---|
| `_id` | String | – | – | – | `<event_id>:<agent_id>`: one seat per partner per event |
| `event_id` | String | yes | – | – | |
| `agent_id` | String | yes | – | – | |
| `created_at` | Date | – | – | – | no `updated_at` |

- Indexes: `{ event_id: 1, created_at: 1 }`.
- Write patterns:
  - `add`: `create`. A duplicate key (11000) returns false, meaning already registered.
  - `remove`: `deleteOne({_id})`.
  - `removeAll`: `deleteMany({event_id})`.
- Lifecycle: deleted on unregister, on a failed seat, or with the event.

### `vistaar_v2_faq_sections`  (src/modules/faqs/schemas/faq-section.schema.ts; `FaqSection`)
- Owner module: faqs. Written by HO (`FaqSectionsService`). Read by the app (`GET /faqs`, cached ≤ 60 s) and HO (`list`, limit 200, sort `{order:1, _id:1}`).
- Options: common. `_id`: String section key (e.g. `payments`). It never changes.

| Field | Type | Required | Default | Enum / validation | Notes |
|---|---|---|---|---|---|
| `_id` | String | – | – | – | key = a FAQ's `category` |
| `label` | String | yes | – | – | chip text |
| `emoji` | String | no | null | – | |
| `order` | Number | no | 0 | – | |
| `is_active` | Boolean | no | true | – | false hides the section and its FAQs |
| `created_by` / `updated_by` | String | no | – | – | |
| `created_at` / `updated_at` | Date | – | – | – | |

- Indexes: `{ is_active: 1, order: 1 }`.
- Write patterns: `create`, `$set` update and `deleteOne({_id})`. The delete is refused if `faqs.inSection(key)` (an `exists({category})` check) finds a FAQ.
- Lifecycle: deleted only when empty.

### `vistaar_v2_faqs`  (src/modules/faqs/schemas/faq.schema.ts; `Faq`)
- Owner module: faqs. Written by HO (`FaqsService`). Read by the app (`listActive`, limit 500, sort `{order:1, created_at:1, _id:1}`) and HO (`page` by category and is_active).
- Options: common. `_id`: String UUID.

| Field | Type | Required | Default | Enum / validation | Notes |
|---|---|---|---|---|---|
| `_id` | String | – | – | – | UUID |
| `category` | String | yes | – | – | a section `_id` |
| `q` | String | yes | – | – | |
| `a` | String | yes | – | – | |
| `q_key` | String | yes | – | – | `questionKey(q)`, normalised; unique |
| `order` | Number | no | 0 | – | |
| `is_active` | Boolean | no | true | – | |
| `created_by` / `updated_by` | String | no | – | – | |
| `created_at` / `updated_at` | Date | – | – | – | |

- Indexes: `{ q_key: 1 }` unique; `{ is_active: 1, order: 1 }`; `{ category: 1, order: 1 }`.
- Write patterns: `create`, `$set` update and `deleteOne({_id})`.
- Lifecycle: HO hard-deletes.

### `vistaar_v2_info_pages`  (src/modules/info-pages/schemas/info-page.schema.ts; `InfoPage`)
- Owner module: info-pages. Written by HO through one controller per page (`/admin/about-program`, `/admin/about-company`, `/admin/contact-us`), each with its own `@Delete()`. Read by the public app (cached ≤ 60 s; Contact Us `open_now` per request).
- Options: common. `_id`: String, `enum: INFO_PAGES`: `about_program`, `about_company`, `contact_us`.

| Field | Type | Required | Default | Enum / validation | Notes |
|---|---|---|---|---|---|
| `_id` | String | – | – | `INFO_PAGES` | page key |
| `content` | Mixed (`unknown`) | yes | – | the page's DTO + `contentProblems` (placeholders only `{min_withdrawal}` / `{grievance_sla_hours}`; duplicate keys; hours order; rule cohorts exist) | shape per page below |
| `version` | Number | yes | – | – | 1 on the first save, +1 on each save |
| `created_by` / `updated_by` | String | no | – | – | |
| `created_at` / `updated_at` | Date | – | – | – | |

`content` for `about_program` (`AboutProgramContent`)

| Field | Type |
|---|---|
| `hero` | `{ title, tagline, intro }` strings |
| `who_can_join` | `{ heading }` |
| `earn` | `{ heading, commission: TitleBody, gigs: TitleBody, no_payout: TitleBody, referral: TitleBody }` |
| `lifecycle` | `{ heading, steps: ({key: 'pending'\|'confirmed'\|'withdraw'} & TitleBody)[], reversed_note }` |
| `payouts` | `{ heading, points: string[] }` |
| `rules` | `{ heading, items: {text, cohort: string\|null}[], sop: {label, sop_id} \| null }` |
| `coins` | `{ heading, headline, body }` |
| `more` | `{ heading, items: ({key: 'testimonials'\|'grievances'\|'kkd_activity'} & TitleBody)[] }` |
| `footer` | string |

`TitleBody` = `{ title: string, body: string }`.

`content` for `about_company` (`AboutCompanyContent`)

| Field | Type |
|---|---|
| `name`, `tagline`, `mission` | string |
| `story`, `quality_points` | string[] |
| `stats` | `{ label, value }[]` |
| `what_we_make`, `ecosystem` | `CompanyTile[]` = `{ title, text, emoji }` |
| `contact` | `{ helpline, email, website }` |
| `social` | `{ label, url }[]` |

`content` for `contact_us` (`ContactUsContent`)

| Field | Type | Notes |
|---|---|---|
| `helpline` | `{ number, label }` | 10 digits, dialled as `tel:+91<number>` |
| `whatsapp` | `{ number, label }` | 10 digits, `https://wa.me/91<number>` |
| `support_email`, `privacy_email`, `play_store_url`, `ticket_reply_note` | string | |
| `hours` | `{ days: number[] (ISO 1=Mon…7=Sun, no repeats), opens: 'HH:mm', closes: 'HH:mm' (after opens), label }` | `HHMM` `/^([01]\d\|2[0-3]):[0-5]\d$/`, IST |
| `ticket_categories` | string[] | |

- Indexes: none declared (read by `_id` only).
- Write patterns:
  - First save: `create({_id: page, content, version: 1, created_by, updated_by})`. A duplicate key returns null.
  - Later saves (optimistic): `findOneAndUpdate({_id: page, version}, {$set: {content, updated_by}, $inc: {version: 1}})`. Null means the save was based on an old version.
  - Delete: `deleteOne({_id: page})`.
- Lifecycle: one row per page, hard-deletable by HO.
- DISCREPANCY: docs/DATABASE.md says "Read only by `_id`; never deleted". The code has `InfoPageRepository.remove` (`deleteOne({_id: page})`), called by `InfoPagesService` and exposed by `@Delete()` on all three admin controllers.

### `terms_and_conditions`  (shared) (src/modules/terms/schemas/terms.schema.ts; `TermsAndConditions`)
- Owner: shared with Krishi Sampark, B2B Portal and RLM. The Vistaar terms module writes only `profiles: ['vistaar']` rows. Written by HO (`TermsService`). Read by the public app (`live()`, cached ≤ 60 s) and HO.
- Options: `@Schema({ collection: 'terms_and_conditions' })` only: no timestamps, and the default `versionKey` (`__v`) is kept because the other writers keep it. `_id`: `Types.ObjectId` (auto).

| Field | Type | Required | Default | Enum / validation | Notes |
|---|---|---|---|---|---|
| `_id` | ObjectId | – | auto | – | |
| `toc_id` | String | yes | – | `TOC-n` | next after the highest across all apps |
| `title` | String | yes | – | trimmed (service) | |
| `link` | String | yes | – | – | document (docx/pdf) in the org bucket |
| `profiles` | [String] | no | [] | – | Vistaar inserts `['vistaar']` (`VISTAAR_PROFILE`) |
| `is_active` | Boolean | no | true | – | one active Vistaar row at a time |
| `__v` | Number | – | – | – | edit count; version shown = `__v + 1` |

- Indexes: none declared in code. The existing `{toc_id}` unique and `{profiles, is_active}` indexes belong to the other apps.
- Filter always applied: `OURS = { profiles: 'vistaar' }` on every read, update and delete. The one exception is `lastTocNumber`, which reads across every app's rows.
- Write patterns:
  - Numbering: `lastTocNumber()` aggregates `$match toc_id /^TOC-\d+$/` → `$toInt($substrCP(toc_id, 4, 12))`, sorts descending, limit 1. `create` tries `TOC-(n+1)` up to `ID_ATTEMPTS = 5` times. `insert` returns null on a duplicate key, which triggers a retry. After 5 failures the service answers 503 `TERMS_ID_UNAVAILABLE`.
  - Activation: on create or update with `is_active: true`, `deactivateOthers(id)` runs `updateMany({...OURS, is_active: true, toc_id: {$ne: id}}, {$set: {is_active: false}})`.
  - `update`: `findOneAndUpdate({...OURS, toc_id}, {$set, ...($inc: {__v: 1} when title or link changes)})`.
  - `replaceDocument(tocId, version, {title, link})` (the editor's text save): `findOneAndUpdate({...OURS, toc_id, __v: version}, {$set, $inc: {__v: 1}})`. This is the optimistic check on `__v`.
  - `removeInactive`: `deleteOne({...OURS, toc_id, is_active: false})`. Only an inactive row can be deleted.
  - `live()`: `findOne({...OURS, is_active: true}).sort({_id: -1})`.
- Lifecycle: the first T&C gets a new `TOC-n`. Edits keep the same `toc_id` and raise `__v`. An inactive row can be hard-deleted.
- No `created_at` / `updated_at`: the schema has no timestamps and no repository sets them, while every row on production main has both (section 10A, item 8).

---

## 9. Field operations, feedback, testimonials

Conventions: every `vistaar_v2_*` schema here uses `versionKey: false` and `timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }`; sub-document schemas are `_id: false`. The shared Stockship collections are reached only through the raw driver (`connection.collection(...)`), so no Mongoose schema and no index is declared on them, and every read and write filters on `source: 'vistaar'`. Index lists below were checked line by line against `docs/PROD-CHECKLIST.md` at beta `5113b6c` (line numbers are that file's). None of these schemas changed since 17 October; what is new is that meetings, gigs and attendance now also call `RewardsService`, which may insert rows in `vistaar_v2_rewards` (section 9A) — noted under each collection.

### `vistaar_v2_meetings`  (src/modules/meetings/schemas/meeting.schema.ts; owner: meetings module)
- Owner module: meetings. Written by the partner (app) only; HO reads only. Read by Today's tasks and the HO list/totals.
- Schema options: collection `vistaar_v2_meetings`, timestamps created_at/updated_at, versionKey false. `_id`: String, the app's UUID (a retried create returns the same meeting).

| Field | Type | Required | Default | Enum / validation | Notes |
|---|---|---|---|---|---|
| `_id` | String | — | — | — | App UUID |
| `agent_id` | String | yes | — | — | Partner `VST-…` |
| `type` | String | yes | — | farmer_meeting, crop_demo, field_day, disease_camp, soil_health_camp | `MEETING_TYPES` |
| `title` | String | yes | — | — | |
| `starts_at` | Date | yes | — | — | |
| `village` | String | yes | — | — | |
| `venue` | String | no | null | — | |
| `pincode` | String | no | null | — | Where invites go once WhatsApp is connected |
| `organiser` | String | no | 'self' | self, officer | `ORGANISERS` |
| `agenda` | String | no | null | — | |
| `status` | String | no | 'scheduled' | scheduled, completed, cancelled | |
| `attendees` | [MeetingAttendee] | no | [] | ≤ 300 (`MAX_ATTENDEES`, domain) | Embedded, saved whole |
| `counts` | {invited, present, leads: Number} | no | {0,0,0} | `_id: false` | Kept in step with `attendees` on every write |
| `completed_at` | Date | no | null | — | |
| `cancelled_at` | Date | no | null | — | |
| `cancel_note` | String | no | null | — | |
| `created_at` / `updated_at` | Date | auto | — | — | `updated_at` is the attendee-list optimistic lock |

`attendees[]` (MeetingAttendee, `_id: false`, versionKey false):

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `phone` | String | yes | — | |
| `name` | String | yes | — | |
| `village` | String | no | null | |
| `pii_id` | String | no | null | Set when captured as a lead |
| `invited` | Boolean | no | false | |
| `present` | Boolean | no | false | |
| `walk_in` | Boolean | no | false | |
| `lead_captured` | Boolean | no | false | |

`counts` sub-doc: `invited` Number, `present` Number, `leads` Number (default 0 each).

- Indexes: `{ agent_id: 1, starts_at: -1, _id: -1 }`; `{ starts_at: -1, _id: -1 }`. Both in PROD-CHECKLIST (lines 63–64).
- Write patterns: `create` (`model.create`). Field edits: `findOneAndUpdate({_id, agent_id, status: 'scheduled', ...}, {$set})`. Attendee list: `findOneAndUpdate({_id, agent_id, updated_at: readAt, status: {$ne: 'cancelled'}}, {$set: {attendees, counts}})` (`null` = changed meanwhile). Lead capture: one pipeline update (`$map` that marks the phone `pii_id`, `present: true`, `lead_captured: true`, then recomputes `counts`, `updated_at: $$NOW`), filtered on `{_id, agent_id, status != cancelled, 'attendees.phone'}`. The capture first saves the farmer through `LeadsService.upsert` (`found_via: 'meeting'`; refused when the phone is already the partner's lead), then marks the attendee, then calls `RewardsService.meetingAttendeeCaptured` — reward id `meeting_attendee_captured:<meeting _id>:<pii_id>:<kind>`, `pii_id` + `farmer_name` + `ref_id` = meeting id (the new lead may also pay `lead_created`).
- Lifecycle: scheduled → completed | cancelled. Never deleted (cancel instead).
- DISCREPANCY: none in substance. ("one row per phone" in DATABASE.md is a service rule, not a schema constraint; DATABASE.md's index list writes the two indexes without their `_id: -1` tail.)

### `vistaar_v2_gigs`  (src/modules/gigs/schemas/gig.schema.ts; owner: gigs module)
- Owner module: gigs. Written by HO (post, assign, review, cancel, reopen, delete) and the partner (accept, release, check-in, attendees, photos, submit). Read by the app (Available / My gigs / earnings / Today's tasks) and the HO list/calendar/totals.
- Schema options: collection `vistaar_v2_gigs`, timestamps, versionKey false. `_id`: String `GIG-000001` from `vistaar_v2_counters` (key `gig_id` per DATABASE.md).

| Field | Type | Required | Default | Enum / validation | Notes |
|---|---|---|---|---|---|
| `_id` | String | — | — | — | `GIG-n` |
| `title` | String | yes | — | — | |
| `village` | String | yes | — | — | |
| `district` | String | no | null | — | |
| `state` | String | no | null | — | Upper case |
| `pincode` | String | no | null | — | |
| `venue` | String | no | null | — | |
| `venue_point` | Mixed `{lat, lng}` | no | null | — | HO's pin; check-in distance measured from it |
| `starts_at` | Date | yes | — | — | |
| `ends_at` | Date | yes | — | — | |
| `expected_farmers` | Number | no | 0 | — | |
| `min_farmers` | Number | yes | — | — | Defaults from settings (service) |
| `photos_required` | Number | yes | — | — | Defaults from settings (service) |
| `payout` | Number | no | null | — | ₹; `null` only while a cohort-paid gig is open; fixed at accept / assign |
| `payout_source` | String | no | 'gig' | gig, cohort (`PAYOUT_SOURCES`) | Rows before 2026-10-16 have none → read as `gig` (`payoutSourceOf`) |
| `products` | [String] | no | [] | — | |
| `requirements` | [String] | no | [] | — | Free lines, e.g. "2 testimonials" |
| `cohorts` | [String] | no | [] | — | Empty = every partner |
| `status` | String | no | 'open' | open, accepted, checked_in, submitted, approved, rejected, cancelled | |
| `agent_id` | String | no | null | — | Holder |
| `accepted_at` | Date | no | null | — | |
| `assigned_by` | String | no | null | — | HO email; `null` = partner took it |
| `releases` | [Mixed GigRelease] | no | [] | — | |
| `check_in` | Mixed GigCheckin | no | null | — | |
| `attendees` | [Mixed GigAttendee] | no | [] | ≤ 300 (`MAX_GIG_ATTENDEES`) | Saved whole |
| `photos` | [Mixed GigPhoto] | no | [] | ≤ 6 (`MAX_GIG_PHOTOS`) | Private files |
| `submitted_at` | Date | no | null | — | |
| `reviewed_by` | String | no | null | — | HO email |
| `reviewed_at` | Date | no | null | — | |
| `reject_reason` | String | no | null | — | |
| `cancelled_by` | String | no | null | — | |
| `cancel_reason` | String | no | null | — | |
| `posted_by` | String | yes | — | — | HO email |
| `updated_by` | String | no | (none) | — | |
| `created_at` / `updated_at` | Date | auto | — | — | |

`venue_point` (GigPoint): `lat` number, `lng` number.

`releases[]` (GigRelease, Mixed): `agent_id` string; `at` Date; `by` 'partner' \| 'ho'.

`check_in` (GigCheckin, Mixed): `lat` number\|null; `lng` number\|null; `accuracy_m` number\|null; `at` Date (server time); `distance_m` number\|null; `flags` CheckinFlag[] (early, late, no_gps, far — flagged, never blocks).

`attendees[]` (GigAttendee, Mixed): `phone` string; `name` string; `village` string\|null.

`photos[]` (GigPhoto, Mixed): `id` string (file UUID); `path` string; `at` Date.

Mixed sub-docs get no Mongoose validation; their shape is TypeScript-only.

- Indexes: `{ status: 1, starts_at: 1 }`; `{ agent_id: 1, starts_at: -1, _id: -1 }`; `{ starts_at: -1, _id: -1 }`; `{ 'attendees.phone': 1, starts_at: -1 }`. All four in PROD-CHECKLIST (lines 65–68); line 285 says the cohort-paid fields need no new index.
- Write patterns: `create`; every state move is `transition(id, when, update)` = `findOneAndUpdate({...when, _id}, update)` (conditional on the status the caller read; `null` = moved first). Delete: `deleteOne({_id, status: 'open', agent_id: null, releases: {$size: 0}})`. HO approval (`submitted` → `approved`) of a gig with a holder then calls `RewardsService.gigApproved(agent_id, gig _id, {attendees, photos})` — reward id `gig_approved:<GIG-n>:<kind>`, `ref_id` = the gig: a rule bonus on top of the gig's own `payout`, once per gig. Rejection writes no reward.
- Lifecycle: open → accepted → checked_in → submitted → approved | rejected; HO cancel / reopen (release pushes `releases[]`, payout goes back to `null` for cohort-paid gigs per DATABASE.md). Deleted only while open and never taken. FINAL = approved, rejected, cancelled.
- DISCREPANCY: DATABASE.md's index list omits `{ starts_at: -1, _id: -1 }` (HO list); code and PROD-CHECKLIST have it (section 10, item 11).

### `vistaar_v2_attendance`  (src/modules/attendance/schemas/attendance-day.schema.ts; owner: attendance module)
- Owner module: attendance. Written by the partner's punch in/out; read by the app (today, month) and the HO board.
- Schema options: collection `vistaar_v2_attendance`, timestamps, versionKey false. `_id`: String `<agent_id>:<YYYY-MM-DD>` (`attendanceDayId`), e.g. `VST-123:2026-10-12`; one row per partner per IST day without its own index.

| Field | Type | Required | Default | Enum / validation | Notes |
|---|---|---|---|---|---|
| `_id` | String | — | — | — | `<agent_id>:<date>` |
| `agent_id` | String | yes | — | — | |
| `date` | String | yes | — | `DATE_PATTERN` in domain | IST `YYYY-MM-DD` |
| `sessions` | [PunchSession] | no | [] | ≤ 10 (`MAX_SESSIONS_PER_DAY`) | Oldest first |
| `punched_in` | Boolean | no | false | — | The last session is open |
| `first_in_at` | Date | yes | — | — | |
| `last_out_at` | Date | no | null | — | |
| `worked_ms` | Number | no | 0 | — | Sum of closed sessions |
| `created_at` / `updated_at` | Date | auto | — | — | |

`sessions[]` (PunchSession, `_id: false`):

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `in_at` | Date | yes | — | Server time |
| `in_location` | PunchLocation | yes | — | |
| `out_at` | Date | no | null | `null` while on duty |
| `out_location` | PunchLocation | no | null | Not checked against `in_location` |

`in_location` / `out_location` (PunchLocation, `_id: false`):

| Field | Type | Required | Default | Enum | Notes |
|---|---|---|---|---|---|
| `lat` | Number | no | null | — | |
| `lng` | Number | no | null | — | |
| `accuracy_m` | Number | no | null | — | |
| `label` | String | yes | — | — | e.g. "Rampur, Lucknow" |
| `source` | String | yes | — | gps, registered | |

- Indexes: `{ date: 1 }`. In PROD-CHECKLIST line 231 (Attendance gate checkbox, not the main block).
- Write patterns: punch-in = `findOneAndUpdate({_id, punched_in: {$ne: true}, 'sessions.9': {$exists: false}}, {$push: {sessions}, $set: {punched_in: true}, $setOnInsert: {agent_id, date, first_in_at, last_out_at: null, worked_ms: 0}}, {upsert: true, setDefaultsOnInsert: false})`; E11000 → `null` (caller re-reads). Punch-out = `findOneAndUpdate({_id, punched_in: true, 'sessions.<i>.in_at': inAt, 'sessions.<i>.out_at': null}, {$set: {out_at, out_location, punched_in: false, last_out_at}, $inc: {worked_ms}})`.
- Streak read (after every punch-out): `range(agent_id, today − 60 days, today)` = `find({_id: {$gte: '<agent>:<from>', $lte: '<agent>:<today>'}, agent_id}).sort({_id: -1}).limit(31)` (`MONTH_READ_CAP`), then the run of consecutive IST days ending today is counted and passed to `RewardsService.attendanceStreak(agent_id, today, streak_days)` — reward id `attendance_streak:<agent_id>:<YYYY-MM-DD>:<kind>`, `ref_id` = the day, once per day. Because the read stops at 31 rows, `streak_days` never exceeds 31, although the lookback is 60 days (section 10, item 25).
- Lifecycle: created at the day's first punch-in; never deleted.
- DISCREPANCY: DATABASE.md's index list says attendance has "none beyond `_id`"; the schema declares `{ date: 1 }` and PROD-CHECKLIST's Attendance gate builds it (section 10, item 11).

### `vistaar_v2_feedback`  (src/modules/feedback/schemas/feedback.schema.ts; owner: feedback module)
- Owner module: feedback. Written by the partner (submit) and HO (close the follow-up). Read by the partner's history / daily cap and the HO desk.
- Schema options: collection `vistaar_v2_feedback`, timestamps, versionKey false. `_id`: ObjectId (Mongo auto).

| Field | Type | Required | Default | Enum / validation | Notes |
|---|---|---|---|---|---|
| `_id` | ObjectId | — | auto | — | |
| `agent_id` | String | yes | — | — | |
| `partner` | Mixed PartnerSnapshot | yes | — | — | Copy at submit |
| `nps` | Number | yes | — | 0–10 (DTO/domain) | |
| `bucket` | String | yes | — | detractor, passive, promoter | Server-side: 0–6 / 7–8 / 9–10 |
| `reasons` | [String] | no | [] | — | Chip text as shown |
| `comment` | String | no | null | — | |
| `rating` | Number | no | null | 1–5 | |
| `follow_up` | Mixed FollowUp | no | null | — | Detractors only |
| `created_at` / `updated_at` | Date | auto | — | — | |

`partner` (PartnerSnapshot, Mixed): `name` string\|null; `phone` string; `cohort` string\|null; `district` string\|null; `state` string\|null; `owner_agent_id` string\|null (`agents_v2.agent_id` of the owning HO officer).

`follow_up` (FollowUp, Mixed): `status` open\|done; `due_at` Date (2 working days, Mon–Sat IST); `owner_agent_id` string\|null; `note` string\|null; `done_by` string\|null; `done_at` Date\|null.

- Indexes: `{ agent_id: 1, created_at: -1 }`; `{ created_at: -1 }`; `{ bucket: 1, created_at: -1 }`; `{ 'follow_up.status': 1, 'follow_up.due_at': 1 }` with `partialFilterExpression: { 'follow_up.status': { $exists: true } }`. All in PROD-CHECKLIST (lines 86–89).
- Write patterns: `create`; follow-up close = `findOneAndUpdate({_id, follow_up: {$ne: null}}, {$set: {'follow_up.status', 'follow_up.note', 'follow_up.done_by', 'follow_up.done_at'}})`. Cap: 10 answers per IST day (CLAUDE.md).
- Lifecycle: never edited by the partner; never deleted.
- DISCREPANCY: none.

### `vistaar_v2_product_suggestions`  (src/modules/feedback/schemas/product-suggestion.schema.ts; owner: feedback module)
- Owner module: feedback. Written by the partner (submit) and HO (status, note). Read by the HO desk ("most asked for").
- Schema options: collection `vistaar_v2_product_suggestions`, timestamps, versionKey false. `_id`: String `SUG-000123` from `vistaar_v2_counters` (key `product_suggestion` per DATABASE.md).

| Field | Type | Required | Default | Enum | Notes |
|---|---|---|---|---|---|
| `_id` | String | — | — | — | `SUG-n` |
| `agent_id` | String | yes | — | — | |
| `partner` | Mixed PartnerSnapshot | yes | — | — | Same shape as feedback |
| `product` | String | yes | — | — | As typed |
| `product_key` | String | yes | — | — | `productKey(product)` |
| `crop` | String | no | null | — | |
| `monthly_demand` | String | no | null | — | Free text |
| `note` | String | no | null | — | |
| `status` | String | no | 'new' | new, reviewed, planned, declined | |
| `ho_note` | String | no | null | — | |
| `updated_by` | String | no | null | — | |
| `created_at` / `updated_at` | Date | auto | — | — | |

- Indexes: `{ agent_id: 1, created_at: -1 }`; `{ status: 1, created_at: -1 }`; `{ created_at: -1 }`; `{ product_key: 1, created_at: -1 }`. All in PROD-CHECKLIST (lines 90–93).
- Write patterns: `create`; HO update. Cap: 20 per IST day.
- Lifecycle: never deleted.
- DISCREPANCY: none.

### `vistaar_v2_testimonials`  (src/modules/testimonials/schemas/testimonial-submission.schema.ts; owner: testimonials module)
- Owner module: testimonials. Written by the partner (submit) and HO (approve / reject / remove), plus view/share counters. Read by the library, "My submissions" and the HO trays.
- Schema options: collection `vistaar_v2_testimonials`, timestamps, versionKey false, `minimize: false`. `_id`: String, the app's UUID.

| Field | Type | Required | Default | Enum | Notes |
|---|---|---|---|---|---|
| `_id` | String | — | — | — | App UUID |
| `agent_id` | String | yes | — | — | From the token |
| `partner_name` | String | no | null | — | Copy |
| `pii_id` | String | yes | — | — | Farmer (partner's own lead) |
| `farmer_name` | String | yes | — | — | |
| `farmer_contact` | String | yes | — | — | `+91…` |
| `village` / `district` / `state` | String | no | null | — | |
| `type` | String | yes | — | product, combo | |
| `bulk` | String | no | null | — | |
| `family` | String | no | null | — | |
| `product_name` | String | no | null | — | `bulk_v2.trade_name` / `combos_v2.name` |
| `crop` | String | yes | — | — | |
| `kind` | String | yes | — | video, photo, text | |
| `text` | String | no | '' | — | |
| `rating` | Number | yes | — | — | |
| `media_path` | String | no | null | — | Private path; null for a quote |
| `media_url` | String | no | null | — | Token URL, set on approval, gone on removal |
| `duration_sec` | Number | no | null | — | |
| `status` | String | no | 'submitted' | submitted, approved, rejected, removed | |
| `reason` | String | no | null | — | |
| `decided_by` | String | no | null | — | |
| `decided_at` | Date | no | null | — | |
| `approved_at` | Date | no | null | — | |
| `review_id` | ObjectId | yes | — | — | Reserved `product_reviews._id` |
| `testimonial_id` | ObjectId | no | null | — | Reserved `product_testimonials._id`; null for a quote |
| `gig_id` | String | no | null | — | Reserved; nothing sets it |
| `views` | Number | no | 0 | — | |
| `shares` | Number | no | 0 | — | |
| `created_at` / `updated_at` | Date | auto | — | — | |

- Indexes: `{ agent_id: 1, created_at: -1 }`; `{ status: 1, created_at: -1, _id: -1 }`; `{ status: 1, shares: -1, created_at: -1 }`; `{ status: 1, bulk: 1, created_at: -1, _id: -1 }`; `{ status: 1, crop: 1, created_at: -1, _id: -1 }`; `{ status: 1, state: 1, district: 1, created_at: -1, _id: -1 }`; `{ testimonial_id: 1 }` with `partialFilterExpression: { testimonial_id: { $type: 'objectId' } }`; `{ pii_id: 1 }`. All eight in PROD-CHECKLIST (lines 76–83).
- Write patterns: `insert` (`model.create`; duplicate `_id` → `false`, so a retry finds the first). `transition(id, from[], set)` = `findOneAndUpdate({_id, status: {$in: from}}, {$set})`. `bump` = `findOneAndUpdate({_id, status: 'approved'}, {$inc: {views|shares: 1}}, {timestamps: false})`.
- Lifecycle: submitted → approved | rejected; approved → removed (and can be shown again). Approval writes the shared rows; consent withdrawal erases them.
- DISCREPANCY: none.

### `vistaar_v2_testimonial_consents`  (src/modules/testimonials/schemas/testimonial-consent.schema.ts; owner: testimonials module)
- Owner module: testimonials. Written at submit (partner) and on withdrawal (HO). Read by HO.
- Schema options: collection `vistaar_v2_testimonial_consents`, timestamps, versionKey false. `_id`: String = the submission's `_id`.

| Field | Type | Required | Default | Enum | Notes |
|---|---|---|---|---|---|
| `_id` | String | — | — | — | Submission id |
| `agent_id` | String | yes | — | — | Who took it |
| `pii_id` | String | yes | — | — | Who gave it |
| `farmer_name` | String | yes | — | — | |
| `version` | Number | yes | — | — | Wording version (settings `testimonial_consent`) |
| `text` | String | yes | — | — | Exact words shown |
| `lang` | String | yes | — | en, hi | `CONSENT_LANGS` |
| `given_at` | Date | yes | — | — | Server time |
| `status` | String | no | 'given' | given, withdrawn | |
| `withdrawn_at` | Date | no | null | — | |
| `withdrawn_by` | String | no | null | — | HO email |
| `withdrawn_reason` | String | no | null | — | |
| `created_at` / `updated_at` | Date | auto | — | — | |

- Indexes: `{ pii_id: 1, given_at: -1 }`; `{ agent_id: 1, given_at: -1 }`. Both in PROD-CHECKLIST (lines 84–85).
- Write patterns: `insert` (`model.create`); withdraw = `findOneAndUpdate({_id, status: 'given'}, {$set: {status: 'withdrawn', withdrawn_at, withdrawn_by, withdrawn_reason}})`.
- Lifecycle: never deleted, even when the testimonial is (DPDP proof).
- DISCREPANCY: none.

### `product_reviews`  (raw driver in src/modules/testimonials/repositories/review.repository.ts; owner: Stockship v3, shared)
- Written by testimonials (`SubmissionsService.showShared` / `eraseShared`) on HO approve / remove / consent withdrawal. Read: not listed from here.
- No schema; `_id`: ObjectId reserved at submit (`vistaar_v2_testimonials.review_id`).

Approve (`show`) = `updateOne({_id, source: 'vistaar'}, …, {upsert: true})`:

| Field | Operator | Value |
|---|---|---|
| `rating` | $setOnInsert | submission `rating` |
| `review` | $setOnInsert | submission `text` |
| `images` | $setOnInsert | `[]` |
| `pii_id` | $setOnInsert | farmer `pii_id` |
| `user` | $setOnInsert | `{contact: farmer_contact, name: farmer_name, profile_image: null, email: null}` |
| `type` | $setOnInsert | product \| combo |
| `bulk` / `family` | $setOnInsert | submission values |
| `source` | $setOnInsert | `'vistaar'` |
| `created_at` | $setOnInsert | now |
| `__v` | $setOnInsert | 0 |
| `verified` | $set | true |
| `deleted` | $set | false |
| `verified_by` | $set | HO email |
| `deleted_by` | $set | null |
| `updated_at` | $set | now |

Remove (`hide`): `updateOne({_id, source}, {$set: {deleted: true, deleted_by: HO email, updated_at: now}})` (no upsert). Consent withdrawal (`erase`): `deleteOne({_id, source: 'vistaar'})`.

- Indexes: none declared. Relied on: `_id` only. PROD-CHECKLIST line 134 asks Stockship to build `{ source, verified, deleted, created_at }` and `{ bulk, verified, deleted }` and to add `vistaar` to `REVIEW_SOURCES`.
- DISCREPANCY: none (DATABASE.md line 99 matches).

### `product_testimonials`  (raw driver in src/modules/testimonials/repositories/testimonial.repository.ts; owner: Stockship v3, shared)
- Written by (a) testimonials approval (`show` / `hide` / `erase`, video/photo only) and (b) the HO desk `/admin/testimonials` (create / update / delete). Read by the HO desk (page, counts) and My Story's Farmer story (`approvedWithReview`). Every query carries `source: 'vistaar'`.
- No schema; `_id`: ObjectId (reserved at submit for partner rows; `new Types.ObjectId()` for HO-filed rows).

Approve (`show`) = `updateOne({_id, source: 'vistaar'}, …, {upsert: true})`, only when `testimonial_id` set, kind ≠ text and a media URL exists:

| Field | Operator | Value |
|---|---|---|
| `type`, `bulk`, `family` | $setOnInsert | submission values |
| `review` | $setOnInsert | submission `text` |
| `pii_id` | $setOnInsert | farmer `pii_id` |
| `user` | $setOnInsert | `{contact, name, profile_image: null}` |
| `source` | $setOnInsert | `'vistaar'` |
| `feedbacks` | $setOnInsert | `[]` |
| `created_at` | $setOnInsert | now |
| `__v` | $setOnInsert | 0 |
| `media` | $set | `{media_type: video→'video' / photo→'image', media_url}` (refreshed on re-approval) |
| `verified` | $set | true |
| `deleted` | $set | false |
| `verified_by` | $set | HO email |
| `deleted_by` | $set | null |
| `updated_at` | $set | now |

HO-filed row (`create`, `insertOne`): `source: 'vistaar'`, `type` (product if bulk else combo), `bulk`, `family`, `verified` (dto, default false), `deleted: false`, `media` (dto; `media_type` image/video/audio), `feedbacks: []`, `review` (trimmed or ''), `pii_id: null`, `user{contact, name|null, profile_image: null}`, `verified_by` (HO email if verified else null), `deleted_by: null`, `created_at`, `updated_at`, `__v: 0`. Update = `findOneAndUpdate({_id, source}, {$set: {..., updated_at}})`; delete = `deleteOne({_id, source})`.

Remove (`hide`): `$set {deleted: true, deleted_by, updated_at}`. Consent withdrawal (`erase`): `deleteOne`.

- Indexes: none declared; relies on `_id`. PROD-CHECKLIST line 134 asks Stockship for the same two indexes as `product_reviews`.
- DISCREPANCY: none (DATABASE.md lines 100–102 match).

---

## 9A. Earning cohorts, rules, assignments, rewards

Shared types live in `src/modules/earning/earning.domain.ts` and `src/modules/rewards/rewards.domain.ts`. The constants below are copied from the code:

- `COHORT_STATUSES = ['active', 'archived']`
- `ASSIGNMENT_REASONS = ['partner_approved','partner_unblocked','profile_changed','holdings_changed','cohorts_changed','first_assignment','recompute']`
- `EARNING_TRIGGERS = ['lead_created','follow_up_done','lead_stage_advanced','reorder','meeting_attendee_captured','gig_approved','event_registered','attendance_streak','onboarding_approved','story_created']`
- `REWARD_KINDS = ['coin', 'gig']`
- `OPERATORS = ['eq','in','any_of','gte','lte']`; `FIELD_TYPES = ['string','number','string[]','enum']`
- `OPS_BY_TYPE`: string/enum → eq,in; number → eq,gte,lte; string[] → any_of. A catalog field's own `operators` overrides it (`opsOf`).
- `FOLLOW_UP_ACTIVITIES = ['call','visit','whatsapp']`
- `ADVANCE_FROM_STAGES = ['prospect','contacted','interested']`, `ADVANCE_TO_STAGES = ['contacted','interested','negotiation']`
- `REWARD_STATUSES = ['pending','approved','rejected']`; `SYSTEM_REVIEWER = 'system'`; `LEAD_REMOVED_REASON = 'lead removed'`; `BULK_MAX = 200`
- `DEFAULT_COHORT_ID = 'ec_default'`, `DEFAULT_COHORT_NAME = 'Everyone else'`
- `COHORT_ID_PATTERN = /^ec_[a-z0-9_]{1,40}$/`, `COHORT_KEY_PATTERN = /^(ec_)?[a-z0-9_]{1,40}$/`
- `MAX_STATES = 40`, `MAX_DISTRICTS = 800`, `MAX_PINCODES = 2000`, `MAX_CONDITIONS = 10` (a rule), `MAX_COHORT_CONDITIONS = 12` (a cohort), MAX_VALUES 200 (default list cap), MAX_TEXT 100, MAX_NUMBER 1,000,000
- `COHORT_FIELD_CATALOG`: the five partner facts a cohort condition can use (see the `conditions` sub-table below)

### `vistaar_v2_earning_cohorts`  (src/modules/earning/schemas/earning-cohort.schema.ts; `EarningCohort`)

- **Owner:** earning module. It is written by `EarningCohortRepository`, which is called from `EarningCohortsService` (HO `/admin/earning-cohorts`). It is read by the earning cohort and rule services, by commission (cohort names and plans), by `GET /me` (`me.service.ts`) and by gigs (`meeting_gig_payout`).
- **Options:** `collection: 'vistaar_v2_earning_cohorts'`, `timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }`, `versionKey: false`, `minimize: false`. `strict` is not set, so the Mongoose default applies.
- **`_id`:** a String set by the code, `ec_` + slug (never changes). The id is not taken from a counter. On create:
  - If HO gives a key, it must match `COHORT_KEY_PATTERN`.
  - Otherwise the id is `cohortIdOf(name)` (NFKD, lower case, non-`[a-z0-9]` → `_`, slug ≤ SLUG_MAX), or `ec_cohort` when nothing usable is left. If that id is taken, `withSuffix` (`_2`, `_3` …) is tried up to ID_TRIES times.
  - `ec_default` and ids already taken are skipped. A duplicate key on insert means `false`, and the next candidate is tried.
  - `ec_default` is built in.

| Field | Type | Required | Default | Enum / validation | Notes |
|---|---|---|---|---|---|
| `_id` | String | — | — | `ec_[a-z0-9_]{1,40}` | never changes |
| `name` | String | yes | — | | |
| `description` | String | no | `null` | | |
| `conditions` | Mixed (`RuleCondition[]`) | no | `null` | 1–`MAX_COHORT_CONDITIONS` 12, each checked by `checkConditionIn(COHORT_FIELD_CATALOG, …)` | **authoritative**; all must hold, a list value on any entry; `[]` only on `ec_default`; absent / `null` only on a row saved before conditions (converted from `filters` when read) |
| `filters` | Mixed (`EarningFilters`) | yes | — | `conditionsToFilters(conditions)` | the **legacy view**, derived from `conditions` on a best-effort basis and kept for old readers; see sub-table |
| `priority` | Number | yes | — | | 1 = first among active; `ec_default` is 0 and is always matched last |
| `status` | String | no | `'active'` | `COHORT_STATUSES` | |
| `meeting_gig_payout` | Number | no | `null` | | ₹; `null` = settings `gig_payout` |
| `version` | Number | no | `1` | | optimistic lock |
| `created_by` | String | yes | — | | HO email / `system` |
| `updated_by` | String | yes | — | | |
| `archived_by` | String | no | `null` | | |
| `archived_at` | Date | no | `null` | | |
| `created_at` / `updated_at` | Date | auto | | | timestamps |

**`conditions[]` (RuleCondition over `COHORT_FIELD_CATALOG`).** Every condition must hold (AND). A list value holds when any of its entries matches. A fact the partner does not have (`null`) never matches.

| `field` | Type | `op` | `value` |
|---|---|---|---|
| `state` | string, `upper` | `eq`, `any_of` | one text, or a list of 1–40 (`max_values`); tidied (trimmed, single spaces) and upper-cased |
| `district` | string | `eq`, `any_of` | one text, or a list of 1–800; tidied |
| `pincode` | string, `pattern ^[1-9]\d{5}$` | `eq`, `any_of` | one text, or a list of 1–2000; each must match the pattern |
| `open_leads` | number | `gte`, `lte` | finite, 0 – 1,000,000, stored as sent: open leads held now (not won, not lost) |
| `customers` | number | `gte`, `lte` | as above: leads at `won` held now |

Each text is ≤ 100 characters; a list is de-duplicated without case (`uniqueText`, first spelling kept). Matching (`matchesCondition`) compares text without case after the same tidying; `any_of` against a single-value fact means "is any of".

**`filters` (EarningFilters, the legacy view).** Several values inside one filter means any of them (OR); filters together must all hold (AND); an empty list or `null` means the filter is not used.

| Field | Type | Notes |
|---|---|---|
| `states` | string[] | upper case; ≤ MAX_STATES 40 |
| `districts` | string[] | compared without case; ≤ 800 |
| `pincodes` | string[] | six digits; ≤ 2000 |
| `min_leads` | number \| null | open leads held now (not won, not lost) ≥ N |
| `min_customers` | number \| null | leads at `won` held now ≥ N |

`NO_FILTERS` = `{states:[], districts:[], pincodes:[], min_leads:null, min_customers:null}`.

Conversion (pure, in `earning.domain.ts`):
- **`filtersToConditions`** (legacy input, and rows without `conditions`). It first runs `normalizeFilters`: states are upper-cased, values tidied and de-duplicated, and a `0` threshold counts as not used (`> 0`, floored). It then emits, in this fixed order: `{state, any_of}`, `{district, any_of}`, `{pincode, any_of}`, `{open_leads, gte}`, `{customers, gte}`.
- **`conditionsToFilters`** (the stored and returned view). It takes the first `state` / `district` / `pincode` condition with `eq` or `any_of` (an `eq` becomes a one-item list), and the first `open_leads` / `customers` condition with `gte`. Every other condition (any `lte`, a second condition on the same field) is left out of the view.
- **On read:** the services' `withConditions` and `cohortConditionsOf` (used by the matcher) convert a row without `conditions` from its `filters`. The row itself is not rewritten; no migration script exists on beta.

- **Indexes:** `{ status: 1, priority: 1 }`.
- **Write patterns:**
  - `ensureDefault`: `updateOne({_id:'ec_default'}, {$setOnInsert:{name:'Everyone else', description:'Every partner no other cohort takes.', conditions:[], filters:NO_FILTERS, priority:0, status:'active', meeting_gig_payout:null, version:1, created_by:'system', updated_by:'system', archived_by:null, archived_at:null}}, {upsert:true})`. A duplicate key error (two processes) is swallowed. A default row written before conditions existed keeps no `conditions`; it is converted from `NO_FILTERS` to `[]` on read.
  - `create`: insert with `conditions` (checked, or converted from legacy `filters`) and `filters: conditionsToFilters(conditions)`; a duplicate key means `false`.
  - `save` (edit name / description / conditions + derived filters / meeting_gig_payout): `findOneAndUpdate({_id, version, status:'active'}, {$set:{…, updated_by}, $inc:{version:1}})`. `conditions` and `filters` are written together, and only when HO sends `conditions` or legacy `filters`. A name-only edit of a pre-conditions row leaves it without `conditions`.
  - `archive`: `findOneAndUpdate({_id, status:'active'}, {$set:{status:'archived', archived_by, archived_at:now, updated_by}, $inc:{version:1}})`.
  - `setPriorities`: `bulkWrite` of `updateOne({_id, status:'active'}, {$set:{priority:i+1, updated_by}})`. This does **not** `$inc` `version`.
  - Reads: `find()` returns every cohort, archived ones included. Also `findById`.
- **Lifecycle:** create → edit (optimistic) → archive. Never deleted.
- **DISCREPANCY:** DATABASE.md says "`version` (optimistic; +1 on every edit and archive)". In code, a priority reorder (`setPriorities`) changes `priority` and `updated_by` without raising `version`. On the `conditions` / `filters` fields, DATABASE.md matches the code.

---

### `vistaar_v2_earning_rules`  (src/modules/earning/schemas/earning-rule.schema.ts; `EarningRule`)

- **Owner:** earning module. It is written by `EarningRuleRepository`, called from `EarningRulesService` (HO `/admin/earning-rules`). It is read by the rewards service (active rules of the partner's cohort for a trigger), by HO lists, and by `GET /me` (`appCohort`).
- **Options:** `collection: 'vistaar_v2_earning_rules'`, timestamps `created_at` / `updated_at`, `versionKey: false`, `minimize: false`.
- **`_id`:** String UUID.

| Field | Type | Required | Default | Enum / validation | Notes |
|---|---|---|---|---|---|
| `_id` | String | — | — | UUID | |
| `cohort_id` | String | yes | — | | earning cohort `ec_…` |
| `name` | String | yes | — | | |
| `trigger` | String | yes | — | `EARNING_TRIGGERS` (10) | |
| `conditions` | [Mixed] (`RuleCondition[]`) | no | `[]` | ≤ MAX_CONDITIONS 10; each checked by `checkCondition` against `TRIGGER_CATALOG` | all must hold; empty = the rule pays every time the trigger fires |
| `reward` | Mixed (`RuleReward`) | yes | — | | see sub-table |
| `order` | Number | yes | — | | order within the cohort; the first matching rule per reward kind pays |
| `status` | String | no | `'active'` | `COHORT_STATUSES` | |
| `version` | Number | no | `1` | | optimistic lock |
| `created_by` / `updated_by` | String | yes | — | | |
| `archived_by` | String | no | `null` | | |
| `archived_at` | Date | no | `null` | | |
| `created_at` / `updated_at` | Date | auto | | | |

**`conditions[]` (RuleCondition)**

| Field | Type | Validation |
|---|---|---|
| `field` | string | must be a catalog field of the trigger (stored as `field.key`) |
| `op` | `eq`\|`in`\|`any_of`\|`gte`\|`lte` | must be in `opsOf(field)` (the type's `OPS_BY_TYPE`; no trigger field overrides it) |
| `value` | string \| number \| string[] | Depends on the field type:<br>**number:** finite, 0 – 1,000,000.<br>**eq:** one text ≤ 100 characters, tidied, upper case if `upper`, and inside `values` for an enum.<br>**in / any_of:** a list of 1 – 200 texts, de-duplicated (`uniqueText`), inside `values` for an enum |

**Trigger catalog (code, not stored)**

| Trigger | Fields (key: type) |
|---|---|
| `lead_created` | `crops`: string[]; `acreage`: number; `farmer_district`: string; `farmer_state`: string (upper) |
| `follow_up_done` | `activity_type`: enum (call/visit/whatsapp); `days_overdue`: number (0 = due today) |
| `lead_stage_advanced` | `to_stage`: enum (`ADVANCE_TO_STAGES`); `from_stage`: enum (`ADVANCE_FROM_STAGES`) |
| `reorder` | `gap_days`: number |
| `meeting_attendee_captured` | `crops`: string[]; `acreage`: number |
| `gig_approved` | `attendees`: number; `photos`: number |
| `event_registered` | `event_id`: string |
| `attendance_streak` | `streak_days`: number |
| `onboarding_approved` | `partner_type`: string; `state`: string (upper) |
| `story_created` | `template`: string |

**`reward` (RuleReward)**

| Field | Type | Notes |
|---|---|---|
| `kind` | `coin`\|`gig` | |
| `amount` | number | coins, or ₹ for a gig; a whole number ≥ 1 |

- **Indexes:** `{ cohort_id: 1, trigger: 1, status: 1, order: 1 }`.
- **Write patterns:**
  - `create`: insert. The new `order` comes from `maxOrder` (highest active `order` in the cohort, or 0).
  - `save` (name / conditions / reward): `findOneAndUpdate({_id, version, status:'active'}, {$set:{…, updated_by}, $inc:{version:1}})`.
  - `archive`: `findOneAndUpdate({_id, status:'active'}, {$set:{status:'archived', archived_by, archived_at, updated_by}, $inc:{version:1}})`.
  - `setOrder`: `bulkWrite` of `updateOne({_id, cohort_id, status:'active'}, {$set:{order:i+1, updated_by}})`. This does not raise `version`.
  - Reads:
    - `list` filters on `cohort_id` / `trigger` / `status`, sorts `{cohort_id:1, order:1, _id:1}`, limit 2000.
    - `active(cohortId, trigger?)` reads `status:'active'`, sorted `{order:1, _id:1}`.
- **Lifecycle:** create → edit → archive. Never deleted, because rewards name the rule.
- **DISCREPANCY:** DATABASE.md (and the CLAUDE.md collections table) still give the trigger catalog as `lead_created`, `follow_up_done`; the code's `EARNING_TRIGGERS` has the ten above (EARNINGS-HO.md lists all ten). Also, `setOrder` changes rows without raising `version`, which is the same pattern as the cohorts reorder above.

---

### `vistaar_v2_earning_assignments`  (src/modules/earning/schemas/earning-assignment.schema.ts; `EarningAssignment`)

- **Owner:** earning module. It is written by `EarningAssignmentRepository`, called from `EarningCohortsService`. The service is triggered by:
  - partner events: approve / unblock, holdings changes, and a `PATCH /me` place edit (`profile_changed`)
  - HO cohort changes
  - recompute (HO's button, and the `backfill-partner-place` script)

  It is read by commission (the cohort at the time an order was placed) and by the HO history screen.
- **Options:** `collection: 'vistaar_v2_earning_assignments'`, `timestamps: { createdAt: 'created_at', updatedAt: false }`, `versionKey: false`.
- **`_id`:** String `randomUUID()`.

| Field | Type | Required | Default | Enum | Notes |
|---|---|---|---|---|---|
| `_id` | String | — | — | UUID | |
| `agent_id` | String | yes | — | | `VST-…` |
| `cohort_id` | String | yes | — | | |
| `from` | Date | yes | — | | |
| `to` | Date | no | `null` | | `null` while current |
| `open` | Boolean | yes | — | | `true` while current |
| `reason` | String | yes | — | `ASSIGNMENT_REASONS` | |
| `created_at` | Date | auto | | | no `updated_at` |

- **Indexes:**
  - `{ agent_id: 1, from: -1 }`
  - `{ agent_id: 1 }` with `{ unique: true, partialFilterExpression: { open: true } }`
- **Write patterns:**
  - `switchTo`: closes the open row with `updateOne({_id: openId, open:true}, {$set:{open:false, to:since}})`. If `modifiedCount !== 1`, it returns `false`. Then it inserts the new open row (`to:null, open:true`); a duplicate key on the unique partial index means `false` (another process won).
  - `switchMany`: does the same with an unordered `bulkWrite`, closes first and inserts second. It returns the agent ids whose insert succeeded; duplicate key write errors are collected and every other error is thrown.
  - After a move, the service copies `{id, since}` to `vistaar_v2_agents.earning_cohort` (see below).
  - Reads:
    - `open(agentId)`
    - `openAll()` (select `_id, agent_id, cohort_id, from`)
    - `history` (sort `from:-1`, cap 500)
    - `forAgents` (`$in`, sort `agent_id:1, from:1`)
    - `at(agentId, at)` (`from ≤ at`, sort `from:-1`)
- **Lifecycle:** insert open → close (`to` set, `open:false`). Never edited after that and never deleted. A cohort archived while partners still hold an open row in it keeps that row until the recompute moves them; meanwhile the services read their current cohort as `ec_default`. The row is not changed.
- **DISCREPANCY:** none. DATABASE.md and PROD-CHECKLIST.md match the code (fields, reasons, both indexes).

---

### `vistaar_v2_rewards`  (src/modules/rewards/schemas/reward.schema.ts; `Reward`)

- **Owner:** rewards module. It is written by `RewardRepository`, called from `RewardsService`. Inserts come from the event methods; decisions come from HO review and from the system:

  | Writer | Trigger it records |
  |---|---|
  | leads service | `lead_created` (after farmer OTP; also a meeting capture's new lead), `follow_up_done` (a call / visit / WhatsApp activity), `lead_stage_advanced` (a forward stage move), and `leadRemoved` (system rejection) |
  | customers service (`/hooks/orders/confirmed`) | `reorder` |
  | meetings service | `meeting_attendee_captured` |
  | admin gigs service (HO approve) | `gig_approved` |
  | events service (seat taken) | `event_registered` |
  | attendance service (punch-out) | `attendance_streak` |
  | partner desk (HO approve, after placing) | `onboarding_approved` |
  | stories service (new story) | `story_created` |
  | HO review (`/admin/rewards`) | approve / reject decisions |

  It is read by the Vistaar app (`/rewards`, list and summary), by HO, and by commission (`approvedGigs` reach the wallet while `gig_pay_enabled`).
- **Options:** `collection: 'vistaar_v2_rewards'`, timestamps `created_at` / `updated_at`, `versionKey: false`, `minimize: false`.
- **`_id`:** a String set by `rewardIdOf(trigger, kind, ...parts)` = `[trigger, ...parts, kind].join(':')`, where `parts` is the event's once-only key. A duplicate insert means the event was already rewarded.

| Trigger | `_id` | `pii_id` | `ref_id` |
|---|---|---|---|
| `lead_created` | `lead_created:<pii_id>:<kind>` | farmer | `null` |
| `follow_up_done` | `follow_up_done:<pii_id>:<YYYY-MM-DD IST due day>:<kind>` | farmer | `null` |
| `lead_stage_advanced` | `lead_stage_advanced:<pii_id>:<to_stage>:<kind>` | farmer | `null` |
| `reorder` | `reorder:<order_id>:<kind>` | farmer | order id |
| `meeting_attendee_captured` | `meeting_attendee_captured:<meeting_id>:<pii_id>:<kind>` | farmer | meeting id |
| `gig_approved` | `gig_approved:<gig_id>:<kind>` | `null` | gig id |
| `event_registered` | `event_registered:<event_id>:<AGENT_ID>:<kind>` | `null` | event id |
| `attendance_streak` | `attendance_streak:<AGENT_ID>:<YYYY-MM-DD>:<kind>` | `null` | the IST day |
| `onboarding_approved` | `onboarding_approved:<AGENT_ID>:<kind>` | `null` | the agent id |
| `story_created` | `story_created:<story_id>:<kind>` | `null` | story id |

The due day comes from `istDayKey` (UTC+5:30); agent ids in a key are upper case. The HO routes accept an id only if it matches `REWARD_ID` in `reward.dto.ts`: `^(?:<EARNING_TRIGGERS joined by |>)(?::[A-Za-z0-9_/-]{1,64}){1,3}:(?:coin|gig)$`. Before 2026-10-21 the check matched only `PII-` ids with an optional date.

| Field | Type | Required | Default | Enum | Notes |
|---|---|---|---|---|---|
| `_id` | String | — | — | see above | |
| `agent_id` | String | yes | — | | `VST-…` |
| `rule_id` | String | yes | — | | |
| `rule_name` | String | yes | — | | the rule's name at the time |
| `kind` | String | yes | — | `REWARD_KINDS` | |
| `trigger` | String | yes | — | `EARNING_TRIGGERS` | |
| `pii_id` | String | no | `null` | | the farmer, on a trigger about one; else `null` (was required before the new triggers) |
| `farmer_name` | String | no | `null` | | the farmer's name at the time |
| `ref_id` | String | no | `null` | | **new:** the non-farmer subject (order, meeting, gig, event, story, IST day, or the partner for `onboarding_approved`); else `null` |
| `due_day` | String | no | `null` | | `follow_up_done` only |
| `amount` | Number | yes | — | | a whole number ≥ 1: coins, or ₹ for a gig (rows with any other amount are not inserted) |
| `cohort_id` | String | yes | — | | the partner's earning cohort at the time (`ec_default` while their own cohort is archived but not yet recomputed) |
| `status` | String | no | `'pending'` | `REWARD_STATUSES` | |
| `reason` | String | no | `null` | | rejection reason (`'lead removed'` from the system) |
| `reviewed_by` | String | no | `null` | | HO email or `'system'` |
| `reviewed_at` | Date | no | `null` | | an approved gig is earned from this moment |
| `created_at` / `updated_at` | Date | auto | | | |

The facts used to match rules are **not** stored on the row. They are each trigger's catalog fields: `crops`, `acreage`, `farmer_district`, `farmer_state`, `activity_type`, `days_overdue`, `to_stage`, `from_stage`, `gap_days`, `attendees`, `photos`, `event_id`, `streak_days`, `partner_type`, `state` and `template`.

When a follow-up counts (`dueFollowUp`): the activity must be in `FOLLOW_UP_ACTIVITIES` and `next_follow_up` must be before the end of today in IST. `days_overdue = max(0, istDaysBetween)`. No row is inserted for a partner not yet placed in a cohort (`evaluate` returns nothing without a placement).

- **Indexes:**
  - `{ status: 1, created_at: -1, _id: 1 }`
  - `{ agent_id: 1, created_at: -1, _id: 1 }`
- **Write patterns:**
  - `insertNew`: inserts one row at a time with `create`. A duplicate key (11000) is skipped, and the call returns the ids it inserted.
  - `decide`: `findOneAndUpdate({_id, status:'pending'}, {$set:{status, reason, reviewed_by, reviewed_at}})`.
  - `decideMany`: `updateMany({_id:{$in}, status:'pending', [agent_id]}, same $set)`, at most 200 ids per HO bulk call. `bulkOutcome` then sorts the ids into changed and skipped.
  - `leadRemoved`: runs `decideMany` on the `lead_created` coin and gig ids for that farmer → `rejected`, `reason 'lead removed'`, `reviewed_by 'system'`, filtered by `agent_id`. Other triggers' rows are not touched.
  - Reads:
    - `page` and `totals` (aggregate grouped by kind × status, count and Σ amount). When no status is given, the filter is `status: {$in: all three}`, so the index can merge the three ranges.
    - Optional filters: `kind`, `trigger`, `created_at` `$gte from` / `$lt to`.
    - `approvedGigs` (`agent_id, kind:'gig', status:'approved'`), any trigger.
- **Lifecycle:** pending → approved | rejected (only a pending row can be decided). Never deleted.
- **DISCREPANCY:**
  - DATABASE.md (and the CLAUDE.md collections table) still describe only the first two triggers. They give `_id` as `lead_created:<pii_id>:<kind>` / `follow_up_done:<pii_id>:<IST due day>:<kind>`, `trigger` as lead_created/follow_up_done, and `pii_id` + `farmer_name` as always the farmer, with no `ref_id`. The code has ten triggers, `_id` `<trigger>:<1–3 key parts>:<kind>`, `pii_id` default `null`, and the `ref_id` field. EARNINGS-HO.md and EARNINGS-APP.md match the code.
  - PROD-CHECKLIST.md also says rewards write `vistaar_v2_leads.otp_verified_at` and `vistaar_v2_otp_attempts` `lead-*` rows (the farmer OTP flow). Those writes are outside `RewardRepository`, and I did not check them here.

---

### Other writes made by these modules

`vistaar_v2_agents.earning_cohort` (agents schema; `EarningCohortRef {id: string; since: Date}`) is a Mixed field with `default: undefined`, and is absent until the partner is first assigned.

- It is written only through `AgentsService.setEarningCohorts`, which is called by the earning module. That calls `AgentRepository.setEarningCohorts`: `bulkWrite` of `updateOne({agent_id}, {$set:{earning_cohort}}, timestamps:false)`, unordered, so `updated_at` is not touched.
- It is read by `countByEarningCohort`: `{otp_verified:true, stage:'approved', 'earning_cohort.id':{$type:'string'}}`.

This matches DATABASE.md and PROD-CHECKLIST.md ("only the three `vistaar_v2_earning_*` collections and `vistaar_v2_agents.earning_cohort` are written").

DISCREPANCY (minor): DATABASE.md describes `priority` as "1 = first among active; the default is always last". The code stores `ec_default` with `priority: 0`, as the schema comment says ("its own is 0"). The docs never state the 0.

---

## 10. Code vs docs: discrepancies

Each item was found by reading beta's code (`5113b6c`) next to beta's `docs/DATABASE.md`, `docs/PROD-CHECKLIST.md`, the feature docs and `CLAUDE.md`. The sections above show what the code does. Every item of the 17 October list was checked again: none is fixed yet, so all are kept (item 1 and item 4 reworded for the `marketplace` filter); items 20–26 are new. Differences between the code and the production main database are in section 10A.

### 10.1 Affects production

| # | Collection | Code | Docs | Effect |
|---|---|---|---|---|
| 1 | `orders_v2` | `OrderRepository.adminList` / `adminSummary` filter `{ marketplace: 'MKTP-5', … }` and rely on Stockship's `{ marketplace, order_status, date }` index for the HO order screens (`{ agent, order_status, date }` with a partner) | `PROD-CHECKLIST.md` names only `{ agent: 1, order_status: 1, date: -1 }` | No Vistaar doc confirms the `marketplace` index; the 21 October main audit lists "indexes used" as OK. Name it in PROD-CHECKLIST before HO order screens see production volume |
| 2 | `app_counters` row `piis` | `PiiRepository.nextPiiNumber` uses `upsert: true`; a taken PII number is retried once (2 attempts) | `DATABASE.md` says counter rows are never upserted and ids are retried up to 3 times | A missing `piis` row would be created by Vistaar; the 3-try rule holds only for `leads`, `contacts`, `addresses` (also 10A, item 20) |
| 3 | `vistaar_v2_payment_credentials` | A set in status `approved` keeps its sealed `secrets` (`claimApproval` and `promote` don't touch them; only `retire()` nulls them) | `DATABASE.md` and the schema comment say secrets are null once not pending / active | `approved` is a short-lived third state holding secrets; a set stuck there blocks the provider until approved again or rejected |
| 4 | `orders_v2` (commission read) | `$nin: [...NOT_COUNTED]` (`failed`, `pseudo`, `pseudo_order`, `split`, `merged`, `merge`) compares the raw `order_status` exactly, while `isCounted()` trims and lower-cases first | — (code-internal) | A raw value spelled differently (`Split`, `failed `) passes the database filter |

### 10.2 Behaviour the docs don't state (or state differently)

| # | Collection | Code |
|---|---|---|
| 5 | `vistaar_v2_info_pages` | Deletable: `InfoPageRepository.remove` (`deleteOne({_id: page})`), exposed by `@Delete()` on all three admin controllers. `DATABASE.md` says never deleted |
| 6 | `leads_v2` / `contacts_v2` | A partner's re-submit updates a `leads_v2` row only when `source === 'vistaar'` **and** `created_by` is that same partner; `contacts_v2` is filtered on `source` only. `DATABASE.md` says "updates only rows Vistaar wrote" |
| 7 | `draft_orders` | Nothing in this repo sets `status: 'converted'` (every filter is `status: 'draft'`); `replace` does `$inc __v` but no filter compares it (no compare-and-set, unlike `carts`). `DATABASE.md` says `converted` is set "by checkout, later" |
| 8 | `vistaar_v2_earning_cohorts` / `_rules` | Reordering (`setPriorities`, `setOrder`) `$set`s `priority` / `order` and `updated_by` without raising `version`; `DATABASE.md` says `version` rises on every edit and archive |
| 9 | `vistaar_v2_earning_cohorts` | `ec_default` is stored with `priority: 0` (the schema comment now says "its own is 0"); `DATABASE.md` only says it is always looked at last |
| 20 | `vistaar_v2_agents` | Approving a bank-account change (`BankChangeService.approve`) also calls `AgentsService.setProfileBankAccount`, which `$set`s `profile.details.bank_account = {account_holder, account_number, ifsc}` through `AgentRepository.editProfile` (filter `{_id, stage: 'approved'}`, and it also sets `updated_by: 'self'` although HO made the change); skipped when the profile has no `details`. `ONBOARDING-HO.md` §3 (*Bank account change (approved partners)*) and `ONBOARDING-APP.md` §6 (*Bank account change*) say that copy is **not** updated ("taken once at approval"); `DATABASE.md`'s agents row does not mention the write |
| 24 | `franchise_v2_pos_orders` | The KKD & App activity query has no `in_stockship` condition: every row of the farmers since the earliest hold is read (≤ 2,000), and rows with `in_stockship` true are dropped in memory. `DATABASE.md` says the read is "`in_stockship: false` only" — the result is the same, but those rows count toward the 2,000 cap |
| 25 | `vistaar_v2_attendance` → `vistaar_v2_rewards` | The `attendance_streak` fact is counted from `AttendanceRepository.range(agent, today − 60 days, today)`, which is capped at 31 rows (`MONTH_READ_CAP`, newest first), so `streak_days` never exceeds 31. The trigger catalog hint and `EARNINGS-HO.md` say the run is "counted back 60 days at most" — a rule `streak_days is 45` (or `≥ 45`) can never pay |

### 10.3 Documentation gaps only

| # | Where | Gap |
|---|---|---|
| 10 | `PROD-CHECKLIST.md` (My Story gate) | Says "the nine story / event indexes"; the code and the checklist's own `createIndex` list have 11 (stories 2, story_stats 1, festivals 2, samples 2, designs 2, events 1, event_registrations 1) |
| 11 | `DATABASE.md` index section | Not the same as the code: omits the 2 `vistaar_v2_payment_option_audit` and 3 `vistaar_v2_payment_credentials` indexes, `vistaar_v2_order_ids` `{order_id}`, leads `{stage, created_at:-1}` and `{agent_id, location: 2dsphere}` (the latter only named in the radar paragraph), gigs `{starts_at:-1, _id:-1}`; writes the meetings indexes without their `_id:-1` tail; and says attendance has "none beyond `_id`" while the schema declares `{date: 1}`. All of these are in `PROD-CHECKLIST.md` (attendance and order ids in their gates) |
| 12 | `vistaar_v2_withdrawals` | `status` has no schema enum (TypeScript type only) |
| 13 | `vistaar_v2_settings` | `conflict_radius_km` default is 5 in code (no default in docs); `updated_by` / `updated_at` undocumented |
| 14 | `vistaar_v2_sessions` | `DATABASE.md` omits `created_at` (required) and `user_agent` (default null) |
| 15 | `vistaar_v2_onboarding_configs` | `DATABASE.md` omits `cohort`, `version`, `notes`, `created_by`, `updated_by`, timestamps |
| 16 | `vistaar_v2_counters` | `CLAUDE.md` collections table lists VST- / WD- / GIG- only; code and `DATABASE.md` also have `product_suggestion` (SUG-), which `CLAUDE.md`'s own Feedback row names |
| 17 | `piis`, `app_counters`, `addresses` | `DATABASE.md` lists their writes under "Read-only, other apps" / "Read-only, shared identity"; the code writes them (documented elsewhere in the same file) |
| 18 | `pincode_map_v2` | `DATABASE.md` "Shared — read only" says cached 6 h; code refreshes every 24 h (`pincode.service.ts`, `REFRESH_MS`), matching the same file's radar paragraph |
| 19 | `PROD-CHECKLIST.md` | The agents `{otp_verified, stage, last_login_at: -1}` index is listed apart from the other agents indexes (complete, just split) |
| 21 | `orders_v2` | `DATABASE.md`'s commission row says one aggregation on `{ agent, source }` with `$nin` failed / pseudo / split / merged; the code matches `{ agent, marketplace: 'MKTP-5' }` and `$nin` `NOT_COUNTED` (failed, pseudo, `pseudo_order`, split, merged, `merge`). `CLAUDE.md` still says the partner's orders carry `source: 'vistaar'` (its *Other apps' collections* paragraph); `DATABASE.md`'s partner-orders row and `PROD-CHECKLIST.md` already say `marketplace: 'MKTP-5'` |
| 22 | `vistaar_v2_rewards`, `vistaar_v2_earning_rules` | `DATABASE.md` and the `CLAUDE.md` collections table describe only the two first triggers (`lead_created`, `follow_up_done`) and the two first `_id` shapes, with `pii_id` always set and no `ref_id`. Code: 10 triggers (`EARNING_TRIGGERS`: also `lead_stage_advanced`, `reorder`, `meeting_attendee_captured`, `gig_approved`, `event_registered`, `attendance_streak`, `onboarding_approved`, `story_created`), `_id` = `<trigger>:<1–3 key parts>:<kind>` (`rewardIdOf`), `pii_id` default `null` (set only on a farmer trigger), new `ref_id` (order, meeting, gig, event, story, the streak's IST day or the partner). `EARNINGS-HO.md` is current |
| 23 | `vistaar_v2_payment_options` / `_credentials` | `CLAUDE.md`'s Payment options row says an option is "shown only with approved keys". Since 2026-10-21 Cashfree is keyless (`KEYLESS_PROVIDERS`): it is shown and switched on with no credentials row (`keys_required: false`, `configured: true`), a key submit for it is refused (`400 CREDENTIALS_NOT_USED`), and it is left out of the credentials overview. `PAYMENTS-HO.md` is current |
| 26 | `DATABASE.md` layout | A doubled heading (`## Shared — written` above `## Shared — written by this service with source: 'vistaar'`), and two orphaned lines at the end of *Seed* — a sentence fragment about `src/scripts/default-forms.ts` and a table row for `vistaaragents`, `vistaarfarmers` with no table |

---

## 10A. Code vs production main DB (read-only audit, 21 October 2026)

On 21 October 2026 the production main database (`CRM-Database` on the main Atlas cluster) was read — read-only, nothing written — and compared with beta's code as it was then (`05ad745`). Each item below is re-checked against beta `5113b6c` and marked:

- **Fixed on beta** — the code at `5113b6c` no longer has the problem.
- **Open** — still true at `5113b6c`; needs a code change, a decision or another team's data fix.
- **Setup step** — the code is right; something must be created or set in production before the feature is switched on (most are already in `PROD-CHECKLIST.md`).

Counts are as the audit found them on main. No personal data is listed.

### 10A.1 Launch blockers and setup

| # | Main DB found | Code at `5113b6c` | Status |
|---|---|---|---|
| 1 | No `app_counters` row `_id: 'vistaar_orders'` | `OrderIdService.issue` takes `KSV-n` from it through `PiiService.tryNextOrgNumber` (`$inc`, never an upsert); a missing row → `null` → 503 `ORDER_ID_UNAVAILABLE`, so no Vistaar order number can be issued | **Setup step** — `db.app_counters.insertOne({ _id: 'vistaar_orders', count: 0, updated_at: new Date() })` once (PROD-CHECKLIST *Order numbers*); the audit notes another developer owns creating it |
| 2 | 5 active Offline Heads (`USR-1037`) in `agents_v2` | The farmer-lead owner is `settings.lead_owner_agent_id` when set, else the **one** active Offline Head: `AccessService.offlineHead()` reads at most 2 and returns `null` unless exactly one comes back. With 5, `POST /leads` for a new person answers 503 `LEADS_NOT_CONFIGURED` before anything is written | **Setup step** — set `lead_owner_agent_id` (`PUT /admin/settings`) or leave exactly one active head (PROD-CHECKLIST *Data*). A change that makes the approving head the owner is not on beta |
| 3 | Role `USR-1040` "Vistaar Partner" missing from `userroles` (highest is `USR-1039`) | `PARTNER_ROLE_CODE = 'USR-1040'` is written on `vistaar_v2_agents.user_role`; the code never writes `userroles` | **Setup step** — by the ko-sales owner, after checking the max is still `USR-1039` (PROD-CHECKLIST *Data*) |
| 4 | All 5 `USR-1037` holders would get head rights | `HEAD_ROLE_CODES` = `USR-1037` + `USR-1000` / `USR-1001`; every `head` capability goes to each of them, including `payouts.manage`, `commission.read`, `commission.plans`, `earning.*`, `rewards.*`, `payments.read/write` (merchant keys stay admin-only) | **Open** — TL to confirm that every Offline Head should hold payouts and commission plans |

### 10A.2 Shared-collection shape differences (what the code writes vs main's rows)

| # | Main DB found | Code at `5113b6c` | Status |
|---|---|---|---|
| 5 | `piis.documents.bank_details` rows are `{account_number, ifsc_code, bank_name}` | KYC verify and bank-change approval write `documents.bank_details` as `{id, image, back_image?, is_verified, validity: null, source: 'vistaar', verified_at}` (bank change: `{id: null, image}` + the same flags) — only into a slot that is absent, `null` or already `source: 'vistaar'`, so main's existing entries are never replaced, but a new Vistaar entry has a different shape from theirs | **Open** — agree the entry shape with ko-sales |
| 6 | `addresses` rows from ko-sales use `address1` (572 of 573 recent rows with a `pii_id`) | Vistaar's row writes `address_line` (= village) and `village`; no `address1` | **Open** |
| 7 | `contacts_v2.current_stage` on 3,000 of 3,000 recent rows | `contactDocOf` writes no `current_stage` | **Open** |
| 8 | Every `terms_and_conditions` row has `created_at` / `updated_at` | The terms schema has no timestamps and no repository sets them | **Open** |
| 9 | `piis.documents` licence slots are mostly arrays; other portals file a back side as a `<type>_back` slot | Vistaar writes one object into an empty slot (never over an array or another portal's entry) and keeps a back side as a `back_image` key inside it — a key no other portal uses | **Open** |
| 10 | `addresses.pii_id` is not unique | `AddressRepository`: find the person's Vistaar row, else insert; no unique key on `{pii_id, source}`, so two concurrent first adds for one person can leave two Vistaar rows | **Open** |

### 10A.3 Reads and numbers

| # | Main DB found | Code at `5113b6c` | Status |
|---|---|---|---|
| 11 | `orders_v2.order_status` values `merge` (12,276), `outbound_cancelled` (2,536), `manifested` (6), `status_17` (763) were unmapped (read as "placed") | `orders.domain.ts` `RAW_STATUS` now maps Stockship's V2 names (checked against Stockship's `order-status.const.ts` on 2026-10-21): `merge` → cancelled (and in `NOT_COUNTED`, so commission skips it as it skips `merged`), `outbound_cancelled` → cancelled, `manifested` → punched, plus `new_order`, `inventory_short`, `hod_pending`, `sent_to_xd`, `received_from_xd`, `ready_to_invoice`, `picking`, `picked`, `pseudo_order`, `partial_rto` and others; `failed` now reads as cancelled. `status_17` is still not mapped and reads as "placed" | **Fixed on beta** for `merge`, `outbound_cancelled`, `manifested`; **Open** for `status_17` (ask Stockship what it means) |
| 12 | `categories_v2` does not exist on main; `bulk_v2.category` is a plain lower-case string (1,176 of 1,176) | `ProductFactsRepository` still reads `bulk_v2.category.cat_id` and joins `categories_v2.category_id` → `name`; on main every category comes out `null` and shows as `Other` (the HO orders summary's by-category split, My Performance) | **Open** |
| 13 | 124 old KSS orders on `MKTP-5` (agent ids of the old `V-n` / `A0-` kinds) | HO filters are `{ marketplace: 'MKTP-5', … }` with no `VST-` guard on `agent` (`adminFilter`, and the all-partners customer business read), so those orders appear in HO lists, cards and stats. A partner's own reads filter `agent` = their `VST-` id and are not affected | **Open** |

### 10A.4 Low

| # | Main DB found | Code at `5113b6c` | Status |
|---|---|---|---|
| 14 | `pincode_map_v2`: 24 rows with no `geo`, 6 points outside India | `withTrustedCentres` replaces a missing point, or one more than 60 km from its district's median, by that median (or `null` when the district has none) — the wrong points do not reach the radar or the store list | **Open** (data, ko-sales); the code copes |
| 15 | `franchises` `FR-100` and `FR-101` share one map point; `FR-101` is named like a test warehouse | Every store with a map point is read (radar KKD stores, KKD & App activity store list and 50 km list); nothing is excluded | **Open** (data, franchise team) |
| 16 | 47 `agents_v2` accounts with a single-digit phone number | The reporting officer's phone is `String(contact.phone_number)` as stored, not checked | **Open** (data, ko-sales) |
| 17 | `combos_v2.family` is not unique | `TestimonialRepository.comboName` takes the first `findOne({family})`, so a combo testimonial may carry another row's name | **Open** |
| 18 | One `bulk_v2` with `gst_rate: "#REF!"` (4 products) | Parsed to `null`; commission then uses `UNKNOWN_GST_RATE = 18` | **Open** (data, Stockship); the code copes |
| 19 | `lead_sources` has no `vistaar` row | The code never writes `lead_sources`; CRM source filters will not list Vistaar's leads without it | **Setup step** (optional, PROD-CHECKLIST *Farmer leads*: `{ source_code: 'vistaar', display_name: 'Vistaar Agent' }`, by ko-sales) |
| 20 | — | `PiiRepository.nextPiiNumber` still `$inc`s `app_counters._id: 'piis'` with `upsert: true`, unlike every other series (section 10, item 2). On main the `piis` row exists, so the upsert creates nothing there | **Open** (code consistency) |

### 10A.5 Found in line with main

The audit found these as the code expects: the `piis` lookup and insert, and the unique partial phone index on `piis`; every other `app_counters` row at or above the highest id in use; the `carts` and `draft_orders` row shapes; `terms_and_conditions` `TOC-n` numbering and its indexes; the `product_reviews` / `product_testimonials` shapes; the `orders_v2` fields the code reads; the commission `$match` (`marketplace: 'MKTP-5'` + `agent`), discounts, coins and `order_status_map`; and the indexes the reads use.

---

## 11. Production index list

`IndexSyncService` builds these outside production only. On production, create them by hand before each feature goes live. Regenerated at beta `5113b6c` from every `Schema.index(...)` in `src/modules/*/schemas/*.schema.ts` (no schema uses `@Prop({ index })` or a prop-level `unique`): **85 indexes on 32 collections**, and each one matches a command in `PROD-CHECKLIST.md` — the 83 of its *Indexes* block, plus `vistaar_v2_attendance` `{date}` (*Attendance* gate) and `vistaar_v2_order_ids` `{order_id}` (*Order numbers* gate). New since 17 October: the two partial `id_keys` indexes on `vistaar_v2_onboarding_data` (build them before running `backfill-id-keys.js`) and `vistaar_v2_order_ids` `{order_id}` (support lookups only — one number per checkout attempt rests on `_id`).

No index beyond `_id`: `vistaar_v2_story_templates`, `vistaar_v2_commission_plans`, `vistaar_v2_info_pages`, `vistaar_v2_cohorts`, `vistaar_v2_counters`, `vistaar_v2_settings`, `vistaar_v2_payment_options`. Shared collections get no index from Vistaar: their schemas declare none and `autoIndex: false` is set on `orders_v2`, `piis`, `addresses`, `app_counters`, `pincode_map_v2` and `agents_v2` (`terms_and_conditions` already has `{toc_id}` unique and `{profiles, is_active}`). `PROD-CHECKLIST.md` records that on 2026-10-09 none of these existed on beta (Mongo host out of disk).

```js
db.vistaar_v2_agents.createIndex({ phone: 1, country_code: 1 }, { unique: true })
db.vistaar_v2_agents.createIndex({ agent_id: 1 }, { unique: true, partialFilterExpression: { agent_id: { $type: 'string' } } })
db.vistaar_v2_agents.createIndex({ pii_id: 1 }, { unique: true, partialFilterExpression: { pii_id: { $type: 'string' } } })
db.vistaar_v2_agents.createIndex({ otp_verified: 1, stage: 1, updated_at: -1 })
db.vistaar_v2_agents.createIndex({ owner_agent_id: 1, stage: 1 })
db.vistaar_v2_agents.createIndex({ otp_verified: 1, stage: 1, decided_at: -1 })
db.vistaar_v2_agents.createIndex({ location: '2dsphere' })
db.vistaar_v2_onboarding_data.createIndex({ agent_ref: 1 }, { unique: true })
db.vistaar_v2_onboarding_data.createIndex({ location: '2dsphere' })
db.vistaar_v2_onboarding_data.createIndex({ 'id_keys.aadhaar_hash': 1 }, { partialFilterExpression: { 'id_keys.aadhaar_hash': { $exists: true } } })
db.vistaar_v2_onboarding_data.createIndex({ 'id_keys.pan': 1 }, { partialFilterExpression: { 'id_keys.pan': { $exists: true } } })
db.vistaar_v2_onboarding_configs.createIndex({ cohort: 1, version: -1 }, { unique: true })
db.vistaar_v2_onboarding_configs.createIndex({ cohort: 1, status: 1 }, { unique: true, partialFilterExpression: { status: 'draft' } })
db.vistaar_v2_otp_attempts.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 })
db.vistaar_v2_sessions.createIndex({ agent_ref: 1 })
db.vistaar_v2_sessions.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 })
db.vistaar_v2_banners.createIndex({ is_active: 1, order: 1 })
db.vistaar_v2_stories.createIndex({ agent_id: 1, signature: 1 }, { unique: true })
db.vistaar_v2_stories.createIndex({ agent_id: 1, last_used_at: -1 })
db.vistaar_v2_story_stats.createIndex({ date: 1, agent_id: 1 })
db.vistaar_v2_story_festivals.createIndex({ key: 1 }, { unique: true })
db.vistaar_v2_story_festivals.createIndex({ is_active: 1, order: 1 })
db.vistaar_v2_story_samples.createIndex({ key: 1 }, { unique: true })
db.vistaar_v2_story_samples.createIndex({ is_active: 1, order: 1 })
db.vistaar_v2_story_designs.createIndex({ key: 1 }, { unique: true })
db.vistaar_v2_story_designs.createIndex({ is_active: 1, order: 1 })
db.vistaar_v2_faqs.createIndex({ q_key: 1 }, { unique: true })
db.vistaar_v2_faqs.createIndex({ is_active: 1, order: 1 })
db.vistaar_v2_faqs.createIndex({ category: 1, order: 1 })
db.vistaar_v2_faq_sections.createIndex({ is_active: 1, order: 1 })
db.vistaar_v2_events.createIndex({ is_active: 1, starts_at: 1 })
db.vistaar_v2_event_registrations.createIndex({ event_id: 1, created_at: 1 })
db.vistaar_v2_meetings.createIndex({ agent_id: 1, starts_at: -1, _id: -1 })
db.vistaar_v2_meetings.createIndex({ starts_at: -1, _id: -1 })
db.vistaar_v2_gigs.createIndex({ status: 1, starts_at: 1 })
db.vistaar_v2_gigs.createIndex({ agent_id: 1, starts_at: -1, _id: -1 })
db.vistaar_v2_gigs.createIndex({ starts_at: -1, _id: -1 })
db.vistaar_v2_gigs.createIndex({ 'attendees.phone': 1, starts_at: -1 })
db.vistaar_v2_leads.createIndex({ pii_id: 1 }, { unique: true })
db.vistaar_v2_leads.createIndex({ agent_id: 1, created_at: -1 })
db.vistaar_v2_leads.createIndex({ agent_id: 1, stage: 1 })
db.vistaar_v2_leads.createIndex({ agent_id: 1, next_follow_up: 1 })
db.vistaar_v2_leads.createIndex({ created_at: -1 })
db.vistaar_v2_leads.createIndex({ stage: 1, created_at: -1 })
db.vistaar_v2_leads.createIndex({ phone: 1 })
db.vistaar_v2_testimonials.createIndex({ agent_id: 1, created_at: -1 })
db.vistaar_v2_testimonials.createIndex({ status: 1, created_at: -1, _id: -1 })
db.vistaar_v2_testimonials.createIndex({ status: 1, shares: -1, created_at: -1 })
db.vistaar_v2_testimonials.createIndex({ status: 1, bulk: 1, created_at: -1, _id: -1 })
db.vistaar_v2_testimonials.createIndex({ status: 1, crop: 1, created_at: -1, _id: -1 })
db.vistaar_v2_testimonials.createIndex({ status: 1, state: 1, district: 1, created_at: -1, _id: -1 })
db.vistaar_v2_testimonials.createIndex({ testimonial_id: 1 }, { partialFilterExpression: { testimonial_id: { $type: 'objectId' } } })
db.vistaar_v2_testimonials.createIndex({ pii_id: 1 })
db.vistaar_v2_testimonial_consents.createIndex({ pii_id: 1, given_at: -1 })
db.vistaar_v2_testimonial_consents.createIndex({ agent_id: 1, given_at: -1 })
db.vistaar_v2_feedback.createIndex({ agent_id: 1, created_at: -1 })
db.vistaar_v2_feedback.createIndex({ created_at: -1 })
db.vistaar_v2_feedback.createIndex({ bucket: 1, created_at: -1 })
db.vistaar_v2_feedback.createIndex({ 'follow_up.status': 1, 'follow_up.due_at': 1 }, { partialFilterExpression: { 'follow_up.status': { $exists: true } } })
db.vistaar_v2_product_suggestions.createIndex({ agent_id: 1, created_at: -1 })
db.vistaar_v2_product_suggestions.createIndex({ status: 1, created_at: -1 })
db.vistaar_v2_product_suggestions.createIndex({ created_at: -1 })
db.vistaar_v2_product_suggestions.createIndex({ product_key: 1, created_at: -1 })
db.vistaar_v2_leads.createIndex({ agent_id: 1, location: '2dsphere' })
db.vistaar_v2_leads.createIndex({ last_order_at: -1, _id: 1 })
db.vistaar_v2_leads.createIndex({ next_follow_up: 1, _id: 1 })
db.vistaar_v2_agents.createIndex({ otp_verified: 1, stage: 1, last_login_at: -1 })
db.vistaar_v2_payment_option_audit.createIndex({ at: -1 })
db.vistaar_v2_payment_option_audit.createIndex({ option_id: 1, at: -1 })
db.vistaar_v2_payment_credentials.createIndex({ provider: 1 }, { unique: true, name: 'one_active_per_provider', partialFilterExpression: { status: 'active' } })
db.vistaar_v2_payment_credentials.createIndex({ provider: 1, status: 1 }, { unique: true, name: 'one_pending_per_provider', partialFilterExpression: { status: 'pending' } })
db.vistaar_v2_payment_credentials.createIndex({ provider: 1, created_at: -1 })
db.vistaar_v2_withdrawals.createIndex({ agent_id: 1, requested_at: -1 })
db.vistaar_v2_withdrawals.createIndex({ status: 1, requested_at: 1 })
db.vistaar_v2_withdrawals.createIndex({ status: 1, paid_at: 1 })
db.vistaar_v2_withdrawals.createIndex({ agent_id: 1 }, { unique: true, partialFilterExpression: { open: true } })
db.vistaar_v2_tds_certificates.createIndex({ quarter: 1, agent_id: 1 })
db.vistaar_v2_earning_cohorts.createIndex({ status: 1, priority: 1 })
db.vistaar_v2_earning_rules.createIndex({ cohort_id: 1, trigger: 1, status: 1, order: 1 })
db.vistaar_v2_earning_assignments.createIndex({ agent_id: 1, from: -1 })
db.vistaar_v2_earning_assignments.createIndex({ agent_id: 1 }, { unique: true, partialFilterExpression: { open: true } })
db.vistaar_v2_rewards.createIndex({ status: 1, created_at: -1, _id: 1 })
db.vistaar_v2_rewards.createIndex({ agent_id: 1, created_at: -1, _id: 1 })
// Attendance gate
db.vistaar_v2_attendance.createIndex({ date: 1 })
// Order numbers gate
db.vistaar_v2_order_ids.createIndex({ order_id: 1 })
```

Per collection (schema count = checklist count): agents 8 · onboarding_data 4 · onboarding_configs 2 · otp_attempts 1 · sessions 2 · banners 1 · stories 2 · story_stats 1 · story_festivals 2 · story_samples 2 · story_designs 2 · faqs 3 · faq_sections 1 · events 1 · event_registrations 1 · meetings 2 · gigs 4 · leads 10 · testimonials 8 · testimonial_consents 2 · feedback 4 · product_suggestions 4 · payment_option_audit 2 · payment_credentials 3 · withdrawals 4 · tds_certificates 1 · earning_cohorts 1 · earning_rules 1 · earning_assignments 2 · rewards 2 · attendance 1 · order_ids 1.

Build first (the unique ones that guard a race across processes): `vistaar_v2_leads` `{pii_id}` (one farmer, one partner), `vistaar_v2_withdrawals` `{agent_id}` partial `open: true`, `vistaar_v2_earning_assignments` `{agent_id}` partial `open: true`, the two `vistaar_v2_payment_credentials` partial uniques, `vistaar_v2_stories` `{agent_id, signature}`, `vistaar_v2_faqs` `{q_key}`.

### Asked of other teams (not built by Vistaar)

From `PROD-CHECKLIST.md`; none is needed to go live.

| Collection (owner) | Index | When |
|---|---|---|
| `product_reviews`, `product_testimonials` (Stockship) | `{ source, verified, deleted, created_at }`, `{ bulk, verified, deleted }` (both have only `_id` today) | with the testimonials go-live ask |
| `orders_v2` (Stockship) | `{ order_id: 1 }` (unique if the data allows) | without it the boot read of old `KSV-` numbers, and Stockship's own duplicate check, are full scans |
| `orders_v2` (Stockship) | `{ agent: 1, date: -1 }` | at scale: an unfiltered partner list sorts in memory past a few thousand orders |
| `draft_orders` (B2B) | `{ entry_path: 1, status: 1, updated_at: -1 }` | once the collection holds tens of thousands of drafts |
| `franchise_v2_walkins`, `franchise_v2_prescriptions`, `franchise_v2_pos_orders` (franchise backend) | `{ pii_id: 1 }`, `{ phone: 1 }` | once they grow (48 / 11 / 507 rows on 2026-10-21) |
| `kkd_events` (Katyayani app) | `{ user_id: 1, event_name: 1, created_at: -1 }` | before its event volume goes live (43 test rows, only `_id`) |

Already relied on, owned by others: `orders_v2` `{ agent, order_status, date }`, `{ marketplace, order_status, date }` (HO lists — section 10, item 1) and `{ pii_id, date }` (KKD); `products_v2.sku`; `piis` `pii_id` / `phone_number`; `leads_v2` / `contacts_v2` `pii_id` (unique) and `lead_id` / `contact_id`; `leads_v2.source`; `addresses` `address_id` / `pii_id`; `draft_orders` `draft_order_id` (unique), `agent_id`, `status`; `terms_and_conditions` `{toc_id}` unique, `{profiles, is_active}`.

