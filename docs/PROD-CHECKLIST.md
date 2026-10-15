# Production checklist

What must exist in production before the matching feature is switched on.
`IndexSyncService` builds indexes outside production only.

## Environment

| Variable | Note |
|---|---|
| `NODE_ENV` | `production` — otherwise index builds run at boot |
| `MONGODB_URI` | Production `CRM-Database`. **Same region as the app**: a 28 ms round trip (beta, from outside) is most of every request's time |
| `MONGODB_MAX_POOL_SIZE` / `MONGODB_MIN_POOL_SIZE` | `50` / `5` per process. Processes × max must fit the Mongo server's connection limit |
| (OTP limits) | 3 SMS and 5 guesses per number per 10 min are counted in **`vistaar_v2_otp_attempts`** (Mongo), so they hold across every process. No Redis is used |
| `WEB_CONCURRENCY` | `pnpm start:cluster` workers; `0` = one per CPU core |
| `LOG_LEVEL` | `info`: one short line per request (id, method, URL, status, time); `/health` not logged |
| `CORS_ORIGINS` | HO portal hosts only, never `*` |
| `SWAGGER_ENABLED` | `false` unless the team wants `/docs` public |
| `VISTAAR_JWT_SECRET` | 32+ random characters, unique to this service (`openssl rand -base64 48`) |
| `OTP_TEST_NUMBERS` / `OTP_TEST_CODE` | **must be empty** (boot refuses otherwise) |
| `OTP_API_URL` | `https://utils.ko-tech.in` — DLT template for the Vistaar SMS confirmed with the utils owner |
| `SSO_JWKS_URL` | `https://sso.ko-tech.in/.well-known/jwks.json` |
| `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, `FIREBASE_STORAGE_BUCKET` | KYC uploads: the org bucket (ko-sales', `micro-dealer.appspot.com`), private objects under `KO-documents/<pii_id>/`, signed URLs on read. Without them `POST /uploads` answers 503 |
| `B2B_API_URL` | Production B2B Sales API — required, boot fails without it. No token here: each request brings the app's in `x-b2b-token` |
| `B2B_MARKETPLACE_CODE` | `MKTP-1` unless the partner marketplace changes |
| `CATALOG_CACHE_TTL_SECONDS` | `60` default |
| `ORDER_EVENTS_SECRET` | 24+ random characters (`openssl rand -base64 32`), shared **only** with the order service (`POST /hooks/orders/confirmed`). Unset = the route answers 503 and leads never turn into customers. Set it when the TL's order API is ready |

## Indexes (create by hand on prod)

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
db.vistaar_v2_leads.createIndex({ pii_id: 1 }, { unique: true })
db.vistaar_v2_leads.createIndex({ agent_id: 1, created_at: -1 })
db.vistaar_v2_leads.createIndex({ agent_id: 1, stage: 1 })
db.vistaar_v2_leads.createIndex({ agent_id: 1, next_follow_up: 1 })
db.vistaar_v2_leads.createIndex({ created_at: -1 })
db.vistaar_v2_leads.createIndex({ phone: 1 })
db.vistaar_v2_testimonials.createIndex({ agent_id: 1, created_at: -1 })
db.vistaar_v2_testimonials.createIndex({ status: 1, created_at: -1 })
db.vistaar_v2_testimonials.createIndex({ status: 1, shares: -1 })
db.vistaar_v2_testimonials.createIndex({ status: 1, bulk: 1, created_at: -1 })
db.vistaar_v2_testimonials.createIndex({ status: 1, crop: 1, created_at: -1 })
db.vistaar_v2_testimonials.createIndex({ status: 1, state: 1, district: 1, created_at: -1 })
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
```

⚠️ **Beta (2026-10-09): none of these exist** — the beta Mongo host is out of disk and every
build timed out at boot. Code that must stay correct without them: phone upsert re-reads on a
race; onboarding create re-reads on a race; sessions are deleted on refresh (no TTL on beta).

## Data

- Run `node dist/scripts/seed-onboarding.js --apply` once (or create cohorts/forms in the portal).
- `PUT /admin/settings { default_owner_agent_id }` — the HO person who owns new signups.
- Exactly one active **USR-1037 Offline Head** in `agents_v2` — the `lead_owner` of every farmer lead. Or `PUT /admin/settings { lead_owner_agent_id }` to name one. With neither, `POST /leads` answers 503.
- Role **USR-1040 "Vistaar Partner"** in `userroles` (`{ UserRoleId, role_name, agent_categories: [], __v: 0 }`) — by the ko-sales owner (`POST /api/v1/agents/roles` takes max+1, so check the max is USR-1039 first). Not on beta yet either.
- Forms published before 2026-10-09 by the seed: `seed-onboarding.js --apply --republish` (12-digit Aadhaar, `org_document`).
- Partners saved or approved before state/district came from the pincode (2026-10-14): `node dist/scripts/backfill-partner-place.js` (dry run), then `--apply`. Only `vistaar_v2_agents`; safe to run again. Beta done 2026-10-14 (VST-000006).

## Owed by other teams

- SMS template / DLT for Vistaar on the utilities OTP service.
- Firebase service account for uploads (same project as ko-sales, or a new one).
- **Stockship (testimonials):** add `vistaar` to `REVIEW_SOURCES` (`product_reviews`), so their list filter and desk accept our rows; recompute `bulk_v2` / `combos_v2` average ratings over **verified** rows only (today unverified count too) and know that our approvals do not trigger their `syncRating` — the average catches up on their next write for that product; build `{ source, verified, deleted, created_at }` and `{ bulk, verified, deleted }` indexes on `product_reviews` and `product_testimonials` (both have only `_id` today).
### `carts` (shared, owned by B2B Sales — build with their sign-off)

Nothing to build: every Vistaar read and write is by `_id` (derived from the
partner id) plus `source`.

**At scale (millions of partners):** if `carts` is sharded, shard on
`{ _id: "hashed" }` — every Vistaar query carries the `_id`, so each one
routes to a single shard.

### `draft_orders` (shared — B2B order portal, Sankalp)

Nothing to build to go live. The collection already has `draft_order_id`
(unique), `agent_id` and `status`; the app's queries start from `agent_id` (a
partner's handful of drafts) or `draft_order_id`. HO's unfiltered list
(`GET /admin/draft-orders`, `{ entry_path: 'vistaar', status: 'draft' }`
sorted by `updated_at`) rides `status` and sorts in memory — fine at today's
~100 rows; once the collection holds tens of thousands of drafts, ask B2B
for `{ entry_path: 1, status: 1, updated_at: -1 }`.

### `piis`, `leads_v2`, `contacts_v2`, `addresses`

Nothing to build: the lookups use the existing `pii_id`, `phone_number`,
`contact_id` and `leads_v2.source` indexes (farmer lists filter `source` +
`created_by`).

## Farmer leads — before switching on

- [ ] Radar: `node dist/scripts/backfill-lead-location.js` (dry run), then `--apply` — farmers saved before 2026-10-14 get their pincode's centre. Safe to run again
- [ ] HO adds the farm location to the farmer-consent wording (DPDP) — `PUT /admin/settings { farmer_consent_text }`

- [ ] One active Offline Head (USR-1037) in `agents_v2`, or `lead_owner_agent_id` set
- [ ] `vistaar_v2_leads` indexes built — `{pii_id}` unique is what keeps one farmer with one partner
- [ ] Optional: HO sets the farmer-consent wording (`PUT /admin/settings { farmer_consent_text }`); until then the app's own sentence is version 1
- [ ] Sales-operation asked to add source `vistaar` to its cohort and profiled-router exclusions (offline channel — never telecaller-routed)
- [ ] `app_counters` has `leads`, `contacts`, `addresses` rows in production (always true: ko-sales writes them)
- [ ] ko-sales / sales-operation told: `source: 'vistaar'` leads are inserted directly (no pipeline, no LQS, no webhook), `created_by` = `VST-…`
- [ ] Optional: a `lead_sources` row `{ source_code: 'vistaar', display_name: 'Vistaar Agent' }` so CRM source filters list it (ko-sales adds one itself only for leads it writes)

### `orders_v2`, `products_v2` (read-only, owned by Stockship)

Nothing to build to go live: the partner's list rides the existing
`{ agent: 1, order_status: 1, date: -1 }` and `products_v2.sku` indexes.

**At scale:** an unfiltered list (no `status`) sorts one partner's orders in
memory, because `order_status` sits between `agent` and `date`. Fine for a
few thousand orders per partner; past that, ask Stockship for
`{ agent: 1, date: -1 }` on `orders_v2`.

## Customers — before switching on

- [ ] `ORDER_EVENTS_SECRET` set; the order service (TL) calls `POST /api/v2/hooks/orders/confirmed { order_id, pii_id, agent_id, order_date }` when an order is confirmed — contract in ORDER-EVENTS.md. The call is trusted as sent, so the secret goes to the order service only
- [ ] Nothing to build in Mongo: customers are `vistaar_v2_leads` at stage `won`; their business is read from `orders_v2` on `{ agent, order_status, date }`

## Orders — before switching on

- [ ] Checkout (not built) writes orders through Stockship with `source: 'vistaar'` and the partner's `VST-` id in `agent`. Stockship's create-order checks `agent` against `agents_v2` today, so it must accept a `VST-` id for `source: 'vistaar'` (Stockship team).
- [ ] Stockship team told `source: 'vistaar'` orders will appear, with a `VST-` id in `agent`.

## Commission, wallet, My Performance — before switching on

- [ ] **The withdrawals indexes above, the unique partial `{ agent_id }` (`open: true`) first** — it is what stops two open withdrawals from one partner across server processes (one process also serialises a partner's requests in memory)
- [ ] Finance signs off the slabs (COMMISSION-LOGIC.md); HO saves them as plans with `draft: false` — until then every cohort earns the PRD's rates and the app shows "Draft"
- [ ] Settings checked in `GET /admin/settings`: `return_window_days` 7, `min_withdrawal` 500, `tds_rate_with_pan` 2, `tds_rate_without_pan` 20, `monthly_target` 1,00,000 (defaults apply while unset)
- [ ] Finance has an `agents_v2` role code for payouts → add it to `payouts.manage` / `commission.read` in `access.domain.ts` (heads only until then)
- [ ] The bank's upload template, if it is not the generic CSV (`GET /admin/withdrawals/payout-file`)
- [ ] Checkout (see *Orders*) — commission exists only for orders with `source: 'vistaar'` and the partner's `VST-` id in `agent`
- [ ] Every published onboarding form keeps a PAN field (`org_document: pan`), a bank-proof field (`org_document: bank_details`) and the bank account (`maps_to: details.bank_account`) — TDS rate and payouts read them (all five forms do, 2026-10-14)
- [ ] Nothing to build in `orders_v2`: one aggregation per partner a minute on `{ agent, order_status, date }`

## Draft orders — before switching on

- [ ] `app_counters` has the `_id: 'draft_orders'` row in production (the API answers 503 `DRAFT_ID_UNAVAILABLE` without it — it never creates it)
- [ ] B2B order-portal and Sankalp teams told `entry_path: 'vistaar'` rows exist in `draft_orders`, carry an extra `reminder_sent`, and take ids from the shared `DFT-n` series — their lists must filter on `entry_path` if they should not show them

## Cart — before switching on

- [x] Login module's auth guard live and `PartnerHeaderGuard` deleted — the cart reads the partner from the Vistaar token; the B2B token travels in `x-b2b-token`
- [ ] B2B Sales team told `source: 'vistaar'` rows exist in `carts` (their shape: `pii_id` only, no `user_id`; the partner is in the derived `_id`), and that their own queries must filter on `source`

## Banners — before switching on

- [ ] `FIREBASE_*` set (same bucket as KYC uploads); without them the image upload answers `503 UPLOADS_NOT_CONFIGURED` (text banners still work).
- [ ] `vistaar_v2_banners` index built (above).
- [ ] App build that reads `GET /banners` (and draws `image`) shipped before HO starts publishing image banners.

## Attendance — before switching on

- [ ] No index to build: `vistaar_v2_attendance` is read only by `_id`.
- [ ] App build that calls `/attendance/*` (and sends GPS from `geolocator`) shipped.
- [ ] Decided with product: auto-close of a missed punch-out, absent days, regularisation (not built — see `ATTENDANCE-APP.md`).

## My Story — before switching on

- [ ] The nine story / event indexes built (above) — the unique `{agent_id, signature}` is what stops a double tap saving two copies.
- [ ] `FIREBASE_*` set; story images go private under `vistaar/stories/<agent_id>/`. Without it uploads answer `503 UPLOADS_NOT_CONFIGURED` and the app shares without saving.
- [ ] The four FAQ / FAQ-section indexes built (above) — the unique `{q_key}` is what refuses a duplicate question.
- [ ] `node dist/scripts/seed-faqs.js --apply` once (the app's 5 sections and 11 built-in FAQs; re-running skips existing ones).
- [ ] `node dist/scripts/seed-story-content.js --apply` once (6 template cards + 5 example custom cards, 5 designs, 4 festivals, 8 farmer stories, 3 events). Done on beta 2026-10-12 (designs and template cards 2026-10-13). On production, skip the 3 sample events — HO adds real ones — and delete the `diwali_lights` test design (generated art).
- [ ] HO replaces or switches off the 8 sample farmer stories — they are the prototype's made-up quotes, not real customers.
- [ ] App build on `/stories/*` shipped: `FestivalId` enum → string key, snake_case mapping, save after share (see `STORIES-APP.md`).
- [ ] Stockship team told Vistaar reads approved `source: 'vistaar'` testimonials (and `bulk_v2.trade_name`) for the Farmer story template — read-only.

## Terms and conditions — before switching on

- [ ] No index to build: `terms_and_conditions` already has `{toc_id}` unique and `{profiles, is_active}` (owned by the other apps — not ours to change).
- [ ] Legal signs off the Vistaar Partner T&C (`src/scripts/terms-content.ts` — every rule the app shipped as built-in text), then `node dist/scripts/seed-terms.js --apply` once (makes the .docx through the editor's path, uploads to `toc/`, adds the next `TOC-n`, `profiles: ['vistaar']`). Done on beta 2026-10-13: `TOC-6` active and editable in the portal (`TOC-4`, `TOC-5` — uploaded files, not editable — switched off).
- [ ] Stockship / RLM owners told Vistaar adds rows to `terms_and_conditions` with `profiles: ['vistaar']` and takes the next `TOC-n`.
- [ ] The privacy policy is inside the same document (one Vistaar row) — no separate row.
- [ ] App build that reads `GET /terms-and-conditions` (`{toc_id, title, link}`) shipped.

## Info pages (About Vistaar, About Katyayani, Contact Us) — before switching on

- [ ] No index to build: `vistaar_v2_info_pages` is read only by `_id`.
- [ ] `node dist/scripts/seed-info-pages.js --apply` once (the app's current text, v1 of each page).
- [ ] HO replaces the placeholders the app marked "to confirm": About Katyayani stats, helpline `1800-000-0000`, social links (bare youtube/instagram/facebook), Contact Us helpline `1800123456` and WhatsApp `9876543000`, the Play Store link.
- [ ] App build that reads `GET /about-program`, `/about-company`, `/contact-us` (instead of `help_seed.dart` / `content_seed.dart`) shipped.

## Feedback (NPS, app stars, Suggest a product) — before switching on

- [ ] The eight `vistaar_v2_feedback` / `vistaar_v2_product_suggestions` indexes built (above) — `{agent_id, created_at}` is what keeps the daily cap a cheap count.
- [ ] HO roles that may read / act on feedback get `feedback.read` / `feedback.write` (today: the head roles).
- [ ] Product agrees the detractor promise in the app ("Your Prasar Officer will call you within 2 working days") — due = end of the 2nd working day (Mon–Sat, IST); the owner officer is the partner's `owner_agent_id`.
- [ ] App build that calls `/feedback`, `/feedback/suggestions` and reads `/feedback/reasons` shipped (see `FEEDBACK-APP.md`).

## Payment options (Pay online list) — before switching on

- [ ] The two `vistaar_v2_payment_option_audit` and three `vistaar_v2_payment_credentials` indexes built (above) — the two unique ones are what guarantee one live and one waiting set per provider. `vistaar_v2_payment_options` needs none.
- [ ] `PAYMENTS_CREDENTIALS_KEY` generated **for production only** (`openssl rand -base64 32`), kept in the secret store, never reused from beta, never in git or chat. Losing it means every set of keys is submitted again; leaking it plus a DB dump leaks the keys.
- [ ] `PAYMENTS_ALERT_WEBHOOK_URL` set to a finance + tech Slack channel.
- [ ] At least **two** active company admins (`USR-1000` / `USR-1001`) — the two-person rule needs a second one to approve.
- [ ] `PAYMENTS_ONLINE_ENABLED` stays `false` until real payment (gateway order, signature verify, webhook) is live — until then the app must not offer online payment in production. The boot refuses `true` without `PAYMENTS_CREDENTIALS_KEY`.
- [ ] HO roles that may switch options get `payments.write` (today: the head roles); keys are `payments.credentials` (company admins only).
- [ ] App build that reads `GET /payment-options` (instead of `payment_gateways_seed.dart`) shipped (see `PAYMENTS-APP.md`).

## Testimonials (partner submissions) — before switching on

- [ ] The ten `vistaar_v2_testimonials` / `vistaar_v2_testimonial_consents` indexes built (above).
- [ ] `FIREBASE_*` set; videos and photos go **private** under `vistaar/testimonials/<agent_id>/<kind>/`, uploaded by the app straight to the bucket with a signed PUT (≤ 60 MB video, ≤ 10 MB photo). On approval the file gets a Firebase download token (the link product pages play); removal takes the token away, a consent withdrawal deletes the file.
- [ ] Only for a **web** build of the app: bucket CORS allows `PUT` with `Content-Type` and `x-goog-content-length-range` from the app's origin. The mobile app needs nothing.
- [ ] Stockship team told and agreed (see *Owed by other teams*).
- [ ] HO reviews the testimonial-consent wording (`PUT /admin/settings { testimonial_consent_text }`) — the built-in v1 is a draft, not legal-approved.
- [ ] App build on `/testimonials/*` shipped (see `TESTIMONIALS-APP.md`): farmer picked from **My farmers** only (a new farmer is added as a lead first), product = `bulk` SKU, a client UUID per testimonial.

## Run

Build `pnpm install --frozen-lockfile && pnpm build`, then either:

- **Kubernetes / several hosts:** `node dist/main` — one process per pod, scale pods.
- **One VM:** `pnpm start:cluster` — one worker per core on the same port, a dead worker is restarted.

**No Redis.** Caching is in each server process's memory (lists ≤ 60 s,
cohort ≤ 60 s, signed image URLs ≤ 45 min) — each process lags an HO edit by
at most a minute. The per-partner request limit (120 per route per minute) is
also per process, so with N processes it is up to N × 120 — loose, but it is
abuse protection, not a quota. The OTP limits, which guard logins, are shared
through Mongo (`vistaar_v2_otp_attempts`).

Measured capacity and the reasoning: `docs/PERFORMANCE.md`.
