# Vistaar 2.0 — Technical PRD

*`docs/VISTAAR-PRD-TECHNICAL.md`. As of 22 October 2026, latest `beta` (`5113b6c`). Developer-facing. Compiled from beta's contract docs (`docs/*-APP.md`, `docs/*-HO.md`, `COMMISSION-LOGIC.md`, `ORDER-EVENTS.md`, `PROD-CHECKLIST.md`, `PERFORMANCE.md`, `TEST-DATA.md`), `CLAUDE.md`, `env.schema.ts`, `api-error.ts` and `access.domain.ts`; the function reference (section 31) is generated from beta's source. Schema detail is in `docs/VISTAAR-PRD-DATABASE.md`; the business-level companion is `docs/VISTAAR-PRD-OVERALL-FLOW.md`. Merged since the 17 October edition (`8f1f1c1`): order numbers (`KSV-n`), partner profile edit and bank-account change, Aadhaar / PAN duplicate check, HO verification calls and name changes, order search, earning-cohort conditions and eight new reward triggers, Razorpay Key-ID-only keys and Cashfree on/off, orders read by marketplace `MKTP-5`, the Stockship V2 order statuses, and the new KKD & App activity module. Work on the unmerged `feat/lead-owner` branch (lead owner = the Offline Head who approved the partner) is not on beta and not described here (section 30). Each feature's contract doc stays the source of truth for its exact request/response shapes; this file puts the whole system in one place.*

---

## Contents

1. System overview
2. API contract, auth and access
3. Data model
4. Auth and onboarding
5. Leads (farmers)
6. Customers and the order-events hook
7. Today's tasks
8. Cart and draft orders
9. Orders
10. Commission, wallet, withdrawals, TDS
10A. Earning cohorts, rules and rewards
11. My Performance
12. Payments (options and credentials)
13. Radar
13A. KKD & App activity
14. Attendance
15. My Story
16. Meetings
17. Events
18. Gigs
19. Testimonials
20. Feedback
21. FAQs
22. Terms and conditions
23. Info pages
24. Banners
25. Settings reference
26. Error code catalogue
27. Production: env vars, indexes, data steps, go-live gates
28. Performance and capacity
29. Test data (beta)
30. Not built yet, and doc discrepancies
31. Function reference (every function, file and line — 2,101 functions in 296 files)

---

## 1. System overview

### 1.1 What the service is

`backend-vistaar-2.0` is the v2 backend for the Vistaar app (partners) and the Vistaar screens of the HO portal. It is a rewrite, not a port: every collection it owns is a new `vistaar_v2_*` collection and every route is under `/api/v2`. The old Vistaar (KSS app + `CRM-Backend`) keeps running on `vistaaragents` / `vistaarfarmers`, which this service never writes.

### 1.2 Stack and runtime

- NestJS on Fastify. Bootstrap (`main.ts`): helmet, compression, ETag, CORS, global prefix `/api/v2`, Swagger.
- Run: `pnpm build` then `node dist/main` (one process per pod on K8s / multi-host) or `pnpm start:cluster` (one worker per core, dead workers restarted; `WEB_CONCURRENCY`, 0 = one per core).
- Database: MongoDB `CRM-Database`, shared production data used by ko-sales, Stockship, prasar, franchise and others.
- **No Redis.** Caching is per-process memory, acceptable only for data that may lag ≤ 60 s. State every process must agree on (OTP attempt counts) lives in a `vistaar_v2_*` collection updated with one atomic operation.
- Global providers (`app.module.ts`), in this order: the auth guard (`AppAuthGuard`, opted out of with `@Public()`), then the throttler (it keys on the verified caller, so it must run after auth), `EnvelopeInterceptor`, `AllExceptionsFilter`. Request logs redact the `Authorization`, `x-b2b-token` and cookie headers and the body's `otp`, `refresh_token`, `data` (form values) and `fields` (merchant keys).
- Commands: `pnpm start:dev`, `pnpm typecheck` (0 errors), `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm build`, `pnpm start:cluster`. Gate before any change is done: `pnpm typecheck && pnpm lint && pnpm test`.

### 1.3 Layers

| Layer | Does | Never does |
|---|---|---|
| Controller | Routing, DTO validation, guards, Swagger | Business logic, Mongoose |
| Service | Business rules, calls other services | Touch a Mongoose model — not even an import |
| Repository | Queries, aggregations, `.lean()` reads | Business decisions, HTTP concepts |
| Schema | Document shape, indexes, collection name | Logic |

Cross-module data goes through the other module's **service**, never its repository or schema (lint-enforced). Dependencies point one way: `modules → core → common`. Path aliases `@core/*`, `@common/*`, `@config/*`, `@database/*`, `@modules/*` are kept in agreement across `tsconfig.json`, `package.json` (jest) and `eslint.config.mjs`.

```
src/
├── main.ts          bootstrap
├── cluster.ts       one worker per core (pnpm start:cluster)
├── app.module.ts    root composition
├── config/          env.schema.ts — the only place process.env is read
├── core/            auth, filters, interceptors, http, logging, swagger, throttle (runs on every request)
├── common/          auth, decorators, dto, errors, http, interfaces, utils (runs only when imported)
├── database/        Mongo connection + IndexSyncService (vistaar_v2_* only)
├── scripts/         seeds, backfills (node dist/scripts/<name>.js; dry run unless --apply)
└── modules/<feature>/
      controllers/ services/ repositories/ schemas/ dto/
      <x>.domain.ts          pure rules — unit tested
      <x>.query-service.ts   read-only HO aggregations
      <x>.module.ts
```

### 1.4 Modules

33 folders under `src/modules/`; `app.module.ts` imports 30 of them directly (`catalog`, `counters` and `spine` come in through the modules that use them).

| Module | What it does | Section |
|---|---|---|
| `access` | HO SSO access: capability table, `GET /admin/me`, staff directory reads (`agents_v2`) | 2 |
| `auth` | Phone + OTP login, sessions, refresh, logout; partner tokens | 4 |
| `agents` | Partner rows (`vistaar_v2_agents`): stages, owner, HO verification calls, name-change approve / reject | 4 |
| `onboarding` | Cohorts, onboarding forms, saves, submit, KYC review, `GET` / `PATCH /me` (profile edit), bank-account change, Aadhaar / PAN duplicate check | 4 |
| `partner-desk` | HO pipeline screens composed from the modules above: list, detail, decisions, nearby-network check | 4 |
| `settings` | The one settings row (`vistaar_v2_settings`) | 25 |
| `uploads` | Files into the org bucket (Firebase), signed URLs | 3.3 |
| `spine` | The org's person record (`piis`: find / insert, KYC copy), `app_counters` org ids, pincode book, catalogue facts held in memory | 3, 5 |
| `counters` | Vistaar's own id series (`VST-`, `WD-`, `GIG-`, `SUG-`) in `vistaar_v2_counters` | — |
| `leads` | Farmer leads, farmer OTP, customers, HO leads / customers / transfer, the order-events hook, the radar | 5, 6, 13 |
| `today` | Home's Today's tasks (read-only view of other modules) | 7 |
| `catalog` | B2B marketplace catalogue client (prices, stock) | 8 |
| `cart`, `draft-order` | Cart (`carts`) and saved carts (`draft_orders`), app and HO watch | 8 |
| `orders` | The partner's orders read from `orders_v2` (`marketplace: 'MKTP-5'`), search, HO orders, `KSV-n` order numbers | 9 |
| `commission` | Commission plans, commission book, wallet, withdrawals, bank file, TDS, Form 16A | 10 |
| `earning` | Earning cohorts (conditions), rules, assignments | 10A |
| `rewards` | Coin / gig rewards from rule triggers; the rewards desk | 10A |
| `performance` | My Performance; HO performance board and partner targets | 11 |
| `payments` | Payment options and merchant keys | 12 |
| `kkd-activity` | **New:** what the partner's own farmers do at KKD stores and on the Katyayani app / website; KKD stores within 50 km. Read-only, owns no collection | 13A |
| `attendance` | Punch in / out, HO attendance | 14 |
| `stories` | My Story: saved stories, stats, HO cards / designs / festivals / samples | 15 |
| `meetings` | Partner meetings | 16 |
| `events` | HO-run events and seats | 17 |
| `gigs` | HO-posted paid meetings | 18 |
| `testimonials` | Partner testimonials and HO desks | 19 |
| `feedback` | NPS, call-backs, product suggestions | 20 |
| `faqs` | FAQ sections and FAQs | 21 |
| `terms` | Partner T&C (`terms_and_conditions`) | 22 |
| `info-pages` | About Vistaar, About Katyayani, Contact Us | 23 |
| `banners` | Home banners | 24 |
| `health` | `GET /health`, `GET /health/ready` | — |

### 1.5 Collections at a glance

- **Owned:** 39 `vistaar_v2_*` collections (new since 17 October: `vistaar_v2_order_ids`). Every field is in `docs/VISTAAR-PRD-DATABASE.md`.
- **Shared, written by Vistaar** (each under a documented exception, section 3.1): `piis`, `leads_v2`, `contacts_v2`, `addresses`, `app_counters` (rows `piis`, `leads`, `contacts`, `addresses`, `draft_orders`, `vistaar_orders`), `carts`, `draft_orders`, `terms_and_conditions`, `product_reviews`, `product_testimonials`.
- **Read only:**

| Collection | Owner | Read for |
|---|---|---|
| `agents_v2` | company staff directory | HO role (`user_role`), owner names; the owner's phone (`contact.phone_number`) for the app's reporting officer |
| `pincode_map_v2` | ko-sales | Pincode → state / district, pincode centres |
| `orders_v2` | Stockship | The partner's orders, customers' business, commission (`marketplace: 'MKTP-5'`, `agent` = `VST-…`); the old `KSV-` numbers to skip; KKD activity: the held farmers' own MKTP-2 / 3 / 4 orders by `pii_id` |
| `products_v2`, `bulk_v2`, `categories_v2` | Stockship | Order line names; GST and categories held in memory; testimonial product check (`bulk_v2`) |
| `combos_v2` | Stockship | Testimonial `family` check |
| `franchises`, `prasar_v2_retailers`, `vistaaragents` | franchise / prasar / old Vistaar | Nearby-network warning at approval; `franchises` also as KKD stores on the radar |
| `franchise_v2_walkins`, `franchise_v2_prescriptions`, `franchise_v2_pos_orders` | franchise backend | KKD activity: walk-ins, crop advice, the POS archive — by `pii_id` or phone |
| `franchises`, `franchise_v2_franchises`, `employees` (`email` + `franchiseId` only) | franchise backend | KKD activity: the store list and the POS logins that tie a store order to a store |
| `kkd_events` | Katyayani app | KKD activity: `APP_LAUNCH`, `Cart Abandoned` by the farmer's mobile |

### 1.6 External systems

| System | Used for | Direction |
|---|---|---|
| Company SSO (`SSO_JWKS_URL`) | Verifies HO tokens | Read |
| utils OTP service (`OTP_API_URL`) | Sends OTP SMS (DLT template) | Call out |
| B2B Sales marketplace (`B2B_API_URL`, `GET /marketplace-products/v2`, code `MKTP-1`) | Cart prices and stock, called with the caller's own B2B token | Call out |
| Order service | Calls `POST /api/v2/hooks/orders/confirmed` when a Vistaar order is confirmed | Calls in |
| Stockship | `orders_v2`, `products_v2` (read); `product_reviews` / `product_testimonials` (written on HO approval) | Shared DB |
| Franchise backend, Katyayani app | `franchise_v2_*`, `franchises`, `employees`, `kkd_events` (KKD activity, read) | Shared DB |
| Firebase Storage (org bucket) | KYC files and profile photos, Form 16A, story / testimonial / gig media, banner and design art | Call out |
| Slack webhook (`PAYMENTS_ALERT_WEBHOOK_URL`) | Payment-credential alerts | Call out |
| Payment gateways (Razorpay, PhonePe) | Credential check calls only (Razorpay: the public `GET /v1/preferences?key_id=`; PhonePe: a token mint); no money moves today | Call out |
| KO Utils (Katyayani Utils) | Holds Cashfree's App ID and secret and Razorpay's secret and creates their gateway orders (Cashfree: `POST /cashfree/order`) for the app; checkout is to write orders through Utils → Stockship | Not called by this service — the app calls it |

---

## 2. API contract, auth and access

### 2.1 Response envelope

- Success: `{ "success": true, "data": … }`. Controllers return a plain value; `EnvelopeInterceptor` wraps it.
- Failure: `{ "success": false, "requestId", "error": { "code", "message", "details" }, "path", "timestamp" }`, produced only by `AllExceptionsFilter`. Code throws through `apiError()` / `badRequest()` so `error.code` stays inside `API_ERROR_CODES`.
- Lists: `PageResult<T>` = `{ items, page, limit, total, has_more }` inside `data`; `limit` is clamped to 200 everywhere (some routes clamp lower, noted per route).
- Ids join by value only: `pii_id` (person / farmer, `PII-n`), `agent_id` (partner, `VST-…`).

### 2.2 Partner auth (the Vistaar app)

- Own HS256 token, `core/auth/partner-token.service.ts`, signed with `VISTAAR_JWT_SECRET`. Claims: `sub` = the partner row's `_id`, `agent_id`, `pii_id`, `typ: 'access'`, issuer `vistaar-api`, audience `vistaar-app`.
- Access token 12 h; refresh token 30 days, single-use and rotated on every refresh; only the SHA-256 of a refresh token is stored (`vistaar_v2_sessions`, TTL on `expires_at`).
- A global guard protects every route; opting out is deliberate with `@Public()` (terms, info pages, public onboarding reads, OTP routes).
- **Identity always comes from the token, never the body or path.** No partner route takes a partner id; a partner reads and writes only their own records (others' records answer 404). This holds for the new partner routes too: `PATCH /me`, `/me/bank-change`, `POST /orders/id` (a `request_id` is the caller's alone) and `/kkd-activity` (only farmers the caller holds; another farmer's `?customer=` → 404).
- Cart and draft-order routes also need `x-b2b-token` (the caller's B2B token prices the cart). Missing either token → 401.

### 2.3 HO auth (the portal)

- Routes under `/admin/*` accept only the company SSO token, verified against `SSO_JWKS_URL`.
- Each route checks a **capability** with `@Can(...)` from `modules/access/access.domain.ts` — never a role name.
- `403 NO_ADMIN_ACCESS`: the caller has no active Vistaar HO role (head USR-1037, admin USR-1000 / USR-1001) or no `agents_v2` account. `403 ROLE_NOT_ALLOWED`: the role lacks the capability, or the person is withheld by email (`WITHHELD` in `access.domain.ts`).
- Roles: `USR-1037` (Offline Head) = `head`; `USR-1000` (Super Admin) and `USR-1001` (Admin) = `admin`, which holds every `head` capability plus the admin-only ones. Only `agents_v2.user_role` of an active account is read (not the `user_roles[]` array).
- The portal gates its UI on `GET /admin/me`.

### 2.4 Capabilities

`access.domain.ts` is unchanged since 17 October; the new HO routes reuse existing capabilities (marked *new route*).

| Capability | Covers | Roles today |
|---|---|---|
| `leads.read` | HO leads, customers, meetings | Heads (USR-1037, USR-1000, USR-1001) |
| `leads.transfer` | Move a farmer to another partner | Heads |
| `agents.read` | Pipeline, partner detail (incl. `verification_calls`, `pending_name`, `duplicate_ids`), nearby check; settings read | Heads |
| `agents.edit` | Correct a partner's form values (audited), monthly target; *new route:* approve / reject a name change | Heads |
| `settings.write` | `PUT /admin/settings` | Heads |
| `orders.read` | HO orders, carts, draft orders | Heads |
| `attendance.read` | HO attendance | Heads |
| `content.read` / `content.write` | Banners, story cards / designs / festivals / samples, events, FAQs and sections, terms, info pages | Heads |
| `stories.read` / `stories.write` | Story activity and saved stories / delete a saved story | Heads |
| `gigs.read` / `gigs.write` / `gigs.review` | See / post-edit-assign-reopen-cancel-delete / approve-reject (approval pays) | Heads |
| `testimonials.read` / `testimonials.write` | Both testimonial desks | Heads |
| `feedback.read` / `feedback.write` | Feedback, call-backs, chips, product suggestions | Heads |
| `commission.read` | Plans in effect, performance, partner books | Heads |
| `commission.plans` | Create / edit / delete commission plans | Heads |
| `payouts.manage` | Withdrawals, bank file, UTR, TDS, Form 16A | Heads, until Finance has a role code |
| `payments.read` / `payments.write` | Payment options | Heads |
| `payments.credentials` | Merchant keys | Company admins USR-1000 / USR-1001 only (never the Offline Head); one admin withheld by email |
| `kyc.review` | Per-document KYC review; *new routes:* log a verification call (`POST /admin/agents/:agentId/verification-call`), see / approve / reject a bank account change (`/admin/agents/:agentId/bank-change…`) | Heads |
| `earning.read` / `earning.write` | Earning cohorts (and, *new route*, the conditions catalog `GET /admin/earning-cohorts/catalog`), rules, a partner's cohort history | Heads and admins |
| `rewards.read` / `rewards.review` | Rewards desk (approve / reject coins and gig ₹, every trigger) | Heads and admins |
| `agents.decide` | Request changes, approve, reject, reopen, block, unblock | Heads |
| `agents.assign` | Change a partner's owner | Heads |
| `config.read` / `config.write` / `config.publish` | Cohorts and onboarding forms | Heads |

### 2.5 Other caller types

- **Order service → hook:** `POST /api/v2/hooks/orders/confirmed` with header `x-webhook-secret: <ORDER_EVENTS_SECRET>` (≥ 24 chars).

### 2.6 Rate limits (all limits in one place)

| Scope | Limit | Shared across processes? |
|---|---|---|
| Any partner route | 120 calls / route / minute per partner, **per process** (N processes → up to N × 120); abuse protection, not a quota | No |
| OTP send | 3 SMS / number / 10 min (+ 30 s resend gap) | Yes — `vistaar_v2_otp_attempts` |
| OTP verify | 5 tries / number / 10 min | Yes |
| Farmer OTP on lead add | 3 sends and 5 verifies / farmer mobile / 10 min (apart from sign-in) | Yes — `lead-send:` / `lead-verify:` rows |
| Auth routes (`@Throttle(PUBLIC_LIMIT)` in `auth.controller.ts`) | 20 calls / min | No |
| Public cached reads (terms, info pages, signup forms) | 600 / min / IP (raised from 60 for CGNAT) | No |
| Order number `POST /orders/id` | 10 / min (429 `TOO_MANY_REQUESTS`) | No |
| My Story uploads + saves + shares | 30 / min | No |
| Meetings | 30 / min per write route | No |
| Event register | 20 / min | No |
| Gigs | 30 / min per write route | No |
| Feedback POSTs | 5 / min, plus 10 answers + 20 suggestions per IST day | Daily cap via Mongo count |
| Attendance punches | 10 / min, ≤ 10 sessions / day | Day cap on the row |
| Payment credentials | Submit 10 / h per admin; test 20 / h | No |

`PATCH /me`, `/me/bank-change` and `/kkd-activity` have no limit of their own (the 120 / route / minute applies).

### 2.7 Caches (per process, in memory)

| Data | Lifetime |
|---|---|
| FAQs, banners, terms, info pages, feedback reasons, story templates / designs / festivals, payment options (incl. Razorpay's `key_id`) | ≤ 60 s |
| Shared `/stories/content` build | 15 s |
| Partner cohort (LRU 100K) | 60 s |
| Commission book per partner (one aggregation shared by every screen that minute) | 60 s |
| Commission plans, settings | 60 s |
| Withdrawals (display only; read fresh before money moves, dropped locally when one moves) | 60 s |
| Gigs "available" tab; gigs and gig rewards read for gig pay | 60 s |
| Earning assignments (for an order's cohort at placing) | 60 s for display, fresh before money moves (an order in the minute after a move may show the old cohort's rate) |
| Event seat counts in lists | ≤ 60 s (register answer is exact) |
| B2B catalogue (`CATALOG_CACHE_TTL_SECONDS`) | 60 s; stale served up to 15 min while B2B is down |
| Catalogue facts (`products_v2` + `bulk_v2` GST + `categories_v2`, ~4,900 packs, 7 categories) | 1 h, stale-while-revalidate |
| `pincode_map_v2` (pincode → state/district) | 6 h; pincode centres one read / day / process |
| `/performance/standing` | 5 min |
| `/admin/performance/board` | 10 min per month per process |
| Signed file URLs (LRU 50K) | Reused while ≥ 15 min of their 1 h remain |
| KKD activity feed per partner (all sources merged; up to 2,000 partners per process) — `GET /kkd-activity` and `/summary` page and count from it | 60 s |
| KKD store list (stores, warehouses, POS logins) | 60 s |
| The old Vistaar's `KSV-` numbers in `orders_v2` (to skip) | Read once per process, at boot; held for the life of the process (a failed read is retried by the next call) |

---

## 3. Data model

### 3.1 Ownership rules

- **Read anything; write only `vistaar_v2_*`**, plus these documented exceptions: a new person and verified KYC documents on `piis` (including the bank proof HO approves with a bank account change, `piis.documents.bank_details`, `source: 'vistaar'`, never over another portal's entry); farmer org leads (`leads_v2`, `contacts_v2`, `addresses`, `piis.addresses[]`) including the `leads_v2.follow_up_date` mirror on Vistaar's own rows; `carts`; `draft_orders` (+ `app_counters._id: 'draft_orders'`); `terms_and_conditions`; `product_reviews` + `product_testimonials`; `app_counters` rows `piis`, `leads`, `contacts`, `addresses`, `draft_orders` and — new — `vistaar_orders` (the `KSV-n` order numbers; created once by hand, never upserted).
- A partner is **never** written to `leads_v2`, `contacts_v2`, `customers`, `addresses` or `agents_v2`. The partner's own profile edit (`PATCH /me`) writes `vistaar_v2_agents` only — `piis` is never changed by it.
- KKD & App activity writes nothing anywhere; it only reads other apps' collections (section 1.5).
- Collection names are always explicit (`@Schema({ collection: 'vistaar_v2_…' })`), never Mongoose pluralisation.
- No index declarations on shared collections. `vistaar_v2_*` declare indexes on the schema; `IndexSyncService` builds them outside production only; production indexes are created by hand from section 27.2.

### 3.2 Collections, fields, ids and indexes

Every collection Vistaar owns, writes or reads — its fields, types, defaults, enums, `_id` schemes, id series, indexes and write patterns — is in **`docs/VISTAAR-PRD-DATABASE.md`**. This file keeps only the ownership rules above and the file storage below. New on beta since 17 October: `vistaar_v2_order_ids` (one row per `KSV-` number handed out, `_id` `<agent_id>:<request_id>`, never deleted); on `vistaar_v2_agents` `verification_calls[]`, `pending_name`, `name_change` and the profile-edit fields; on `vistaar_v2_onboarding_data` `id_keys` and `bank_change`; on `vistaar_v2_earning_cohorts` `conditions[]`; on `vistaar_v2_rewards` `ref_id`.

### 3.3 File storage (Firebase, org bucket)

| Path | Visibility | Notes |
|---|---|---|
| `KO-documents/<pii_id>/<purpose>/` | Private, signed URL 1 h | Onboarding / KYC uploads (`POST /uploads`); also the profile photo (`purpose=profile_photo`, set with `PATCH /me`, shown from `photo_url`) and a bank-change proof (`purpose=<the bank-proof field's key>`). A replaced proof file stays in storage |
| `KO-documents/<pii_id>/form16a/<quarter>-<ts>.pdf` | Private | HO upload; replaced file deleted |
| `vistaar/banners/<uuid>.<ext>` | Public (download token), `Cache-Control: public, max-age=31536000, immutable` | Deleted when no banner uses it |
| `vistaar/story-designs/` | Public | Design art |
| `vistaar/stories/<agent_id>/` | Private, signed 1 h | Story renders and photos |
| `vistaar/testimonials/<agent_id>/<video\|photo>/<uuid>.<ext>` | Private until approved, then download token | Token removed on removal; file deleted on consent withdrawal |
| `vistaar/gigs/<agent_id>/<gig_id>/<uuid>.<ext>` | Private, signed PUT ≤ 5 MB | Deleted when the partner removes a photo; kept (unlinked) when HO reopens the gig |

Without `FIREBASE_*` env, upload routes answer `503 UPLOADS_NOT_CONFIGURED`.

---

## 4. Auth and onboarding

### 4.1 Partner auth (all `@Public` except logout and `/me`)

| Method + path | Body / rules | Answer |
|---|---|---|
| `POST /auth/otp/send` | `{phone, country_code? (+91), intent? login\|signup}`. Phone = 10-digit Indian mobile (`+91 98765 43210`, `09876543210` cleaned). Login on an unknown number → 404 `ACCOUNT_NOT_FOUND`; signup on a registered number → 409 `ACCOUNT_EXISTS`. A signup send **creates the partner row** (`otp_verified: false`) | `{sent: true, resend_after_seconds: 30}` |
| `POST /auth/otp/resend` | Same body; the same `intent` is required on send, resend and verify | Same |
| `POST /auth/otp/verify` | `{phone, country_code?, otp (4 digits), intent?}`. The first signup verify gives the VST- id and links the person (`piis`) | Session `{access_token, refresh_token, token_type: 'Bearer', expires_in: 43200, agent {agent_id, pii_id, stage, is_approved, onboarding_id}}` |
| `POST /auth/refresh` | `{refresh_token}` — single-use, rotated; store the new one | New session; spent / expired → 401 `SESSION_INVALID` |
| `POST /auth/logout` | Partner bearer, `{refresh_token}` — this device only | `{signed_out: true}` |
| `GET /me` | Partner bearer | See below |
| `PATCH /me` | Partner bearer; Edit Profile, approved partners only (section 4.6) | The full `GET /me` answer |

- A number that asked for an OTP but never verified is not an account: login refuses it. No referral code.
- Client rule: on any 401, refresh once, then show the login screen. Several devices may be signed in.
- OTP: 4 digits, 3 SMS / 10 min, 5 tries / 10 min, resend after 30 s, India +91 only. On non-production servers `OTP_TEST_NUMBERS` skip the SMS and accept `OTP_TEST_CODE`; production refuses to boot with any set.
- Errors: `INVALID_PHONE` 400, `OTP_NOT_REQUESTED` 400, `OTP_INVALID` 401 (wrong or expired), `ACCOUNT_NOT_FOUND` 404, `ACCOUNT_EXISTS` 409, `OTP_LIMIT` 429 (`details[0]` = `retry_after_seconds=N`), `OTP_UNAVAILABLE` 503, `IDENTITY_UNAVAILABLE` 503, `ACCOUNT_BLOCKED` 403, `SESSION_INVALID` 401, `VALIDATION_FAILED` 400.

**`GET /me`** → `{agent_id, pii_id, phone, country_code, stage, next_action, is_approved, ordering_unlocked, rejection_reason, onboarding {onboarding_id, cohort, completion_pct, submitted_at, fields_to_fix}, profile, earning_cohort, photo_url, pending_name, name_change, reporting_officer, timeline, member_since}`. The partner row and the form are read together (the token's `sub` is both keys).
- `next_action` ∈ `choose_cohort | complete_onboarding | fix_requested_changes | wait_for_review | approved | rejected | blocked`. **The app routes on `next_action` only.** Home opens only on `approved`; ordering only when `ordering_unlocked`.
- `profile` is null until approval (mapped from the form then); after that the partner's own Edit Profile changes it (section 4.6), which also adds `profile.photo` (a storage path) and `profile.details.language_pref`. The payout account in it is **masked**: `profile.details.bank_account` → `{account_holder, account_last4, ifsc}`; the full number is never sent to the app.
- `photo_url`: `profile.photo` as a signed link (1 h), or null.
- `pending_name` `{value, requested_at}`: a name sent with `PATCH /me` that is waiting for HO; `profile.name` stays the old one until HO approves. `name_change` `{value, approved, reason, at}`: HO's last decision on one (a refusal carries `reason`). Both null when there is none.
- `reporting_officer` `{agent_id, name, phone, role}`: the partner's HO owner (`owner_agent_id`) from `agents_v2`. `name` = first + last name, `phone` = `contact.phone_number` as text or null, `role` = `Offline Head` (USR-1037) · `Super Admin` (USR-1000) · `Admin` (USR-1001), null for any other role. The whole object is null when there is no owner or no `agents_v2` row for that id.
- `timeline`: the application tracker, always these five steps in this order, `[{step, at, done}]`:

| Step | Reached when (`at`) |
|---|---|
| `applied` | the first move into `kyc_review` in `stage_history` (the first submit) |
| `verification_call` | the first verification call with outcome `verified` (section 4.5) |
| `documents_review` | both of the above happened; `at` = the later one |
| `approved` | the first move into `approved` |
| `active` | approved, the stage is still `approved` and `is_active` is true; `at` = the approval. Product Knowledge L1 is not built; it will also be needed then |

  `done` = reached. When a later step is reached, every earlier one is `done: true` too, with `at: null` if nothing recorded it (partners approved before calls were logged), so the tracker never has gaps. A blocked partner keeps `approved` done; `active` turns off.
- `earning_cohort` `{id, name, since, rules[{name, trigger, trigger_label, reward {kind coin|gig, amount}, summary}]}` — read-only, in HO's rule order; null before approval or if it can't be read (the rest of `/me` still answers). See section 10A.

### 4.2 Onboarding form (app)

| Method + path | Auth | Purpose / rules |
|---|---|---|
| `GET /onboarding/cohorts` | Public | `[{_id, label {en, hi…}, description, icon, sub_types, order}]` |
| `GET /onboarding/config?cohort=` | Public | `{_id: 'vistaar_agent@2', cohort, version, steps[]}`, active steps in order; `If-None-Match` → 304 |
| `GET /onboarding/pincode/:pincode` | Public | `{pincode, state, district, taluk}` \| null |
| `GET /onboarding` | Bearer | My form, or null before the first save |
| `PATCH /onboarding` | Bearer | `{cohort?, step_id?, data {key: value}}`, ≤ 100 fields per call |
| `POST /onboarding/submit` | Bearer | → stage `kyc_review`, form locked |
| `POST /uploads?purpose=<field_key>` | Bearer | Multipart `file` ≤ 10 MB, JPG/PNG/WEBP/HEIC/PDF → `{path, url, content_type, size}` under `KO-documents/<pii_id>/` |

- Public routes: 600 calls / min per IP in beta's code (`ONBOARDING-APP.md` still says 60; see section 30.2).
- `GET /onboarding` → `{onboarding_id, cohort, config_id, config_version, stage, editable_fields (null = all, [] = locked, [keys] = only these), raw_data (file values with signed url / urls, 1 h), current_step, completed_steps, completion_pct, missing_required, documents_review {key: {status, reason, by, at}}, remarks {key: note}, submitted_at, submit_count, updated_at}`.
- `PATCH /onboarding`: `null` clears a key; only the keys sent change (other steps are never overwritten); file paths must be the caller's own uploads; optimistic `version`.
- Wizard order in the app: Who you are → Mobile → Personal → Location → Details → Review → OTP → KYC checklist → submit. Right after OTP verify, one `PATCH /onboarding` saves the whole wizard; then uploads + one PATCH per checklist item; then submit; then `GET /me`. The wizard = steps without document / file fields (default: personal, location, details); the checklist = the rest (kyc, agreement).
- Before the first submit the form follows the latest published version (values for removed fields are dropped) and the cohort can be switched. After submit both are fixed.
- A save that sets the Aadhaar or PAN field, and the submit, are refused with 409 `ID_IN_USE` when another partner's form holds the same number (section 4.8).
- Errors: `COHORT_REQUIRED` 400 (first save without cohort), `COHORT_NOT_FOUND` 400, `CONFIG_NOT_PUBLISHED` 409, `UNKNOWN_FIELD` 400, `VALIDATION_FAILED` 400 (show `details[0]`), `FIELD_NOT_EDITABLE` 409, `ONBOARDING_LOCKED` 409, `VERSION_CONFLICT` 409 (retry), `REQUIRED_FIELDS_MISSING` 400 (submit), `ID_IN_USE` 409 (`details` = the clashing field keys), `ACCOUNT_BLOCKED` 403; uploads `UPLOADS_NOT_CONFIGURED` 503, `FILE_REQUIRED` 400, `FILE_TYPE_NOT_ALLOWED` 400, `FILE_TOO_LARGE` 413.

### 4.3 Form configuration

- Config step: `{step_id, order, title {…}, description {…}, icon, is_active, fields[]}`. Field: `key, type, label, placeholder?, help?, required, options?, validation?, visible_if? {field, op: eq|ne|in|filled, value}, fields? (groups)`. A hidden required field is not required. Labels `{en, hi, mr, gu, …}` fall back to `en`.
- Field types → value sent: `text` / `textarea` (trimmed; `min_length`, `max_length`, `regex`), `number` (`min`, `max`), `boolean` (`must_accept` → only true), `date` (`YYYY-MM-DD`), `phone`, `email`, `pincode`, `select` (one of `options[].value`), `multi_select` (array), `file {path}`, `document {files[], number}` (`max_items`, `number_required`, `regex`), `location {lat, lng, accuracy, captured_at}` (device GPS, India only, **always optional**; without it the nearby check is skipped), `object {…}`, `object_list [{…}]` (`max_items`).
- `maps_to` targets: `name`, `email`, `sub_cohort`, `address_line`, `village`, `district`, `state`, `pincode`, `location`, `details.<anything>`. A pincode known to `pincode_map_v2` gives the standard state / district (on `preview` at every save, on `profile` at approval); an unknown pincode keeps what was typed.
- `org_document`: document fields only, once per form; ko-sales keys `adhar`, `pan`, `bank_details`, `selfie`. The code finds fields by what they are, not by key: Aadhaar = `org_document: adhar`, PAN = `org_document: pan`, bank proof = `org_document: bank_details`, payout account = `maps_to: details.bank_account` (used by the duplicate check, the bank-account change and payouts).
- **Publish validation:** unique `step_id` and `key` (lowercase, digits, `_`); English label on every step and field; options for selects; valid regexes; `visible_if` pointing at a real field; **no required location field** (older forms saved with it required are served and checked as optional). Published versions never change; each partner keeps the version they submitted.

### 4.4 Pipeline state machine

```
signed_up ──first save──▶ onboarding ──submit──▶ kyc_review ──approve──▶ approved
                              ▲                   │   ▲
                              │      request-changes   │ resubmit
                              │                   ▼   │
                           reopen          changes_requested
                              │                   │
                          rejected ◀──reject──────┴── (also from kyc_review)

any stage ──block──▶ blocked ──unblock──▶ previous stage
```

Guards: document review and request-changes only in `kyc_review`; approve needs every required document verified; HO value edits only in onboarding / kyc_review / changes_requested; verification calls only before a decision (signed_up / onboarding / kyc_review / changes_requested); blocked refuses login and refresh. A decision on a partner whose stage moved meanwhile → 409 `STAGE_NOT_ALLOWED`. Approval (and unblock) also places the partner in an earning cohort (section 10A); approval then fires the `onboarding_approved` earning trigger (the welcome reward, once per partner ever; a failure is only logged and never fails the approval). A verification call is not a stage: the pipeline does not move.

### 4.5 HO endpoints

| Method + path | Capability | Purpose / rules |
|---|---|---|
| `GET /admin/me` | any HO | `{email, agent_id, name, role, role_code, capabilities[]}` |
| `GET /admin/agents/summary` | `agents.read` | `{stages {signed_up, onboarding, kyc_review, changes_requested, approved, rejected, blocked}, unverified, total, by_cohort, by_state}` (top 10 among verified) |
| `GET /admin/agents` | `agents.read` | Query `stage, cohort, state, district, owner_agent_id, q (name, phone prefix, VST-…, PII-…), from / to (signup), include_unverified, page, limit ≤ 200, sort (-created_at default \| created_at \| ±updated_at \| ±decided_at \| ±last_login_at)`. Row `{agent_id, pii_id, phone, name, cohort, sub_cohort, district, state, village, pincode, email, stage, otp_verified, is_approved, completion_pct, submitted_at, decided_at, last_login_at, owner {agent_id, name} \| null, created_at, updated_at}` (email / village / sub_cohort from the profile mapped at approval). Partners directory = `?stage=approved&sort=-decided_at` |
| `GET /admin/agents/:agentId` | `agents.read` | `agent` (incl. `stage_history`, `owner_agent_id`, `profile` (`profile.photo` is a storage path, not a link), `verification_calls[{at, by, outcome, note}]` (always an array, `[]` on partners from before calls were logged), `pending_name {value, requested_at}`, `name_change {value, approved, reason, by, at}`), `owner {agent_id, name, email}`, `onboarding` (the version filled, signed URLs, `documents_review`, `remarks`, `missing_required`, `updated_data[{field, old_value, new_value, by, at}]`, `location`, `duplicate_ids[{kind aadhaar\|pan, agent_ids[]}]` (section 4.8)), `nearby {radius_km, center, vistaar[{agent_id, name, stage \| 'applicant', distance_km}], network[{source franchise\|prasar_retailer\|old_vistaar_agent, id, name, distance_km}], has_conflicts}`; `?radius_km=` overrides once |
| `POST /admin/agents/:agentId/documents/:fieldKey/review` | `kyc.review` | `{decision verified\|rejected, reason?}`; only in kyc_review; reason required to reject. Verify copies an `org_document` field to `piis.documents`; reject sets `is_verified: false`; another portal's entry is never replaced. Errors `NOT_A_DOCUMENT`, `DOCUMENT_MISSING` 400. Answers the desk `onboarding` view (with `duplicate_ids`) |
| `POST /admin/agents/:agentId/request-changes` | `agents.decide` | `{remarks {field_key: note}}`; only in kyc_review; keys must be on the form (400 `UNKNOWN_FIELD`); ≥ 1 note or 1 rejected document; rejected documents added automatically; only these fields become editable |
| `POST /admin/agents/:agentId/approve` | `agents.decide` | No body. Every required document verified, else 409 `DOCUMENTS_NOT_VERIFIED`. Maps the form onto the partner (`maps_to`) |
| `POST /admin/agents/:agentId/reject` | `agents.decide` | `{reason}`; from kyc_review or changes_requested |
| `POST /admin/agents/:agentId/reopen` | `agents.decide` | `{reason?}`; rejected → onboarding |
| `POST /admin/agents/:agentId/block` / `unblock` | `agents.decide` | `{reason}` / `{reason?}`; unblock returns to the previous stage |
| `PATCH /admin/agents/:agentId/onboarding` | `agents.edit` | `{data}`; only in onboarding / kyc_review / changes_requested (else 409 `STAGE_NOT_ALLOWED`); same validation as the app; `null` clears; a changed document goes back to pending; audited in `updated_data`; an Aadhaar / PAN another partner's form holds → 409 `ID_IN_USE` (`details` = the field keys). Answers the desk `onboarding` view (with `duplicate_ids`) |
| `PUT /admin/agents/:agentId/owner` | `agents.assign` | `{owner_agent_id: 'A0-…'}`; active `agents_v2` account (400 `OWNER_NOT_FOUND`) |
| `POST /admin/agents/:agentId/verification-call` | `kyc.review` | `{outcome reached\|not_reached\|verified, note? (trimmed, ≤ 300)}`. Only in signed_up / onboarding / kyc_review / changes_requested, else 409 `STAGE_NOT_ALLOWED` ("You cannot log a verification call for this partner right now…"); the write is conditional on the stage, so a partner decided meanwhile is refused too. Appends `{at, by (HO email), outcome, note}`; the stage does not move. The first `verified` call is the app's `verification_call` timeline step → `{agent_id, verification_calls}` |
| `POST /admin/agents/:agentId/name-change/approve` | `agents.edit` | No body. The partner's `pending_name.value` becomes `profile.name` and `preview.name` (the HO list's name); `name_change {value, approved: true, reason: null, by, at}`; `pending_name` cleared → the partner without `stage_history` |
| `POST /admin/agents/:agentId/name-change/reject` | `agents.edit` | `{reason}` (trimmed, 1–300; the partner sees it). `pending_name` cleared, `profile.name` unchanged; `name_change {value, approved: false, reason, by, at}` → the partner without `stage_history` |
| `GET /admin/agents/:agentId/bank-change` | `kyc.review` | The waiting or last bank-account change, or null (section 4.7) |
| `POST /admin/agents/:agentId/bank-change/approve` | `kyc.review` | No body; section 4.7 |
| `POST /admin/agents/:agentId/bank-change/reject` | `kyc.review` | `{reason}` (required, ≤ 300; the partner sees it); section 4.7 |
| `GET` / `POST /admin/cohorts`, `PATCH` / `DELETE /admin/cohorts/:key` | `config.*` | `{key, label, description?, icon?, sub_types?, order?, is_active?}` (409 `COHORT_EXISTS`); delete only if unused (409 `COHORT_IN_USE` → deactivate) |
| `GET /admin/onboarding-configs/meta` | `config.read` | Field types and `maps_to` targets |
| `GET …/:cohort/versions`, `GET …/:cohort/versions/:version` | `config.read` | Published versions |
| `GET …/:cohort/draft`, `PUT …/:cohort/draft {steps, notes?}` | `config.write` | → `{draft, errors}` (saved even with errors) |
| `POST …/:cohort/draft/clone-from/:source`, `DELETE …/:cohort/draft` | `config.write` | Clone another cohort's form / drop draft |
| `POST …/:cohort/publish` | `config.publish` | Only with no errors (else 400 `CONFIG_INVALID`); `NO_DRAFT` 400 |
| `GET` / `PUT /admin/settings` | `agents.read` / `settings.write` | Onboarding fields: `default_owner_agent_id`, `lead_owner_agent_id`, `farmer_consent_text`, `lead_release_days`, `customer_release_days`, `conflict_radius_km` (0.5–50) |

- **Name decisions** act only on the name HO saw: the write is conditional on that `pending_name.value`, so none waiting, or a newer name the partner sent meanwhile → 409 `NAME_CHANGE_NOT_PENDING` (refresh). There is no list of waiting names: they show on the partner detail (`agent.pending_name`). Calls and name decisions write `vistaar_v2_agents` only.
- Onboarding HO common: every POST here answers 200, not 201. `:agentId` is the `VST-` id (any case); an unknown or unverified one → 404 `NOT_FOUND`. `COHORT_REQUIRED` 400 when the form isn't started (review, edit, request-changes, approve). `UNAUTHORIZED` 401 (missing, expired or partner token); `SERVICE_UNAVAILABLE` 503 (SSO unreachable). The HO role is read once per token.

### 4.6 Edit Profile (app, `PATCH /me`)

Approved partners only: a blocked or switched-off account → 403 `ACCOUNT_BLOCKED`, any other stage → 403 `PARTNER_NOT_APPROVED`. The write is conditional on `stage: 'approved'`, so a partner who stopped being approved meanwhile also gets 403 `PARTNER_NOT_APPROVED`.

Body (every key optional, only the keys sent change, do not send `null`; strings trimmed):

| Key | Rule | Lands on |
|---|---|---|
| `name` | 3–100 | `pending_name {value, requested_at}`, **not** `profile.name`. A name equal to the current one (`profile.name`, else `preview.name`) is ignored; a new one replaces one still waiting. HO decides it (section 4.5) |
| `email` | valid email, ≤ 254 | `profile.email` |
| `language_pref` | `^[a-z]{2,3}$` | `profile.details.language_pref` (where the form puts it) |
| `village` | 1–100 | `profile.village` |
| `district`, `state` | 1–100 each | `profile.<key>` and `preview.<key>` |
| `pincode` | 6 digits | `profile.pincode` and `preview.pincode`. A pincode `pincode_map_v2` knows sets `state` and `district` too, over the typed ones; an unknown pincode keeps what was typed |
| `photo` | ≤ 300, `path` from `POST /uploads?purpose=profile_photo` | `profile.photo`. Must be in the partner's own folder (`KO-documents/<pii_id>/`, no `..`) and exist in storage, else 400 `IMAGE_NOT_FOUND`; must be an image (not a PDF), else 400 `FILE_TYPE_NOT_ALLOWED`. Shown from `photo_url` |

- Written as dotted `$set`s, so nothing else on the profile moves. Writes `vistaar_v2_agents` only (`profile`, the `preview` copy of the place, `pending_name`); the person record `piis` is never changed.
- A `PATCH /me` that sends `state`, `district` or `pincode` re-places the partner in an earning cohort straight away (reason `profile_changed`, section 10A), before it answers, so `earning_cohort` in the answer is already the one for the new place. A failed re-place is only logged and the edit still saves; the next holdings change, cohort change or recompute fixes it. A village alone does not move the cohort (no cohort tests it).
- Answers the full `GET /me`. Errors: `ACCOUNT_BLOCKED` 403, `PARTNER_NOT_APPROVED` 403, `IMAGE_NOT_FOUND` 400, `FILE_TYPE_NOT_ALLOWED` 400, `VALIDATION_FAILED` 400.

### 4.7 Bank account change

Payouts keep going to the verified account until HO approves the new one. While a change is waiting no new withdrawal is accepted: `GET /wallet` → `blocked_reason: 'bank_change_pending'`, a withdrawal request → 409 `BANK_CHANGE_PENDING` (section 10); withdrawals already requested or approved are not touched. Only the latest request is kept (`vistaar_v2_onboarding_data.bank_change`).

App (partner bearer):

| Method + path | Body / rules | Answer |
|---|---|---|
| `GET /me/bank-change` | — | The waiting or last request, or null |
| `POST /me/bank-change` | `{account_holder (≤ 100), account_number (9–18 digits), ifsc (^[A-Za-z]{4}0[A-Za-z0-9]{6}$, saved upper case), proof_path (≤ 300)}` | The request, `status: 'pending'` |
| `DELETE /me/bank-change` | — (withdraw the waiting one) | The request, `status: 'withdrawn'`, `decided_by: 'self'` |

Partner view: `{status pending|approved|rejected|withdrawn, account_holder, account_last4, ifsc, requested_at, decided_at, reason}` (the full number is never sent back).

- `POST`: blocked or switched off → 403 `ACCOUNT_BLOCKED`; not approved → 403 `PARTNER_NOT_APPROVED`; one already waiting → 409 `BANK_CHANGE_PENDING` (withdraw it first); the form has no payout account field (`maps_to: details.bank_account`) or no bank-proof field (`org_document: bank_details`) → 409 `CONFIG_INVALID`. The form's own rules for those two fields apply (account pattern; `proof_path` = a cancelled cheque or passbook photo uploaded with `POST /uploads?purpose=<the bank-proof field's key>`, in the partner's own folder) → 400 `VALIDATION_FAILED`, `details[0]` says what. The same account number and IFSC as today → 400 `VALIDATION_FAILED`. The insert is conditional on no change pending, so two requests at once leave one.
- `DELETE`: only the waiting one; none waiting (decided, withdrawn, or a form write landed in between) → 409 `BANK_CHANGE_NOT_PENDING`.

HO (`kyc.review`; no list of waiting changes — open the partner):

- `GET …/bank-change` → `{agent_id, status, account_holder, account_number (full), ifsc, proof_path, proof_url (signed, 1 h), requested_at, decided_at, decided_by (HO email, or 'self' when the partner withdrew), reason, current_account {account_holder, account_number, ifsc} | null}` (the account paid into now), or null.
- **Approve** puts the new holder, number and IFSC into the form's payout-account value (other sub-fields there, such as a UPI ID, are kept) and the proof into the bank-proof field as `{files: [proof_path]}`, with `documents_review.<proof key>` = verified by this HO now (the same entry the KYC review writes). Both changes go into `updated_data` (old and new value). Then, like a KYC verify, the proof is copied to `piis.documents.bank_details` (`source: 'vistaar'`, `id: null`; another portal's entry is never replaced), and the profile's copy `profile.details.bank_account` is replaced with `{account_holder, account_number, ifsc}` when the profile has `details` (beta's code; `ONBOARDING-HO.md` §3 and `ONBOARDING-APP.md` §6 say that copy is not updated). The old proof file stays in storage.
- **Reject** `{reason}` (empty after trimming → 400 `VALIDATION_FAILED`): the old account stays, still verified; writes `vistaar_v2_onboarding_data` only.
- Approve, reject and the partner's withdraw are one write conditional on the change still pending with the same `requested_at` **and** the form `version` read, so a change decided or withdrawn meanwhile, or a form edit landing in between → 409 `BANK_CHANGE_NOT_PENDING` (refresh). A form with no payout account / bank-proof field → 409 `CONFIG_INVALID`.

### 4.8 Aadhaar / PAN duplicate check

- Every form write (partner save, HO edit, submit, moving to a newer form version or another cohort) rewrites `id_keys` from `raw_data`: the Aadhaar field's number (`org_document: adhar`) as the SHA-256 of its 12 digits (spaces and `-` ignored; anything else gives no key), the PAN field's number (`org_document: pan`) upper case without spaces. `id_keys` is never returned.
- A partner save or HO edit that sets the Aadhaar or PAN field, and the submit (which checks the whole form), are refused when another partner's form holds the same key: 409 `ID_IN_USE`, message "This Aadhaar (PAN / Aadhaar and PAN) is already used by another Vistaar account. Contact Katyayani support.", `details` = the clashing field keys (e.g. `["aadhaar"]`). The number itself is never in the answer. The partner's own number saved again passes; a save that does not set those fields is not blocked by an old clash.
- HO sees `onboarding.duplicate_ids [{kind aadhaar|pan, agent_ids[]}]` (`[]` when none; at most 50 other forms read) on the partner detail and in the edit-values and review-document answers: the warning beside Approve, for rows saved before the check or two saves at the same moment. The numbers are never listed.
- One-off backfill, once per environment after deploy (the two `id_keys` indexes built first, section 27): `node dist/scripts/backfill-id-keys.js` (dry run) → `--apply`. Fills `id_keys` on `vistaar_v2_onboarding_data` rows saved before the check (pages of 200 by `_id`, each write conditional on the row's `version`, so a row saved meanwhile is skipped); prints each Aadhaar / PAN held by more than one partner as agent ids, never the number. Safe to run again.

### 4.9 Shared writes from this area

- `piis` at first OTP verify (find by phone oldest first, or insert; see `docs/VISTAAR-PRD-DATABASE.md` section 5).
- KYC verify / reject → `piis.documents.<type>` (dotted `$set`, `source: 'vistaar'`, never over another portal's entry).
- HO approves a bank account change → `piis.documents.bank_details` the same way (the new proof as `{id: null, image}`).
- Edit Profile, verification calls and name decisions write only `vistaar_v2_agents`; the bank-account change writes `vistaar_v2_onboarding_data` (and, on approval, the `piis` copy above and the profile's `details.bank_account` copy).

---

## 5. Leads (farmers)

### 5.1 Rules

- Only an **approved** partner can add farmers; farmers only (never retailers / businesses).
- **One farmer, one partner** — `vistaar_v2_leads.pii_id` is unique.
- Stage machine: `prospect → contacted → interested → negotiation → won | lost`. Any non-won move is allowed by PATCH. `won` is set **only by the system** on the first confirmed order (section 6); the partner can never set it (`409 STAGE_NOT_ALLOWED`). A won lead's stage is fixed. `lost` requires `lost_reason` and clears the follow-up; a lost lead reopens to any other stage (reason cleared). Concurrent change → `409 STAGE_CHANGED` (reload).
- Phone check (`GET /leads/check`) — decision table:

| `status` | Meaning | What save does |
|---|---|---|
| `new` | No person / lead | Creates org lead + Vistaar row (`result: created`) |
| `yours` | Already this partner's | Updates (`result: updated`) — offline-sync safe |
| `katyayani` | Known from another channel, no partner holds it | Links, org rows untouched (`result: linked`) |
| `other_partner` | Held by another partner | Refused `409 FARMER_TAKEN` |
| `released` | Hold lapsed | Takes over (`result: linked`) |
| `not_farmer` | Registered as retailer / business | Refused `409 NOT_A_FARMER` |
| `self` | Partner's own number | Refused `400 SELF_LEAD` |

  Two partners saving the same farmer in the same second: one wins, the other gets `FARMER_TAKEN`.
- **Release:** `releases_at` = last work + `lead_release_days` (15) for a lead with no order; last order + `customer_release_days` (45) for a customer; immediately when the partner is blocked. "Work" = re-save, stage change, follow-up / expected-value PATCH, or a logged call / visit / WhatsApp / note. Opening a lead is not work; setting a far-off follow-up does not hold it. **Nothing runs at `releases_at`**: the farmer stays (any work renews) until another partner adds them; the takeover is guarded on `updated_at`. The new holder starts at `prospect` (a customer stays `won`), never sees the old notes; the old partner loses the farmer from lists and cart (404). App shows "Releases in N days" within 3 days (red when past) and warns when a new follow-up is later than `releases_at`.
- **GPS precedence:** visit activity (best) > add/edit lead > `PUT /cart/customer` (weakest). A weaker source never overwrites a stronger one. Fixes with `accuracy_m > 500` or outside India are ignored. Fallback: pincode centre (`exact: false`; a clearly wrong pincode point → district centre); no pincode and no fix = unplaced. Payload `location {lat, lng, accuracy_m, at}` (`at` for offline saves).
- Consent: the partner shows HO's farmer-consent wording (versioned in settings). `consent_version` must match the current version, else `409 CONSENT_OUTDATED` (reload `GET /leads/consent`, re-ask). Each lead keeps the version it agreed to.
- New farmers need a lead owner: the one active Offline Head (USR-1037 in `agents_v2`) or `settings.lead_owner_agent_id`. With neither, new farmers answer `503 LEADS_NOT_CONFIGURED`; linking still works. USR-1000/1001 never own.
  - Not on beta yet: the lead owner becomes the Offline Head who approved the partner (branch feat/lead-owner).
- Delete is for mistakes only: Vistaar's row is deleted, the farmer is free again (`check → katyayani`), org rows stay; a customer cannot be deleted (409). A pending `lead_created` reward for that farmer is rejected by `system`.
- **Farmer OTP — mandatory on every `POST /leads` (since 2026-10-16, breaking):** `GET /leads/check` (stop on `other_partner` / `not_farmer` / `self` — no SMS) → `POST /leads/otp/send {phone, resend?}` → the farmer reads out the code → `POST /leads/otp/verify {phone, otp}` → `{otp_token, expires_at}` → `POST /leads` with `otp_token`. The token is a signed 15-minute token bound to this mobile and this partner; a retry of the same save within that time reuses it. Limits: 3 sends (resends included) and 5 verifies per mobile per 10 min, counted apart from sign-in (`lead-send:` / `lead-verify:` rows). Only `otp_verified_at` is stored on the lead. Beta test mobiles in `OTP_TEST_NUMBERS` take `OTP_TEST_CODE`.
- **Rewards:** these lead events can earn coins or gig ₹ under the partner's earning-cohort rules (section 10A):
  - adding a farmer (`lead_created`);
  - logging a call / visit / WhatsApp on a due or overdue follow-up (`follow_up_done`). This completes that follow-up and pays once per due day;
  - moving a lead **forward** with `PATCH /leads/:piiId` `stage` (`lead_stage_advanced`: prospect → contacted → interested → negotiation; fields `from_stage`, `to_stage`). It pays once per lead per stage reached, so a jump pays once, for the stage reached, and moving back and forward again never pays twice. `lost`, reopening from `lost` and `won` never fire it;
  - a customer's repeat confirmed order (`reorder`, section 6). It fires on the hook result `updated` when the order is newer than `last_order_at`, with `gap_days` = the IST days since the previous order. It pays once per order, and a replay or an older order pays nothing.

  Logging does not move `next_follow_up`. The server makes rewards and a reward failure never fails the partner's request; the app sends nothing extra.
- **Held farmers, for other modules (2026-10-21):** `LeadsService.heldFarmers(agent_id)` returns every farmer the partner holds now (open, won and lost; ≤ 5,000, newest added first) as `{pii_id, name, phone, village, stage, since}`. `since` is the start of this partner's hold: `held_since`, else the row's `created_at`. KKD & App activity (section 13A) reads it to decide whose activity, and from when, the partner may see. `LeadsService.holds(agent_id, pii_id)` checks a single farmer (KKD's `customer` filter). Both are read-only and have no endpoint of their own.
- **Follow-up mirror (2026-10-16):** the partner's `next_follow_up` is copied to `leads_v2.follow_up_date` on Vistaar's own org lead rows only (filter `lead_id` + `source`; only that field); cleared when the follow-up is cleared, the lead is lost or won, or the farmer leaves the partner. A failed mirror is only logged.

### 5.2 App endpoints (partner token)

| Method + path | Purpose |
|---|---|
| `GET /leads/consent` | `{version, text: {en, hi}}`; send `version` back as `consent_version` |
| `GET /leads/check?phone=` | `{status, pii_id}`; writes nothing |
| `POST /leads/otp/send` | `{phone, resend?}` → `{sent, resend_after_seconds}` (approved partners only) |
| `POST /leads/otp/verify` | `{phone, otp}` → `{otp_token, expires_at}` (15 min) |
| `POST /leads` | Add / update a farmer → lead + `result` created\|linked\|updated; **needs `otp_token`** |
| `GET /leads?stage&due&q&page&limit` | List; `due=true` = open leads due today / overdue; `q` over name / village / crop / mobile digits. Order: open first (overdue, then with follow-up, then without), closed last; within each, soonest follow-up else oldest lead. Rows omit `stage_history` / `activities` |
| `GET /leads/summary` | `{total, open, pipeline_value (Σ expected_value of open), won, lost, conversion_pct (won ÷ all leads), due, by_stage[]}` |
| `GET /leads/:piiId` | Lead + `stage_history` + `activities` (newest first, last 100) |
| `PATCH /leads/:piiId` | Partial; `null` clears. Stage, `lost_reason`, `next_follow_up` (future, open leads only), `expected_value`, farmer edit (name, village, district, pincode, crops [replaces], acreage — never mobile), `location`. No `note` field (400) |
| `DELETE /leads/:piiId` | `{removed: true}`; customers refused 409 |
| `POST /leads/:piiId/activities` | `{type: call\|visit\|whatsapp\|note, text ≤ 500}`; send `location` with `visit`. Append-only |

`POST /leads` body: required `otp_token`, `phone` (10-digit Indian; +91 / spaces / dashes accepted), `name`, `village`, `crops` (1–10, main first), `acreage` (> 0), `consent_version`; `ex_employee_declared: true` required for cohort `ex_employee`. Optional `district`, `pincode` (sets state, and district if not sent; without pincode state = partner's state), `found_via` (meeting|referral|walk_in|self|campaign), `expected_value`, `next_follow_up` (future only; send `+05:30`, returned in UTC), `note` (saved as first activity), `location`.

Lead shape: `pii_id`, `lead_id`, `origin`, `agent_id`, farmer fields, `stage`, `next_follow_up`, `lost_reason`, `consent_version`, `customer_at`, `held_since`, `last_worked_at`, `last_order_at`, `releases_at`, `location {lat, lng, exact, source, at} | null`, timestamps.

Errors: `VALIDATION_FAILED` 400, `LEAD_OTP_REQUIRED` 400, `LEAD_OTP_INVALID` 400 (`details`: `reason=expired` \| `reason=mismatch` …), `OTP_INVALID` 401, `OTP_LIMIT` 429, `OTP_UNAVAILABLE` 503, `INVALID_PHONE` 400, `SELF_LEAD` 400, `FARMER_TAKEN` 409, `NOT_A_FARMER` 409, `CONSENT_OUTDATED` 409, `STAGE_NOT_ALLOWED` 409, `STAGE_CHANGED` 409, `PARTNER_NOT_APPROVED` / `ACCOUNT_BLOCKED` 403, `NOT_FOUND` 404, `LEADS_NOT_CONFIGURED` 503, `LEADS_UNAVAILABLE` 503.

### 5.3 HO endpoints

| Method + path | Capability | Purpose |
|---|---|---|
| `GET /admin/leads` | `leads.read` | `Page<LeadRow>`, default `-created_at`. Filters: `q` (name / village / district / crop any case; mobile digits, 10 = exact), `agent_id`, `stage`, `origin`, `state`, `district`, `due=true`, `from` / `to` (IST date-times; bare `YYYY-MM-DD` read as UTC day), `sort` (±created_at, ±last_order_at, ±next_follow_up — `next_follow_up` sort lists only leads having one) |
| `GET /admin/leads/summary` | `leads.read` | `total, today, last_7_days, partners, due_today, overdue, by_stage, by_partner (top 10)` |
| `GET /admin/leads/places?agent_id&stage&state&district` | `leads.read` | Map dots `{pii_id, agent_id, name, stage, village, district, state, crops, lat, lng, exact, at}`, capped 5,000 (`capped: true` = narrow the filter) |
| `GET /admin/leads/:piiId` | `leads.read` | LeadRow + `stage_history` (oldest first) + `activities` (newest first, last 100, incl. `stage_change`) + `holder_history` (oldest first, last 20). `by` = VST-…, `system`, or HO email |
| `POST /admin/leads/:piiId/transfer` | `leads.transfer` | `{agent_id, reason (≤ 200, required)}`. Target must be an approved partner. New holder starts at Prospect (customer stays Won); reason goes into `holder_history.note` and is the new partner's first note; consent moves with the farmer; org lead never changes |
| `GET` / `PUT /admin/settings` | `agents.read` / `settings.write` | `farmer_consent_text {en (required), hi?}` ≤ 600 each (new text = new version); `lead_owner_agent_id` (active A0-… account; ""/null clears; `400 OWNER_NOT_FOUND`); `lead_release_days` 1–365 (15); `customer_release_days` 1–365 (45). Send only changed fields |

Transfer errors: 404 `NOT_FOUND`, 400 `PARTNER_NOT_APPROVED`, 400 `VALIDATION_FAILED` (same partner, no reason), 409 `STAGE_CHANGED`. CSV export = page `/admin/leads?limit=200` until `has_more = false`.

---

## 6. Customers and the order-events hook

### 6.1 Rules

- A **customer** is a `vistaar_v2_leads` row at `won`. It is set only by the order service's confirmed-order call. A placed-but-unconfirmed order changes nothing. Shop stock never makes a customer.
- Customers are read-only: never created directly, updated through `PATCH /leads/:piiId`, never deleted (DELETE → 409).
- "Confirmed" business = orders whose raw `order_status` maps to punched / shipped / delivered (`BUSINESS_STATUSES`, see §9.3 — Stockship's V2 names such as `ready_to_invoice`, `sent_to_xd`, `manifested` count too); never cancelled / returned. The app's figures (`/customers*`) count this partner's own orders; HO's (`/admin/customers*`) count the farmer's orders with **any** Vistaar partner, so a transferred farmer keeps their history.
- A Vistaar order is `orders_v2` with `marketplace: 'MKTP-5'` and the partner's `VST-` id in `agent` (not `source` — Stockship rewrites it from `marketplaces_v2` on create).

### 6.2 Hook — `POST /api/v2/hooks/orders/confirmed`

- Auth: header `x-webhook-secret: <ORDER_EVENTS_SECRET>` (≥ 24 chars, shared only with the order service). Unset → `503 ORDER_EVENTS_NOT_CONFIGURED`.
- Body: `{order_id (orders_v2.order_id, upper-cased, /^[A-Z0-9][A-Z0-9_/-]{1,39}$/), pii_id (orders_v2.pii_id, PII-…), agent_id (VST-<digits>, orders_v2.agent), order_date? (ISO; now if absent)}`. Vistaar orders only (`marketplace: 'MKTP-5'`), confirmed orders only. **Trusted as sent** — Vistaar neither re-reads the order nor checks its status.
- Idempotent: resending the same order answers `updated`.
- Answers:
  - `{result: 'won', pii_id}` — first confirmed order: `stage → won`, `customer_at = last_order_at = order_date`, `lost_reason` and `next_follow_up` cleared, stage history + activity "First order KSK-… confirmed — now a customer" logged by `system`. A follow-up that was set is mirrored (cleared) to `leads_v2.follow_up_date` on Vistaar's own lead row (filter `lead_id` + `source: 'vistaar'`; a failure is only logged). The partner's earning cohort is recomputed later (`holdings_changed`: one open lead fewer, one customer more).
  - `{result: 'updated', pii_id}` — already a customer: `$max last_order_at`, `$min customer_at` (moves back for an earlier order). When `order_date` is later than the stored `last_order_at` (a genuinely newer order, not a replay), the **`reorder`** reward event fires: `rewards.reorder(agent_id, farmer, order_id, gap_days)` with `gap_days` = IST days since the previous order; reward ids `reorder:<order_id>:<kind>` (once per order and kind); paid only if an earning rule of the partner's cohort matches; a failure is only logged and never fails the hook.
  - `{result: 'ignored', reason: 'not_held'}` — shop stock or a farmer this partner doesn't hold.
- The won update is conditional on the stage read (`{stage, customer_at: null}`); a race with the partner's own edit re-reads, up to 3 tries, then `503 LEADS_UNAVAILABLE`.
- Errors: `UNAUTHORIZED` 401, `VALIDATION_FAILED` 400, `ORDER_EVENTS_NOT_CONFIGURED` 503, `LEADS_UNAVAILABLE` 503 (retry).
- Writes: `vistaar_v2_leads`; on `won` only, the follow-up mirror on Vistaar's `leads_v2` row (that one field) and the earning recompute (`vistaar_v2_earning_assignments` / `vistaar_v2_agents.earning_cohort`); on a newer `updated`, a `vistaar_v2_rewards` row when a rule pays. Never `orders_v2` or `customers`. (`ORDER-EVENTS.md` still says "never `leads_v2`"; the code mirrors the follow-up as above.) Commission does not depend on this call — it follows the orders.

### 6.3 App endpoints

| Method + path | Purpose |
|---|---|
| `GET /customers?q&crop&ordered_in&sort&page&limit` | `q` name / village / district / crop / mobile digits; `crop` one chip; `ordered_in` `YYYY-MM` (IST; cancelled orders and non-orders — `NOT_COUNTED` — excluded); `sort` `-last_order_at` (default) \| `-spend` \| `name` |
| `GET /customers/summary` | `{total, active_30_days, total_business (Σ spend), crops[]}` |
| `GET /customers/:piiId` | Lead detail + `customer_at`, `last_order_at`, `orders`, `spend`, `last_order_stage` (placed·punched·shipped·delivered), `releases_at`, `average_order`, history, activities |

Customer Orders tab = `GET /orders?customer=<pii_id>`.

### 6.4 HO endpoints (`leads.read`, read-only)

- `GET /admin/customers?q&agent_id&state&district&from&to&sort&page&limit` — AdminCustomer = LeadRow + `orders`, `spend`, `last_order_at`, `last_order_stage`. Default sort `-last_order_at`.
- `GET /admin/customers/summary` — `total, active_30_days, new_this_month (won this IST month), by_state / by_partner / by_crop (top 10)`.
- `GET /admin/customers/:piiId` — detail + `average_order`; 404 if not a customer.
- One page = one leads read + one orders read (`marketplace: 'MKTP-5'` + `pii_id $in`, on the `orders_v2` `pii_id` index). Money cards come from `/admin/orders/summary`, never a page sum.

---

## 7. Today's tasks

`GET /today` (partner token) → `{count, counts {follow_up, saved_cart, event, meeting, gig, order_to_confirm}, items[]}`. Each item: `type`, `ref_id`, `urgent`, `at`, plus one typed block.

| Type | Source | Urgent when | Block |
|---|---|---|---|
| `follow_up` | Open lead, follow-up today / overdue | Overdue | `overdue_days`, `lead {pii_id, name, phone, crops, acreage, expected_value, stage}` |
| `saved_cart` | Saved cart for a farmer, not reminded | Idle 3+ days | `idle_days`, `cart {id, pii_id, customer_name, contact_number, item_count, subtotal}` |
| `event` | Seat held, today / tomorrow | Today | `event {id, title, type, starts_at, location}` |
| `meeting` | Own scheduled meeting, today / tomorrow | Today | `meeting {id, title, type, starts_at, village, venue, invited}` |
| `gig` | Held gig (accepted / checked_in), today / tomorrow | Today | `gig {id, title, village, venue, starts_at, payout, status}` |
| `order_to_confirm` | Placed, not yet confirmed | Never | `order {id, customer_id, customer_name, total, payment_mode, order_status}` |

Order: follow-ups most-overdue first → saved carts longest-idle → events soonest → meetings soonest → gigs soonest → orders longest-waiting. IST days. Shop-stock saved carts and failed orders are excluded. Tasks are read-only views of other records; doing the real thing removes them. A scheduled meeting stays all day even after its start. Unknown `type` must be ignored by the app. If one source is down, the others still return. Errors: 401 only.

---

## 8. Cart and draft orders

Both modules need `Authorization: Bearer <Vistaar token>` **and** `x-b2b-token`.

### 8.1 Cart (`carts`, shared)

| Method + path | Purpose |
|---|---|
| `GET /cart` | Whole cart |
| `POST /cart/items` | `{sku, quantity? = 1}` — adds, capped at stock |
| `PATCH /cart/items/:sku` | `{quantity}` — 0 removes |
| `DELETE /cart/items/:sku` | No error if absent |
| `PUT /cart/customer` | `{pii_id \| null}` (+ optional `location`, weakest GPS source). `null` = own stock; the partner's own `pii_id` = shop stock |
| `DELETE /cart` | Empties and clears the customer |

- Every route returns the whole cart; the app never computes totals. Delivery fee, coins and commission stay in the app's `billFor()` and are settled by the orders API.
- Line = pack `sku` (e.g. `K-350`); `product_id` = bulk sku (`BK-…`). The app's cart id `BK-629::1 L` → `product_id` + `size_label`.
- Pricing: server-side only, from marketplace `MKTP-1`, re-priced on every response; catalogue refreshed every 60 s with the caller's B2B token. `mrp` / `size_label` from the catalogue on each read (delisted pack → `mrp: 0`). Fields `price`, `line_total`, `available_qty`, `available` (false = delisted or stock < qty), `price_changed` (toast), `has_issues` (blocks checkout). Quantities are capped at stock, never rejected (ask 1000, get 360).
- Customer must be a `pii_id` from the partner's own leads (created or linked, any stage); else 404 and the cart is unchanged. The customer name is never stored on the cart.
- Shape: `{pii_id, items[{sku, product_id, product_name, product_image, size_label, price, mrp, quantity, line_total, available_qty, available, price_changed}], item_count, subtotal, has_issues, updated_at}`.
- Errors: 400 `VALIDATION_FAILED` (bad sku, qty outside 0–9999, bad pii_id), 401, 403 `PARTNER_NOT_APPROVED` / `ACCOUNT_BLOCKED` (writes only; reads and empty never refused), 404, 409 `OUT_OF_STOCK`, 409 `CART_LIMIT_REACHED` (100 packs), 409 `CART_BUSY` (write race — re-GET and retry), 503 `CATALOG_UNAVAILABLE` (B2B down, nothing cached).

### 8.2 Draft orders (`draft_orders`, shared)

| Method + path | Purpose |
|---|---|
| `POST /draft-orders` | Save the active cart for its customer → DraftOrderView |
| `GET /draft-orders?page&limit` | Newest first |
| `GET /draft-orders/:id` | `:id` = `DFT-n` |
| `POST /draft-orders/:id/restore` | → CartView; the cart now holds the draft's lines for its customer |
| `POST /draft-orders/:id/reminder` | `reminder_sent: true` (the app sends the WhatsApp itself) |
| `DELETE /draft-orders/:id` | `{deleted: true}` |

- One open draft per customer; saving again for the same customer replaces it (same id). Save does not clear the cart; the draft survives a restore.
- Prices are frozen at save; restore re-prices, caps at today's stock, and drops delisted packs. The customer is re-checked on save and restore.
- View: `{id, pii_id, contact_id, customer_name, contact_number, items[{sku, product_name, product_image, size_label, price, mrp, quantity, line_total}], item_count, subtotal, reminder_sent, updated_at}`; `customer_name` / `contact_number` / `pii_id` null = shop stock.
- Errors: 403 (save / restore / reminder only), 409 `DRAFT_CART_EMPTY`, 404 (not found / not yours / already ordered / customer no longer the partner's), 503 `DRAFT_ID_UNAVAILABLE` (the `app_counters._id: 'draft_orders'` row is missing — the API never creates it), 409 `CART_BUSY`, 401.

### 8.3 HO watch (`orders.read`, read-only)

- `GET /admin/carts?agent_id&page&limit` — AdminCartView: `partner {agent_id, name, phone, cohort, district, state}`, `pii_id | null`, `customer | null`, `items`, `item_count` (Σ qty), `subtotal` (as stored — prices the partner last saw), `updated_at`. Carts holding a product, last touched first. Cart rows name no partner, so ids are derived from every verified partner's VST- id, the page is read from `carts` by `_id`, and only that page's partners are read in full.
- `GET /admin/draft-orders?agent_id&page&limit` — open saved carts, last saved first, with `reminder_sent` and partner.

---

## 9. Orders

Orders are Stockship's `orders_v2` rows with `marketplace: 'MKTP-5'` and the partner's VST- id in `agent` (`VISTAAR_MARKETPLACE`). Not `source`: the app's orders reach Stockship with `source: 'MKTP-5'`, and Stockship keeps that id in `marketplace` but rewrites `source` / `sub_source` from its `marketplaces_v2` row, so `source` never reads `vistaar`. Every query filters on `marketplace` (+ `agent` for a partner). This service reads orders and hands out order numbers (`POST /orders/id`); it never writes `orders_v2`. **Checkout (placing an order) is not built.**

### 9.1 App endpoints (Vistaar token only, no `x-b2b-token`)

- `GET /orders?page&limit&status&customer&from&to&q` — newest first (`date`, then `_id`), limit ≤ 200; `status` ∈ placed|punched|shipped|delivered|cancelled|returned (filter = `order_status $in` every raw value of that stage, §9.3); `customer` = one pii_id; `from` / `to` IST days placed, inclusive. Counts are computed only when the page is full.
- `q` — the Orders search box, 2–60 characters after trimming, else `400 VALIDATION_FAILED` "Please type 2 to 60 characters to search." Works with the other filters, only ever over the partner's own orders (it only adds conditions next to `agent` / `marketplace`). Read in this order (`orderSearch`):

  | `q` | Matches |
  |---|---|
  | only digits / spaces / `+` / `-`, with 4+ digits | the end of the buyer's `customer.phone` (its last 10 digits, ends-with regex) |
  | an id-shaped word (`/^[A-Z0-9][A-Z0-9_/-]{1,39}$/` upper-cased) **with a digit** | `order_id` exactly, any case |
  | anything else | a name: every word must appear (case-insensitive) in `customer.first_name` or `customer.last_name` |

  So `9826` is a phone, `KSK-341382` an id, `Ram Kumar` / `Ramesh` a name; 2–3 digits alone are read as an exact order id (usually no match).
- `GET /orders/:id` — `order_id` (e.g. `KSK-341382`, `KSV-272`), case-insensitive; ids with `/` URL-encoded (`ORD%2FK0-150%2F41350`).
- `POST /orders/id` — the order number for one checkout attempt (§9.4).
- OrderView: `id`, `status` (app stage), `order_status` (Stockship raw, ~50 values; unknown → `placed`), `customer_id` (null = shop stock, name "Self (shop stock)"), `customer_name`, `customer_phone`, `items[{sku, product_name, product_image, size_label, quantity, unit_price, line_total, is_free}]`, `item_count`, `subtotal`, `discount`, `coins_used`, `delivery_charge`, `total`, `payment_mode` (cod|prepaid|partial|credit; app "online" = prepaid), `cod_amount`, `prepaid_amount`, `delivery_address`, `awb`, `courier`, `tracking_steps[]`, `created_at`, `delivered_at`, `commission {base, rate, amount, status, confirms_at, confirmed_at, paid_at, withdrawal_id, reversed_reason} | null`.
- `tracking_steps`: Order placed → Confirmed (punched) → Shipped → Out for delivery → Delivered. A step is completed when the order reached it or anything after (a completed step may have a null timestamp). `out_for_delivery` stays stage `shipped` with the "Out for delivery" step done (the app labels it "Out for delivery"). Cancelled / returned show reached steps plus a final Cancelled / Returned step. Names / images / sizes from `products_v2` (unknown sku → sku as name, no image).
- Errors: 400 `VALIDATION_FAILED` (bad `status`, `page`, `from` / `to` or `from` after `to`, `q` outside 2–60, an `:id` that is not an order id), 401 `UNAUTHORIZED`, 404 `NOT_FOUND` (no such order, or another partner's). `POST /orders/id` errors in §9.4.

### 9.2 HO endpoints (`orders.read`, read-only)

- `GET /admin/orders?page&limit&status&agent_id&customer&from&to&payment_mode&state&q` — newest first. `agent_id` case-insensitive; `customer` = PII-…; `from ≤ to`; `q` (HO's DTO redeclares it over the app's 2–60 rule: `@MaxLength(40)`) = an exact order id (any case; id-shaped **with a digit**) or 4+ trailing phone digits — the same `orderSearch` as the app, but a value it reads as a name → `400 VALIDATION_FAILED` "Search by an order number (e.g. KSK-341382) or at least 4 digits of the phone." (HO has no name search.)
- `GET /admin/orders/summary` (same filters; no range = this IST month; > 366 days = 400) — `{orders, value (cancelled + returned excluded), partners, customers, by_stage[{stage, count, value}]}`.
- `GET /admin/orders/breakdown` — `by_day` (IST, empty days absent), `by_partner` (top 10 by value), `by_state` (top 15), `by_city` (top 15), `by_product` (top 10 packs, free items excluded), `by_category` (with pct; "Other" if unknown), `repeat_buyers` (2+ orders in window). Cancelled / returned excluded (a `status` filter of cancelled / returned answers empty panels).
- `GET /admin/orders/:id` — app OrderView + `partner {agent_id, name, phone, cohort, district, state}` + `ship_to {city, state, pincode}`. Commission filled only on detail (list sends null). 404 if not a Vistaar (`MKTP-5`) order.
- Filters on `marketplace: 'MKTP-5'`; other channels never scanned. The repository says it rides Stockship's `{ marketplace, order_status, date }` index (`{ agent, order_status, date }` with a partner); `ORDERS-HO.md` still names `{ source, order_status, date }` and PROD-CHECKLIST lists only `{ agent: 1, order_status: 1, date: -1 }` — confirm with Stockship.

### 9.3 Raw status → app stage (`orders.domain.ts`)

Lookup on `order_status` trimmed and lower-cased; an unlisted value reads as `placed` (step 0) so a new Stockship stage never hides an order. Since 2026-10-21 the map also holds Stockship's V2 names (`status_v2`, from Stockship's `order-status.const.ts`).

| Stage (step) | Raw values |
|---|---|
| `placed` (0) | created, new_order, ready_to_confirm, pending, inventory_short, processing, hod_pending, blocked, blocked_order, blocked_orders, pseudo, pseudo_order, split, nsz, non_servicable_zone, ambiguous |
| `punched` (1) | confirmed, ready_to_invoice, ready_to_book, outbound_pending, ready_to_outbound, booked, ready_to_pick, picklist_assigned, picking, picked, ready_to_pack, packed, ready_to_check, sent_to_xd, ready_to_racked, received_from_xd, ready_to_rack, racked, booking_cancelled, ready_to_manifest, manifested, ready_to_dispatch |
| `shipped` (2) | dispatched, `in transit`, in_transit, ndr |
| `shipped` (3, "Out for delivery") | out_for_delivery |
| `delivered` (4) | delivered |
| `cancelled` (off line) | cancel, cancelled, failed, outbound_cancelled, destroy, destroyed, lost, merged, merge |
| `returned` (off line) | rto, rto_initiated, `rto in transit`, rto_in_transit, rto_intransit, `rto received`, rto_received, rto_delivered, partially_rto, partial_rto |

- Changed since 17 October: `failed` now reads `cancelled` (was `placed`); `ready_to_check` now `punched` (was `placed`); new `new_order`, `inventory_short`, `hod_pending`, `blocked_order(s)`, `pseudo_order`, `ambiguous` (placed), `ready_to_invoice`, `picking`, `picked`, `sent_to_xd`, `ready_to_racked`, `received_from_xd`, `manifested` (punched), `outbound_cancelled`, `merge` (cancelled), `partial_rto` (returned).
- `NOT_AN_ORDER` = `failed`, `pseudo`, `pseudo_order` (not a live order; Today's tasks leave them out).
- `NOT_COUNTED` = `NOT_AN_ORDER` + `split`, `merged`, `merge` — not an order of its own for sales and commission (a `split` parent's `-S1` / `-S2` children and the surviving order of a merge carry the lines). Commission's `$nin`, the customers `ordered_in` filter and KKD & App activity use it.
- `BUSINESS_STATUSES` = every raw value of punched + shipped + delivered (customers' confirmed business).

### 9.4 Order numbers — `POST /orders/id` (`KSV-n`)

- Vistaar's order numbers are `KSV-1`, `KSV-2`, … from `app_counters._id: 'vistaar_orders'` (user's decision 2026-10-16; row created once by hand with `count: 0`, never upserted). Each number is the same atomic `$inc: {count: 1}` + `updated_at` every other series makes.
- Body `{request_id}` — a UUID the app makes **once per checkout attempt** and resends on every retry (timeout, double tap, app restart); a new attempt (cart changed, paid again) = a new UUID. Any other field → 400. Answer `OrderIdView {order_id, request_id, issued_at}` (200).
- Same `request_id` → the same number (the row `_id` is `<agent_id>:<request_id>` in `vistaar_v2_order_ids`, read from the primary); another partner's `request_id` never returns it. Two racing copies of one request: the loser's insert hits the duplicate `_id`, it re-reads and returns the winner's number; its own `$inc` is left unused (a gap).
- The old Vistaar's `KSV-` numbers still in `orders_v2` are **skipped**: each process reads every `order_id` matching `^KSV-\d+$` (any channel) once at boot (`onApplicationBootstrap`; a failed read is retried by the next call) and holds the set in memory. A taken number costs one more `$inc`; one call steps over at most 100 (`MAX_TAKEN_SKIPS`), else 503. So the series has gaps — never assume `KSV-n+1` follows `KSV-n`.
- Guard: approved and active partners only (`requireWorkingPartner`, checked before the lookup). Throttle: 10 per minute.
- COD: ask when the partner taps **Place order**. Prepaid: the number is meant to come from the payment webhook once payment is confirmed (not built; `OrderIdService.issue` is exported for it and skips the partner check), so a failed payment spends nothing. Checkout must pass the `KSV-` number to Stockship create-order as `order_id` (PROD-CHECKLIST).
- Errors: `VALIDATION_FAILED` 400 (`request_id` missing / not a UUID / extra field), `PARTNER_NOT_APPROVED` / `ACCOUNT_BLOCKED` 403, `TOO_MANY_REQUESTS` 429 (> 10 a minute), `ORDER_ID_UNAVAILABLE` 503 (no `vistaar_orders` row, the old-numbers read failed, or 100 skips — retry later with the **same** `request_id`), `DATABASE_UNAVAILABLE` / `INTERNAL_ERROR` 5xx (retry with the same `request_id`; a number already issued comes back, none is spent twice).
- Writes `app_counters` (`vistaar_orders` row) and `vistaar_v2_order_ids`. Before production (PROD-CHECKLIST): the counter row, the `{order_id: 1}` index on `vistaar_v2_order_ids`, confirm nothing else issues `KSV-` numbers (beta's last old `KSV-` order is 2026-05-30), and ask Stockship for `{order_id: 1}` on `orders_v2` (without it the boot read is a full scan, ~3 s on beta's 534k orders; an order asked for in those first seconds waits for it).

---

## 10. Commission, wallet, withdrawals, TDS

### 10.1 Computation (COMMISSION-LOGIC rules R1–R8)

- **R1 Base** = order lines after discount and coins, **before GST**; delivery and other charges excluded. Discount and coins come off each line by its share of the value; then each line's own GST (`bulk_v2.gst_rate`) is taken out. A pack with unknown GST is taken at 18 % (never overpay).
- **R2 Month sales** = Σ base of orders **delivered** in the IST month, reversed excluded.
- **R3 Rate** = the slab the month's sales reach on **the order's plan** (R3a); every order delivered that month is at the slab reached (retro). A not-yet-delivered order shows this month's slab.
- **R3a The order's plan** = the plan of the partner's **earning cohort when the order was placed**, for the month placed (placing time = `orders_v2.date`, else `created_at`; stretches from `vistaar_v2_earning_assignments`). Steps (`orderPlan`):
  1. No earning cohort at placing → the partner-type plan of the rate month.
  2. The cohort's plan in effect in the month placed; none saved by then → `ec_default`'s plan of that month.
  3. `min_order_value` set and base below it → `ec_default`'s plan of that month.
  4. Still no plan → the partner-type plan of the rate month.
  5. Rate = the slab the rate month's delivered sales reach on that plan — two orders delivered in one month can earn different %.
- **R4 Amount** = `round(base × rate ÷ 100)`, whole ₹.
- **R5 Status**: `pending` from placing → `confirmed` at delivery + `return_window_days` (7) → `paid` once withdrawals cover it; `reversed` if cancelled / returned before confirmation (`reversed_reason` cancelled|returned). Delivered / cancelled / returned come from the order's stage (§9.3), so Stockship's V2 names count too (e.g. `outbound_cancelled` → cancelled, `partial_rto` → returned).
- **R6** Confirmed is final (user, 2026-10-14). **R7** Not counted (`NOT_COUNTED`): `failed` / `pseudo` / `pseudo_order` rows, a `split` parent (its `-S1` / `-S2` children carry the lines), an order `merged` / `merge`d into another. **R8** Shop stock (partner's own `pii_id`) earns the normal rate; a farmer's own app / KKD orders earn nothing.
- **Which orders:** only `orders_v2` rows with `marketplace: 'MKTP-5'` and the partner's `VST-` id in `agent` (not `source`, which Stockship rewrites on create — §9).
- **Plan kinds:** `fixed` (one % whatever the month's sales; stored as one slab `{from: 0, to: null, rate}`) or `slabs` (reached by the partner's whole delivered sales of the month, whatever cohort each order was in). Slab match: `from ≤ sales < to`.
- **Partner-type PRD slabs** (drafts until signed off; bands ₹0–50K / 50K–1L / > 1L): `vistaar_agent` / `ex_employee` 5 / 7 / 10 %; `other_company_employee` / `other` 5 / 7 / 7 %; `consultant` 6 / 8 / 8 %. A partner type added later earns as `other`. Since 2026-10-16 partner-type plans set only orders placed before the partner's first earning cohort.
- **Nothing changes until HO saves an earning plan.** A cohort with no plan inherits `ec_default`'s; while `ec_default` has none, everyone stays on their partner-type plan. Agree the `ec_default` plan with Finance before saving it.
- **Headline vs commission:** `current_rate`, `next_slab`, `plan_draft`, My Performance `monthly[].rate` and HO's `rate` column show the plan a new order would earn on (the cohort now, before any minimum check). Month commission everywhere = Σ each delivered order's own commission, so it need not equal sales × rate.
- **Money:** Earned = Σ confirmed + paid amounts at today's rates + approved meeting gigs and approved gig rewards (when gig pay is on). Paid = Σ withdrawals marked paid. On hold = Σ withdrawals requested or approved. **Withdrawable = earned − paid − on_hold** (never < 0).
- **FIFO allocation:** payouts cover confirmed orders oldest-confirmed first (with gigs, in time order: an order by its confirm date, a gig by its approval). A rate that rises after a payout owes the difference; a falling rate takes nothing back, the payout is only not made twice.
- **Read-time model:** nothing stored per order. Each read computes the book from `orders_v2` (one aggregation per partner, matched on `agent` + `marketplace: 'MKTP-5'` + `order_status $nin failed|pseudo|pseudo_order|split|merged|merge` (exact values — the `$nin` does not trim or lower-case), cached 60 s and shared by every screen). GST / categories from catalogue memory (hourly); plans in memory (60 s); earning assignments and withdrawals cached 60 s for display, read fresh before money moves.
- **TDS** section 194H: 2 % with a verified PAN, 20 % without; estimated at request, **fixed at approval**; always 2 / 20 (no yearly threshold). TDS counts by the month a withdrawal was **paid**.

### 10.2 App endpoints (partner token)

| Method + path | Returns |
|---|---|
| `GET /commission/summary` | `month`, `month_delivered_sales`, `monthly_target`, `current_rate` (my plan now at this month's slab; use for every "Earn ~₹X": price ÷ (1 + GST) × rate), `next_slab {rate, gap}` (null on the top slab, always null on a fixed plan), `month_commission_estimate` (Σ commission of this month's delivered orders, each at its own rate), `totals {pending, confirmed, paid, reversed}` each `{count, amount}`, `earned`, `gig_earned` (meeting gigs + approved gig rewards; 0 while gig pay is off), `withdrawable`, `plan_draft` |
| `GET /commission/ledger?status&page&limit` | Newest order first. Row: `id (cm-<order_id>)`, `order_id`, `customer_id`, `customer_name`, `order_value` (base), `order_status`, `rate`, `amount`, `cohort_id` (earning cohort when placed; null = before earning cohorts), `plan_id` (null = built-in rates), `below_min_order`, `status`, `paid_amount`, `created_at`, `delivered_at`, `confirms_at`, `confirmed_at`, `paid_at`, `withdrawal_id`, `reversed_reason` + whole-ledger `totals` |
| `GET /commission/plans` | `my_cohort` (the partner type), `month`, **`my_plan`** `{earning_cohort {id, name, since} \| null, inherits (null \| 'ec_default' \| 'partner_type'), plan_id, kind, draft, effective_from, slabs, min_order_value, below_min_order {kind, slabs} \| null, notes}`, `plans[]` (every partner type, for orders before the first earning cohort: `{cohort, label, kind, draft, effective_from, slabs, notes}`), `tds {rate_with_pan, rate_without_pan, section}`, `min_withdrawal`, `return_window_days` |
| `GET /wallet` | `withdrawable`, `earned`, `gig_earned`, `paid`, `on_hold`, `min_withdrawal`, `tds_rate`, `pan_verified`, `bank {account_holder, account_last4, ifsc, verified}` (the account payouts go to now — after HO approves a bank account change, the new one), `open_withdrawal`, `can_withdraw`, `blocked_reason` (first that applies: not_approved · bank_not_verified · bank_change_pending · withdrawal_open · below_minimum). `bank_change_pending` = a new account waits for HO (`vistaar_v2_onboarding_data.bank_change.status: 'pending'`): hide Withdraw and say so; the partner can withdraw the change with `DELETE /me/bank-change`. Always current |
| `POST /wallet/withdrawals` | `{amount}` whole ₹, ≥ `min_withdrawal`, ≤ withdrawable, one open at a time, none while a bank account change waits (`409 BANK_CHANGE_PENDING`) → Withdrawal `{id, amount, status, tds_rate, tds_amount, net_amount, account_last4, requested_at, approved_at, paid_at, utr, rejected_at, rejection_reason, cancelled_at}`; summary / ledger may lag ≤ 1 min after HO marks a payout |
| `GET /wallet/withdrawals?status` / `GET /wallet/withdrawals/:id` | Newest first |
| `DELETE /wallet/withdrawals/:id` | Cancel, only while `requested` |
| `GET /reports/commission-statement?month=` | Orders **placed** in the month, oldest first: `{month, rows[], earned, pending, reversed, tds_rate, tds, net_payable}`; the app builds the CSV |
| `GET /reports/tds?quarter=` | `{quarter, deductor: 'Katyayani Organics', section: '194H', pan_number, months[{month, gross, tds_rate, tds, net}], total, form16a_url}` (signed 1 h once uploaded) |

- "Earn ~₹X" with a minimum: when `my_plan.min_order_value` is set and the cart's base is below it, estimate with `my_plan.below_min_order`'s slabs instead of `current_rate`. App shows a fixed plan as "8 % on every order", a minimum as "Orders under ₹2,000 earn 5–10 %", and `inherits: 'partner_type'` as "not priced for your cohort yet".
- An order's `commission` block (`OrderView`): `base, rate, amount, status, confirms_at, confirmed_at, paid_at, withdrawal_id, reversed_reason`; `cohort_id` / `plan_id` / `below_min_order` are on ledger rows only.
- Money units: commission whole ₹; TDS and net to the paisa. Months `YYYY-MM` (IST); quarters `FY2026-Q2` (FY = the year it starts; Q1 = Apr–Jun).
- App errors: `VALIDATION_FAILED` 400, `BELOW_MIN_WITHDRAWAL` 400, `NOT_ENOUGH_BALANCE` 409 (message names the maximum), `WITHDRAWAL_OPEN` 409, `BANK_NOT_VERIFIED` 409, `BANK_CHANGE_PENDING` 409 (a new bank account waits for HO — no new withdrawal until it is decided or withdrawn), `PARTNER_NOT_APPROVED` 403, `WITHDRAWAL_CHANGED` 409, `NOT_FOUND` 404, `UNAUTHORIZED` 401.

### 10.3 Withdrawal state machine

```
requested ──approve──▶ approved ──paid (UTR)──▶ paid
    │                      │
    ├──partner cancels──▶ cancelled
    └──reject──▶ rejected ◀──reject──┘
```

- The amount goes on hold at request; it returns on reject / cancel. HO never creates or deletes a withdrawal; a withdrawal is never edited.
- One open per partner is enforced by the unique partial index `{agent_id} where open: true`, so two processes cannot both open one.

### 10.4 HO endpoints

**Commission plans** (`commission.read` / `commission.plans`)
- `GET /admin/commission-plans?cohort&page&limit` — by cohort, latest month first.
- `GET /admin/commission-plans/in-effect?month=&scope=partner_type|earning` — each active cohort's rates that month (default this month; `scope` default `partner_type`). `scope=earning` lists earning cohorts in priority order, `ec_default` last. Each row: plan fields + `cohort`, `label`, `plan_id`, `effective_from`, `inherits` (`null` = own plan · `'ec_default'` = "As Everyone else" · `'partner_type'` = no plan here or on `ec_default`, `slabs: []`).
- `GET /admin/commission-plans/:id` — `:id` = `<cohort>@<YYYY-MM>` (e.g. `ec_paddy_belt@2026-11`, `vistaar_agent@2026-11`), with `history`.
- `POST /admin/commission-plans` — `{cohort (ec_… or a partner-type key), effective_from (this month or later), kind? ('slabs' default \| 'fixed'), slabs (for slabs) \| rate (for fixed), min_order_value? (₹ 1–10,00,000 or null; earning cohorts other than `ec_default` only), notes[]?, draft? (default true)}`. Slabs: 1–10, first `from: 0`, each starting where the last ends, last `to: null`, rates 0–100 with ≤ 2 decimals. `rate` (fixed): 0–100, ≤ 2 decimals. Sending the other kind's field → 400. Response adds `id`, `created_by`, `updated_by`, `history[]` (`at, by, action, kind, slabs, min_order_value, notes, draft`).
- `PATCH /admin/commission-plans/:id` — `kind`, `slabs` / `rate`, `min_order_value` (null clears), `notes` (this month or later) or `draft` (any plan). Changing `kind` needs its terms in the same body.
- `DELETE /admin/commission-plans/:id` — this month or later only; the cohort falls back to its earlier plan.
- Editor: per earning cohort (Earnings → cohort → Commission tab), fixed / slabs switch, minimum order value, month, notes, "Signed off". Partner-type plans stay in their older table.
- Errors: `COHORT_NOT_FOUND` 400 (partner type or earning cohort), `EARNING_ARCHIVED` 409, `PLAN_EXISTS` 409, `PLAN_LOCKED` 409 (past month), `VERSION_CONFLICT` 409 (raced at that moment; no version is sent), `VALIDATION_FAILED` 400.

**Payouts** (`payouts.manage`)
- `GET /admin/withdrawals?status&agent_id&page&limit` — queue (requested, approved) oldest first; others newest first.
- `GET /admin/withdrawals/totals` — `{requested, approved {count, amount, tds, net}, paid_this_month, paid_this_fy}`.
- `GET /admin/withdrawals/:id` — + `agent_id`, `partner {name, phone, cohort}`, `approved_by`, `paid_by`, `rejected_by`.
- `POST /admin/withdrawals/:id/approve` — balance and bank proof re-checked, TDS fixed. Errors `NOT_ENOUGH_BALANCE` 409 (balance fell — reject it), `BANK_NOT_VERIFIED` 409.
- `POST /admin/withdrawals/:id/reject` — `{reason}` (shown to the partner); on requested or approved.
- `GET /admin/withdrawals/payout-file` — approved withdrawals as bank CSV `{file_name, content_type: 'text/csv', rows, total_net, content, skipped[]}`. Columns `withdrawal_id, agent_id, partner_name, account_holder, account_number, ifsc, amount, tds, net_amount, requested_at`. Missing account / IFSC → `skipped`. Max 500 per file. Holds full account numbers: keep behind `payouts.manage`, never store in the browser.
- `POST /admin/withdrawals/:id/paid` — `{utr, paid_at?}` (not in the future).
- `POST /admin/withdrawals/paid` — batch `{items[{id, utr}], paid_at}` ≤ 200 → `{paid, results[{id, ok, error}]}`; each line conditional on its own; one round trip.
- `WITHDRAWAL_CHANGED` 409 = wrong state for the action.
- **Bank account change** (ONBOARDING-HO.md §3): while a partner's new account waits for HO, only a new withdrawal request is refused (`409 BANK_CHANGE_PENDING`). Withdrawals already requested or approved are not touched, and approve and the bank file still work. Both read the account on the form at that moment: once a change is approved, the bank file pays the new account, even for a withdrawal approved before it (its stored `account_last4`, set at request and again at approval, still shows the old one).

**TDS / Form 16A** (`payouts.manage`)
- `GET /admin/tds?quarter&agent_id&page&limit` — per partner `name, pan_number, payouts, gross, tds, net, form16a {uploaded_at, url} | null` + `quarter, deductor, section`.
- `GET /admin/tds/certificates?quarter&agent_id&page&limit` — quarter required; `{agent_id, quarter, url (signed 1 h) | null, uploaded_by, uploaded_at}`.
- `PUT /admin/tds/certificates/:agentId/:quarter` — multipart `file`, PDF ≤ 5 MB (`FILE_REQUIRED`, `FILE_TYPE_NOT_ALLOWED`, `FILE_TOO_LARGE`). Files private under `KO-documents/<pii_id>/form16a/`.
- `DELETE /admin/tds/certificates/:agentId/:quarter`.

**Performance and partner books** (`commission.read`; target `agents.edit`)
- `GET /admin/performance?month&cohort&state&district&q&page&limit` — approved partners, newest approval first; limit capped at 50. PartnerMonthRow: `agent_id, name, cohort, district, state, month, sales, rate (headline slab), commission (Σ per-order commission), orders_placed, monthly_target, achieved_pct (≤ 100), earned, withdrawable, pending, last_order_at, lifecycle_stage, tier`.
- `GET /admin/performance/board?month=` — every approved partner, not paged: `{month, computed_at, partners, failed, totals {sales, commission, earned, withdrawable, pending, paid}, rows (+ paid, farmers, customers)}`. Kept 10 min per month per process.
- `GET /admin/commission/partners/:agentId?status&page&limit` — `{partner, summary, wallet, ledger}` (the app's numbers; ledger rows carry `cohort_id` / `plan_id` / `below_min_order`).
- `GET /admin/performance/:agentId?period=month|3m|fy`; `PUT /admin/performance/:agentId/target` — `{monthly_target}` or `null` → `{agent_id, own_target}`.
- Cross-partner totals come from `/admin/orders/summary` and `/admin/agents/summary`, never the sum of a page.

### 10.5 Gig pay in the book

- Two sources, treated alike: approved meeting gigs (`vistaar_v2_gigs`) and approved gig rewards (`vistaar_v2_rewards`, `kind: 'gig'`, `status: 'approved'` — every trigger, not only follow-ups; the docs still say "follow-up gig rewards"). Coins never enter the wallet.
- `gig_pay_enabled` (default false) until Finance confirms the TDS section (2026-10-15); one switch for both. While off, `gig_earned` = 0.
- When on: pay is earned at approval (`reviewed_at`), confirmed at once, final; it adds to `earned` and `withdrawable` as `gig_earned`, with **no ledger row**. Approvals made while off count from `gig_pay_enabled_at` (set once at first switch-on, never cleared). Withdrawals carry the same TDS (2 % / 20 %, 194H).
- `GIGS-HO.md` warns: switching pay **off** again takes gig pay back out of the wallet, even when already withdrawn — keep it on once on.

---

## 10A. Earning cohorts, rules and rewards

New on beta (user + TL, 2026-10-16). Partners earn three ways — **commission** on orders, **gig ₹** for actions, **coins** (points) for actions — and all three depend on the partner's **earning cohort**. The earning cohort is not the onboarding cohort (`/admin/cohorts`, the partner type and its form, `onboarding.cohort` on `/me`); the two lists are separate and the app never picks or changes the earning cohort.

### 10A.1 Earning cohorts and assignment

- Ids `ec_<key>` (`/^ec_[a-z0-9_]{1,40}$/`); built-in `ec_default` ("Everyone else").
- **Conditions.** A cohort is an ordered list of `{field, op, value}` conditions — the same shape the rules use — over the partner's **profile** place (mapped at approval and changed by the partner's own `PATCH /me`; not GPS; `profile` first, else the `preview` copy) and what they hold **now**. The fields are the code's cohort catalog (`COHORT_FIELD_CATALOG`, served by `GET /admin/earning-cohorts/catalog`):

| Field | Label | Type | Operators | Value |
|---|---|---|---|---|
| `state` | State | string, kept upper case | `eq`, `any_of` | one value, or a list of 1–40 |
| `district` | District | string, any case | `eq`, `any_of` | one value, or a list of 1–800 |
| `pincode` | Pincode | string, each `^[1-9]\d{5}$` ("each pincode is 6 digits") | `eq`, `any_of` | one value, or a list of 1–2000 |
| `open_leads` | Open leads | number | `gte`, `lte` | 0–10,00,000: open leads held now (not won, not lost) |
| `customers` | Customers | number | `gte`, `lte` | 0–10,00,000: leads at `won` held now |

  - Text values are ≤ 100 characters each, trimmed to single spaces, de-duplicated without case, and compared without case. A list holds when **any** entry matches; **all** conditions must hold. A fact the partner does not have (no profile pincode, say) never matches.
  - A non-default cohort needs **1–12** conditions (`MAX_COHORT_CONDITIONS`). An unknown field, an operator the field does not take, a value of the wrong type, an empty or too-long list, or a bad pincode is `400 VALIDATION_FAILED`, with every problem in `details`.
- **Legacy `filters`.** The old object — `states[]` (≤ 40, kept upper case), `districts[]` (≤ 800), `pincodes[]` (≤ 2000, 6 digits), `min_leads`, `min_customers` (0–1,00,000; 0 or `null` = not used) — is still accepted on create and `PATCH`, **only when `conditions` is absent** (both at once → `400 VALIDATION_FAILED` "Send conditions or the legacy filters, not both."). It is converted to conditions in a fixed order: states → `{state, any_of}`, districts → `{district, any_of}`, pincodes → `{pincode, any_of}`, `min_leads` → `{open_leads, gte}`, `min_customers` → `{customers, gte}`. A legacy body with no filter in use → `400 VALIDATION_FAILED`.
  - Every cohort response carries both: `conditions` (authoritative) and a `filters` view derived from them on a best-effort basis. The view takes the first `state` / `district` / `pincode` condition with `eq` or `any_of`, and the first `open_leads` / `customers` condition with `gte`. A condition the old shape cannot express (an `lte`, say) does not appear in `filters`.
  - A cohort stored before conditions existed (no `conditions`) is converted from its `filters` on read and inside the matcher, so it keeps matching before any migration.
- `summary` is the conditions in words, e.g. "State has any of MADHYA PRADESH · Open leads at least 10". A list of more than 8 values shows the first 8 and "+N more". `ec_default` reads "Every partner".
- **Exactly one cohort per partner:** the first active cohort in HO's priority order (1 = first; ties by id) whose conditions all hold. `ec_default` has no conditions (`[]`), is always looked at last (stored `priority: 0`) and catches everyone. It can't be archived and can't take conditions or filters (`400 EARNING_COHORT_LOCKED`); its name, description, meeting-gig payout and rules can be edited.
- **Only approved partners are placed, and only placed partners earn.** A partner is placed only if they are at stage `approved` and `is_active` is not `false`; `earning_cohort` is null before approval. A rule pays nothing to a partner who is not placed, not even an `ec_default` rule.
- **An archived cohort pays nothing from the moment it is archived.** Until the recompute moves its partners, their current cohort reads as `ec_default`, both for rules and for `/me`.
- **When a partner is re-placed** (the reason that is written is in brackets):
  - **HO decisions:** HO approves (`partner_approved`) or unblocks (`partner_unblocked`) the partner. The recompute is awaited inside the decision; a failure is logged.
  - **Profile place edit:** the partner sends `state`, `district` or `pincode` on `PATCH /me` (section 4) (`profile_changed`). The recompute is awaited before the answer, so `earning_cohort` on that answer is already the new one. A village alone does not move the cohort, because no cohort condition tests it. A failed re-place is logged and the edit still saves; the next holdings change, cohort change or recompute fixes it. The `backfill-partner-place` script also re-places everyone with `profile_changed`.
  - **Holdings** (`holdings_changed`), worked out right after the answer: the partner adds a farmer or takes one over (the partner who lost the farmer is re-placed too); a lead moves into or out of `lost`; a lead is won (first order); the partner removes a lead; HO transfers a farmer (both partners).
  - **Cohort changes** (`cohorts_changed`, every partner, after the answer): HO adds a cohort, edits its conditions, reorders the cohorts or archives one. This takes a few seconds for 10,000 partners; a change asked for while a run is going runs once more at the end. Only a change to `conditions` moves partners; name, description and payout do not.
  - **First seen** (`first_assignment`): an approved partner never placed is placed on `/me`, on rule evaluation or on the HO agent route.
  - **HO's button** (`recompute`).
- A partner's recomputes run one after another in a process. Across processes, the single open assignment row is the guard: a lost race is read again, up to 2 tries.
- Lapsed holds still count (the farmer stays until another partner takes them over), so a partner never drops out by time passing.
- **History:** every stretch is kept in `vistaar_v2_earning_assignments` (one open row per partner, unique partial index), newest first, ≤ 100 shown. Reasons: `partner_approved · partner_unblocked · profile_changed · holdings_changed · cohorts_changed · first_assignment · recompute`. The current cohort is copied to `vistaar_v2_agents.earning_cohort`. Commission follows the cohort **at the order's placing**.
- Partners approved before the feature are placed on first app open, on the agent route, or by recompute — run `POST /admin/earning-cohorts/recompute` once after deploy.

### 10A.2 Rule engine (coins and gig ₹)

- HO writes rules per cohort (the default too). A **trigger** is an event the code knows; HO picks the **conditions** and the **reward**. A new trigger needs code; conditions and rewards never do.
- On the event, the rules checked are the active rules for that trigger in the partner's current cohort, **in HO's order**. Per reward kind, the **first** rule whose conditions all hold pays. One event can pay one coin rule and one gig rule, never two of the same kind. A rule with no conditions pays every time (put it last). A rule takes ≤ 10 conditions, and all must hold.
- **Triggers (catalog, 10).** The *Once per* column is the reward's `_id` (section 10A.3):

| Trigger (label) | Fired by | Fields | Once per |
|---|---|---|---|
| `lead_created` ("Farmer lead added") | `POST /leads` with the farmer's OTP, `result` `created` or `linked` (re-saving a held farmer doesn't count). A meeting capture's new lead fires it too | `crops` (string[], `any_of`), `acreage` (number), `farmer_district` (string), `farmer_state` (string, upper case) | farmer, ever: `lead_created:<pii_id>:<kind>` (also after a release, a takeover, or a remove and re-add) |
| `follow_up_done` ("Follow-up done") | `POST /leads/:piiId/activities`: a call, visit or WhatsApp on a lead whose `next_follow_up` (as it stood before the activity) is due by the end of today (IST) or overdue. A note never counts | `activity_type` (enum `call`/`visit`/`whatsapp`), `days_overdue` (number; 0 = due today) | lead + IST due day: `follow_up_done:<pii_id>:<YYYY-MM-DD>:<kind>` |
| `lead_stage_advanced` ("Lead stage advanced") | `PATCH /leads/:piiId` `stage` to a later stage of prospect → contacted → interested → negotiation (a skip counts). `lost` never fires it; `won` comes only from an order | `to_stage` (enum `contacted`/`interested`/`negotiation`), `from_stage` (enum `prospect`/`contacted`/`interested`) | lead + stage reached: `lead_stage_advanced:<pii_id>:<to_stage>:<kind>` — moving back and forward again never pays twice |
| `reorder` ("Customer ordered again") | `POST /hooks/orders/confirmed` (section 6) for a farmer already a customer of that partner (`result: updated`), with an order date newer than `last_order_at`. A replay or an older order never fires it | `gap_days` (number): IST days since the previous order (0 if none was recorded) | order: `reorder:<order_id>:<kind>` |
| `meeting_attendee_captured` ("Meeting attendee became a lead") | `POST /meetings/:id/attendees/:phone/lead` (section 16) | `crops` (string[]), `acreage` (number), both from the capture body | meeting + farmer: `meeting_attendee_captured:<meeting_id>:<pii_id>:<kind>` |
| `gig_approved` ("Gig work approved") | HO `POST /admin/gigs/:id/approve` on a gig with a taker (section 18). It is a bonus over the gig's own ₹ payout | `attendees`, `photos` (numbers: the counts on the gig) | gig: `gig_approved:<gig_id>:<kind>` |
| `event_registered` ("Registered for an event") | `POST /events/:id/register` when a seat is newly taken (section 17). A repeat call that keeps the seat doesn't fire it | `event_id` (string) | event + partner, ever: `event_registered:<event_id>:<VST-…>:<kind>` — leaving and registering again never pays twice |
| `attendance_streak` ("Attendance streak") | `POST /attendance/punch-out` (section 14) | `streak_days` (number): consecutive IST days with a punch-in, ending today, looked back 60 days at most. An `eq N` rule pays the day a streak reaches N; a `gte N` rule pays every day it holds | IST day: `attendance_streak:<VST-…>:<YYYY-MM-DD>:<kind>` |
| `onboarding_approved` ("Partner approved") | HO `POST /admin/agents/:agentId/approve` (section 4), after the partner is placed in a cohort | `partner_type` (string: the onboarding cohort key), `state` (string, upper case: the profile state) | partner, ever: `onboarding_approved:<VST-…>:<kind>` |
| `story_created` ("Story created") | `POST /stories` that creates a brand-new story (section 15). An edit or re-share of a saved one never fires it | `template` (string: the story template's key) | story: `story_created:<story_id>:<kind>` |

- **Operators:** `eq`, `in`, `any_of`, `gte`, `lte`. Each type takes its own:
  - **string:** `eq` / `in`. A value of ≤ 100 characters, or a list of 1–200; compared without case.
  - **enum:** `eq` / `in`, with values from the field's `values`.
  - **number:** `eq` / `gte` / `lte`, from 0 to 10,00,000.
  - **string[]:** `any_of`, a list of 1–200.

  A catalog field may override its type's operators, list cap and pattern; only the cohort fields do (10A.1). The reward is `{kind: coin|gig, amount}`, a whole number from 1 to 1,00,000.
- The rule `summary` text reads like "Crops has any of Paddy · Acreage at least 2". A rule with no conditions reads "Every time".

### 10A.3 Rewards

- **Who makes a reward.** Only the **server** makes one, when an event matches a rule; never the app, and never HO by hand. It is written to `vistaar_v2_rewards` with the rule, its name, the amount and the cohort at that moment.
- **What the row is about.** `pii_id` and `farmer_name` hold the farmer, on a trigger about one (`lead_created`, `follow_up_done`, `lead_stage_advanced`, `reorder`, `meeting_attendee_captured`); otherwise they are `null`. `ref_id` holds the other thing the reward is about: the order (`reorder`), the meeting, gig, event or story, the streak's IST day, or the partner (`onboarding_approved`); otherwise it is `null`. `due_day` is set for follow-ups.
- **Id** = `<trigger>:<1–3 key parts>:<kind>`, one per event and kind (the *Once per* column in 10A.2). A duplicate insert means the event was already rewarded, and it is skipped.
- **Id check.** The HO `:id` param and the bulk `ids` must match `^(lead_created|…|story_created)(:[A-Za-z0-9_/-]{1,64}){1,3}:(coin|gig)$`, built from the trigger and kind lists; anything else is `400` "This is not a reward id.". Before 2026-10-21 only lead and follow-up ids passed this check, and every other trigger's ids answered `400`.
- **Status** `pending → approved | rejected`; nothing is paid before approval, and nothing is ever deleted. Only a pending reward moves, and only once (the status is in the update filter); otherwise `409 REWARD_NOT_PENDING`. A removed lead's pending `lead_created` reward is rejected by `system` (`reason: 'lead removed'`); approved ones stay. Other triggers' rewards are not touched by a removal.
- **Coins** are points: approved coins add to the balance. There is no redeem or spend yet, and coins are never money or wallet.
- **Gig ₹** of any trigger is earned at approval and joins the wallet as `gig_earned`, only while `gig_pay_enabled` is on (section 10.5).
- The action that fires an event never fails because of a reward: a reward error is logged and the save or activity still succeeds.

### 10A.4 App endpoints (partner token)

| Method + path | Returns |
|---|---|
| `GET /me` | `earning_cohort {id, name, since, rules[{name, trigger, trigger_label, reward, summary}]}` (section 4.1); `null` until approved, or when it could not be read (the rest of `/me` still answers). After a place edit on `PATCH /me` it is already the new cohort |
| `GET /rewards/summary` | `{coins {approved, pending}, gig {approved_amount, pending_amount, pay_enabled}}`; the coin balance is `approved` |
| `GET /rewards?kind&status&page&limit` | Own rewards, newest first: `{id, kind, trigger, trigger_label, rule_name, pii_id, farmer_name, ref_id, due_day, amount, status, reason, created_at, reviewed_at}` (`pii_id` / `farmer_name` null on a trigger not about a farmer); read-only |
| `GET /commission/plans` | `my_plan` by earning cohort (section 10.2) |

### 10A.5 HO endpoints

Capabilities (heads and admins today):
- `earning.read` / `earning.write` for cohorts and rules.
- `rewards.read` / `rewards.review` for the rewards desk.
- Commission plans per cohort stay under `commission.read` / `commission.plans`.

| Method + path | Capability | Rules |
|---|---|---|
| `GET /admin/earning-cohorts?include_archived&page&limit` | read | Priority order, `ec_default` last, then archived (newest first) |
| `GET /admin/earning-cohorts/catalog` | read | `{fields[{key, label, type, operators, upper?, max_values?, pattern?, pattern_hint?, hint}], operators[{key, label}]}`: the five cohort fields of 10A.1, plus all five operator labels (`eq` "is", `in` "is one of", `any_of` "has any of", `gte` "at least", `lte` "at most"). Build the condition form from it |
| `GET /admin/earning-cohorts/:id` | read | One |
| `POST /admin/earning-cohorts` (201) | write | `{name ≤ 60, key?, description? ≤ 300, conditions (1–12) \| legacy filters (≥ 1 used), meeting_gig_payout? (₹ 0–1,00,000; null = settings `gig_payout`)}`. A key in use, or `default` → 409 `COHORT_EXISTS`. The new cohort goes just above the default |
| `PATCH /admin/earning-cohorts/:id` | write | `{version, name?, description? (null clears), conditions?, filters?, meeting_gig_payout?}`. `conditions` is the **whole list** and replaces what is stored. Legacy `filters`, only without `conditions`: keys merge over the stored legacy view (`[]` / `null` stops one), then convert, so a condition the old shape can't express (an `lte`) is dropped by such an edit. A stale version → 409 `VERSION_CONFLICT`. Conditions or filters on `ec_default` → 400 `EARNING_COHORT_LOCKED`. An archived cohort → 409 `EARNING_ARCHIVED`. Nothing sent → 400 `VALIDATION_FAILED`. Only a change to `conditions` moves partners |
| `POST /admin/earning-cohorts/:id/archive` | write | The "delete": nothing is removed; partners move to the next cohort that takes them; its rules never pay again; no restore |
| `PUT /admin/earning-cohorts/order` | write | `{ids}`: every active cohort except `ec_default`, once each; otherwise 409 `EARNING_ORDER_CHANGED` |
| `POST /admin/earning-cohorts/recompute` | write | Re-places every approved partner (awaited) → `{partners, changed}` |
| `GET /admin/agents/:agentId/earning-cohort` | read | `{agent_id, current {cohort_id, name, since} \| null, facts {state, district, pincode, open_leads, customers}, history[{cohort_id, name, from, to, reason}]}` |
| `GET /admin/earning-rules/catalog` | read | `{triggers[{key, label, description, fields[{key, label, type, operators, hint?, values?, upper?}]}], operators[], reward_kinds}` (the 10 triggers of 10A.2). Build the form from it |
| `GET /admin/earning-rules?cohort_id&trigger&include_archived&page&limit` | read | By cohort, then order |
| `GET /admin/earning-rules/:id` | read | One |
| `POST /admin/earning-rules` (201) | write | `{cohort_id (active), name ≤ 80, trigger, conditions? (≤ 10 `{field, op, value}`; empty = every time), reward {kind, amount}}`. Each condition is checked against the catalog (a 400 lists every problem). The rule goes last in its cohort |
| `PATCH /admin/earning-rules/:id` | write | `{version, name?, conditions? (whole list), reward?}`; `trigger` and `cohort_id` never change |
| `POST /admin/earning-rules/:id/archive` | write | Stops paying; rewards already given stay |
| `PUT /admin/earning-rules/order` | write | `{cohort_id, ids}`: every active rule of that cohort, once; otherwise 409 `EARNING_ORDER_CHANGED` |
| `GET /admin/rewards?status&kind&trigger&agent_id&from&to&page&limit` | rewards.read | Newest first. `trigger` is any of the 10 catalog keys. `from` / `to` are IST days on the earning date. The queue is `?status=pending` |
| `GET /admin/rewards/summary?from&to` | rewards.read | `{coin {pending, approved, rejected: {count, amount}}, gig {…}, pending}` (`pending` = both kinds, the queue badge) |
| `GET /admin/rewards/:id` | rewards.read | The app view (with `ref_id`) + `rule_id`, `cohort_id`, `reviewed_by` (HO email or `system`), `agent_id`, `partner {agent_id, name}` |
| `POST /admin/rewards/:id/approve`, `POST /admin/rewards/:id/reject {reason 1–300}` | rewards.review | Pending only; any trigger's id |
| `POST /admin/rewards/approve {ids}`, `POST /admin/rewards/reject {ids, reason}` | rewards.review | 1–200 ids → `{changed[], skipped[{id, status \| null}]}`; never fails as a whole |

- EarningCohort shape: `id, name, description, conditions, filters (derived legacy view), summary, priority, status (active|archived), meeting_gig_payout, version, is_default, partners_count, created_by, updated_by, archived_by, archived_at, created_at, updated_at`.
- EarningRule shape: `id, cohort_id, name, trigger, conditions, reward, order, status, version, summary, …audit`.
- Errors: 400 `VALIDATION_FAILED` (body shape; a cohort with no condition, or no legacy filter, or both shapes at once; a condition the catalog refuses; a reward id that fails the check), 400 `EARNING_COHORT_LOCKED`, 404, 409 `COHORT_EXISTS`, `VERSION_CONFLICT`, `EARNING_ARCHIVED`, `EARNING_ORDER_CHANGED`, `REWARD_NOT_PENDING`.
- **Writes:** only `vistaar_v2_earning_cohorts`, `_rules`, `_assignments`, `vistaar_v2_rewards` and `vistaar_v2_agents.earning_cohort`; nothing in shared collections. The modules that fire triggers (leads, customers hook, meetings, gigs, events, attendance, partner desk, My Story) write rewards only through `RewardsService`.

---

## 11. My Performance

`GET /performance?period=month|3m|fy` (default `month`; `fy` = April → this month; else 400) and `GET /performance/standing` (cached ≤ 5 min; call on app open → `{cohort, tier, lifecycle_stage, health_score, monthly_target}`). Read-only, computed on request. Order figures come from the partner's commission book (§10.1: `orders_v2` with `marketplace: 'MKTP-5'` + `agent`, `NOT_COUNTED` left out, cached 60 s), so Stockship's V2 status names count by their mapped stage (§9.3).

| Field | Definition |
|---|---|
| `from` / `to` | First day; day after the end |
| `first_app_order_at` | Placing time of the partner's earliest order in the commission book (null with none) — the app's "counts cover app orders from <month>" |
| `sales {value, previous}` | Base of orders delivered in the span, before GST, reversed excluded (same as commission). `previous` = same span just before; null for `fy` |
| `target {value, achieved_pct}` | `monthly_target × months`; pct ≤ 100. Per-partner target from HO, else settings default ₹1,00,000 |
| `orders_placed {value, previous}` | Orders placed in the span from the commission book, cancelled included; `NOT_COUNTED` rows (failed / pseudo / pseudo_order / split / merged / merge, §9.3) are not orders |
| `active_customers` | Distinct farmers with a non-cancelled order placed in the span; shop stock excluded |
| `lead_conversion {total, won, lost, pct}` | won ÷ all leads added in the span (null with none) |
| `gigs {done, earnings, farmers, upcoming}` | This IST month regardless of period: HO-approved gigs, Σ payout, farmers present, accepted not started. Null if gigs are unreadable (rest still answers) |
| `commission {value, draft_rate}` and `monthly[].commission` | Σ commission of the orders delivered each month, each at its own plan's rate (orders in one month can earn on different earning-cohort plans); `monthly[].rate` is the headline slab, so commission need not equal sales × rate |
| `monthly[]` | Every FY month `{month, sales, rate, commission, in_period}` |
| `by_category[]`, `top_products[]` | All categories largest first; top 4 products |
| `tier` | Average delivered sales of the 3 **completed** months before this one: Bronze ₹0 · Silver 50K · Gold 1L · Platinum 2.5L; `progress_pct` ≤ 100 (a tier never drops on the 1st) |
| `lifecycle_stage` | onboarded (no order) · active · at_risk (30+ days since last order) · lost (90+) |
| `health {score, factors[]}` | 5 × 20 points: last order ≤ 7 days; ≥ 4 orders this month; ≥ half of open training courses done (no courses exist yet → counts as good); ≥ 4 field days (attendance punch-ins) this month; no overdue follow-up |

---

## 12. Payments (options and credentials)

### 12.1 App — `GET /payment-options` (partner token)

Array `{id, provider (razorpay|cashfree|phonepe), label, hint | null, key_id?}` — only options HO switched on for the partner's cohort (`cohorts: []` = every partner; a partner with no cohort sees only those) and that have approved live keys (Cashfree needs none), in display order (first = selected). Unknown provider → skip the row. **Empty = online off**, and always empty while the server switch `PAYMENTS_ONLINE_ENABLED` is off.

- `key_id` — **Razorpay row only**: the live Razorpay Key ID HO approved (the active set's public id; it opens the checkout sheet). Left out when there is none. No other row carries an id, and no secret is ever sent. KO Utils creates the Razorpay order with its own secret, so the Key ID must be of that same account.
- **Cashfree** row carries no id at all: KO Utils holds Cashfree's App ID and secret. The app sends the order to Utils `POST /cashfree/order` and opens the Cashfree checkout with the `payment_session_id` it answers. Cashfree needs no keys here, so it is shown whenever HO switches it on (user's decision, 2026-10-21).
- HO changes and key changes reach the app ≤ 1 min (per-process copies of the option rows and of the live keys, 60 s each); load once per checkout.
- Takes no payment: gateway order / verify / webhook is a separate API, not built; when it is, the server re-checks the option is still on and computes the amount itself (the app never sends one).

### 12.2 HO — options (`payments.read` / `payments.write`)

- `GET /admin/payment-options` — `{online_enabled, items[]}`, all three always, in order: `{id, provider, label, hint, is_active, order, cohorts, version (0 = never saved → off), updated_by, updated_at, keys_required, configured, mode}`.
  - `keys_required: false` = a keyless gateway (`KEYLESS_PROVIDERS` = Cashfree): always `configured: true`, `mode: null`; keys stored for it before it went keyless are ignored.
  - Razorpay / PhonePe: `keys_required: true`, `configured` = approved live keys exist, `mode` = their `test` / `live` (else `null`).
  - Never-saved defaults (off): Razorpay "UPI, cards, net banking" order 0, Cashfree "UPI, cards, net banking" order 1, PhonePe "PhonePe or any UPI app" order 2.
- `PATCH /admin/payment-options/:id` — `{version (required, int ≥ 0), is_active?, label? (1–40, plain text), hint? (≤ 80 or null), cohorts? ([] = every partner; keys `^[a-z][a-z0-9_]{1,40}$`, unique, ≤ 50; inactive cohorts allowed)}`; no links, no `<` `>`; nothing to change → `400 VALIDATION_FAILED`. Switching on needs approved keys, checked fresh (not the minute-old copy) — `400 CREDENTIALS_MISSING`; never for Cashfree. Errors also `VALIDATION_FAILED`, `COHORT_NOT_FOUND` 400, `VERSION_CONFLICT` 409. Returns the option with its new `version`.
- `PUT /admin/payment-options/order` — `{ids}`, every id exactly once, first shown first → `{ids}`; a row never saved is created off.
- `GET /admin/payment-options/audit?page&limit&option_id` — newest first; `option_id` `*` for a reorder; `before` / `after` hold only the changed fields (for keys: ids and masked values only); actions update, reorder, credentials_submitted / tested / approved / rejected / revoked.
- Providers and gateway URLs are fixed in code; HO can never add a gateway.

### 12.3 HO — credentials (`payments.credentials`)

- Every response `Cache-Control: no-store`; no response ever contains a secret (only `masked`, e.g. `••••abcd`).
- **Which gateways take keys here:** Razorpay (Key ID only) and PhonePe. **Cashfree takes none** — KO Utils holds them; any submit for it is `400 CREDENTIALS_NOT_USED`, and it is never listed on the keys screen.
- **Flow:**
  1. **Submit** (admin A): `POST /admin/payment-credentials/:provider` `{mode, fields, note? (≤ 200)}`. Needs `PAYMENTS_CREDENTIALS_KEY` on the server (`503 CREDENTIALS_NOT_CONFIGURED`), even for a Key-ID-only Razorpay set. `fields` must be exactly the provider's (an unknown key is refused, not dropped; `details[]` lists each bad field). Secrets are sealed at once with AES-256-GCM (`PAYMENTS_CREDENTIALS_KEY`, env only; bound to row + provider + field); a Razorpay set has none to seal. Waits as `pending` for 24 h; one waiting set per provider, and none while another set is half-way to live (`409 CREDENTIALS_PENDING`); a waiting set past its 24 h is expired and replaced.
  2. **Gateway check**: `POST /admin/payment-credentials/requests/:id/test`. No money moves, endpoints fixed in code — Razorpay looks up the Key ID with its public `GET https://api.razorpay.com/v1/preferences?key_id=` (no secret; the same check as My Mali's checkout preflight); PhonePe mints an OAuth token (live or pre-prod endpoint by `mode`). A pass is required; 400 / 401 / 403 = keys refused, another status or no answer in 10 s = try again.
  3. **Approve** (admin B ≠ A, else `403 APPROVER_IS_SUBMITTER`): `POST …/requests/:id/approve`. Needs `pending`, not expired, a passed check (`409 CREDENTIALS_NOT_TESTED`). Keys go live; previous live keys are wiped. If the server stops half-way the set stays `approved` — any admin but A presses Approve again, or Reject.
  4. **Reject**: `POST …/requests/:id/reject {reason (3–200)}` on `pending` or a stuck `approved`; rejected sets wiped. The submitter may withdraw their own set this way.
  5. **Revoke** (emergency): `POST /admin/payment-credentials/:provider/revoke {reason (3–200)}` → `{revoked: true}`; `404 NOT_FOUND` when the provider has no live keys. The app stops offering the option within a minute.
- `GET /admin/payment-credentials` → `{storage_ready, required_mode, modes, providers[{provider, fields[{key, label, secret, hint, optional}], active, pending}]}` — providers Razorpay and PhonePe only; `pending` is the waiting or stuck-`approved` set. `GET /admin/payment-credentials/:provider/history?page&limit` → `PageResult<CredentialView>`, newest first.
- `CredentialView`: `{id, provider, mode, status, public_fields, masked ({} when there are no secrets), note, submitted_by, submitted_at, expires_at, test: {ok, message, by, at} | null, decided_by, decided_at, reason, activated_at, retired_at, retired_by}`.
- Fields per provider (`fields[].optional` marks one that may be left empty; none is today):
  - razorpay: `key_id` only (`^rzp_(test|live)_[A-Za-z0-9]{8,32}$`), under either `mode`; **no secret fields** — a `key_secret` or `webhook_secret` sent is refused as an unknown field. KO Utils registers the Razorpay order with its own secret (as for My Mali) (user's decision, 2026-10-16).
  - cashfree: none (`400 CREDENTIALS_NOT_USED`).
  - phonepe: `client_id` (4–128 letters, digits, `_` `-`), `client_version` (1–4 digits), secret `client_secret` (16–256 letters, digits, `_` `-`).
- **Mode:** every server accepts both `test` and `live`; HO picks it on the form (user's decision, 2026-10-16). `required_mode` is only the form's default — `live` in production, `test` elsewhere; `modes` = `['test', 'live']`. The mode is never read from the key: a `rzp_live_` key may be filed under `test`, and the other way round.
- Status: `pending → approved (a moment) → active → superseded | revoked`, or `rejected | expired`.
- The live keys are opened only inside the server for taking a payment — never returned by a route, never logged.
- Every step is audited and alerted to Slack (`PAYMENTS_ALERT_WEBHOOK_URL`; always logged too; a failed alert or audit row never fails the change). Submit is limited to 10 an hour per admin, the check to 20.
- Errors: `VALIDATION_FAILED` 400, `CREDENTIALS_NOT_USED` 400 (keys for Cashfree), `APPROVER_IS_SUBMITTER` 403, `NOT_FOUND` 404 (no such set; revoke with no live keys), `CREDENTIALS_PENDING` / `CREDENTIALS_NOT_PENDING` / `CREDENTIALS_EXPIRED` / `CREDENTIALS_NOT_TESTED` 409, `CREDENTIALS_NOT_CONFIGURED` 503 (no key env), `CREDENTIALS_UNREADABLE` 503 (sealed with another key — submit again).

---

## 13. Radar

`GET /radar?lat=&lng=&km=10` (partner token).
- `lat` / `lng` = phone GPS, both or neither; fallback centre = signup place, else pincode. `km` 1–50, default 10 (chips 2 · 5 · 10 · 15).
- Response: `centre {lat, lng, source: gps|signup|pincode}`, `km`, `counts {customers, leads, unplaced, stores}`, `items[]` (own customers and open leads, nearest first, ≤ 500: `pii_id, kind, name, phone, village, district, crops, acreage, stage, expected_value, orders / spend / last_order_at (customers only), distance_km, lat, lng, exact`), `stores[]` (KKD stores from `franchises`, nearest first, ≤ 50: `id FRN-…, name, address, city, state, pincode, phone, lat, lng, distance_km`). Store failure → `stores: []`, farmers still returned.
- Reads by `agent_id` with `$geoWithin` (`{agent_id, location: 2dsphere}` in production). No retailers, nobody else's farmers. The PRD's "new farmers" layer is not built (TL decision). "Send farmer" is a WhatsApp share from the phone; the server sends nothing.
- Errors: 400 `VALIDATION_FAILED` — only one of lat / lng, location outside India, or no GPS and no signup place.

---

## 13A. KKD & App activity

New module `kkd-activity` (2026-10-21; PRD C8 / AD16). It powers the Vistaar app's **KKD & App activity** screen (`/kkd-activity`) and a farmer's **KKD & App** tab. The screen shows what the partner's own farmers do without the partner, so the partner knows whom to call or visit. That covers a **Katyayani Krishi Kendra** store (walk-ins, store orders, crop advice) and the **Katyayani app / website** (orders, app opens, abandoned carts). The module only reads other apps' records. It has no collection of its own and writes nothing. **No commission** is paid on any of it; it is for follow-up only (TL). There is no HO endpoint, env var or setting.

### 13A.1 Whose activity

- **Held farmers only.** The source is `LeadsService.heldFarmers(agent_id)` (section 5): every `vistaar_v2_leads` row the partner holds now, whether open, won (customers) or lost, up to 5,000. A farmer who is transferred, taken over after release or deleted drops out at the next read (the feed is cached for up to 60 s).
- **From the hold start.** Each farmer's `since` is `held_since`, else the row's `created_at`. Nothing from before `since` is shown. The source reads start at the earliest `since` of all the partner's farmers, and each record is then checked against its own farmer's `since`.
- **Match on `pii_id` first, else the mobile** (normalised to 10 digits; the TL allowed phone matching). `orders_v2` is matched on `pii_id` only. Walk-ins, crop advice and the POS archive are matched on `pii_id` or `phone`. App events are matched on the mobile only (`kkd_events.user_id`).
- **Any store counts**, not only nearby ones. A farmer who buys at a store 80 km away still shows. The 50 km ring applies only to `GET /kkd-activity/stores`.

### 13A.2 App endpoints (partner token)

| Method + path | Purpose |
|---|---|
| `GET /kkd-activity?customer&channel&from&to&page&limit` | The feed, newest first (ties broken by `id`) |
| `GET /kkd-activity/summary?month&customer` | The screen's four tiles |
| `GET /kkd-activity/stores` | KKD stores within 50 km of where the partner registered, nearest first |

- **Feed query.**
  - `customer` is one farmer `PII-…` (upper-cased), used by Customer details → KKD & App. It must be a farmer the partner holds, else 404.
  - `channel` is `store` or `app` (the screen's tabs). Leave it out for All.
  - `from` / `to` are IST days `YYYY-MM-DD`, both included. Leave them out for all time.
  - `page` defaults to 1. `limit` defaults to 50 and is clamped to 200.
  - `sort` (from the shared page query) is accepted but ignored.
  - Paging is done in memory over the whole filtered list, so `total` counts every match.
- **Feed row** (`PageResult<KkdActivity>`; the app's `KkdActivity` entity maps 1:1):
  - `id` is the stable list key: `order:<order_id>`, `walk_in:<_id>`, `advisory:<rx_id, else _id>`, `app_cart:<_id>` or `app_open:<pii_id>:<IST day>`.
  - `type`, `channel`.
  - `customer_id` (`pii_id`) and `customer_name` (the lead's name).
  - `store_id` is the store's franchise id on store rows, else `null`.
  - `store` is the store's name on store rows, `"Katyayani app"` / `"Katyayani website"` on app orders, and `"Katyayani app"` on app opens and carts.
  - `date`.
  - `amount` is whole ₹ on orders and carts, else `null`.
  - `items[]` (`Name 250 ML ×2`), `note`, and `order_id` (orders only).
- **Summary** returns `{month, walk_ins, store_orders {count, amount}, app_orders {count, amount}, open_app_carts {count, amount}}`.
  - `month` is an IST month and defaults to this month.
  - Walk-ins, store orders and app orders (app and website) count only rows whose IST month is `month`.
  - `open_app_carts` covers **any month**: an `app_cart` with no `app_order` (app or website) from the same farmer after it.
  - `customer` narrows the tiles to one farmer, with the same 404 rule.
- **Stores** returns `{centre {lat, lng, source: signup|pincode} | null, km: 50, stores[] {id, name, address, city, state, pincode, phone | null, lat, lng, distance_km}}`. `distance_km` is rounded to 0.1 km (see 13A.4).

### 13A.3 Types and source rules

| `type` | `channel` | Source (read-only) | Rule |
|---|---|---|---|
| `app_order` | app | `orders_v2` with `marketplace` MKTP-3 (`store: "Katyayani app"`) or MKTP-2 (`"Katyayani website"`) | Real sales only (see below) |
| `store_order` | store | `orders_v2` MKTP-4, plus the franchise backend's POS archive `franchise_v2_pos_orders` | An MKTP-4 order counts only when it is tied to a store. The POS login comes first: `created_by` matches a store's email or a StockShip `employees` login that has a `franchiseId`. Otherwise the order's `warehouse.warehouse_id` must match a store's warehouse (a `WH-*` string or an ObjectId). Orders with `sub_source: 'founder_office'` are company orders filed on a store and never count. An order with no store found is left out. A POS archive row is skipped when it has `in_stockship: true` or its `order_id` already came from `orders_v2`, so an order is shown once |
| `walk_in` | store | `franchise_v2_walkins` | Walk-ins with `status: 'rejected'` (wrong entries) are left out. `note` = the walk-in notes |
| `advisory` | store | `franchise_v2_prescriptions` | `note` = `crop — problem — solution`. `items` = the recommended product names |
| `app_open` | app | `kkd_events` `APP_LAUNCH` | One per farmer per IST day: the latest open that day |
| `app_cart` | app | `kkd_events` `Cart Abandoned` | `amount` = `event_values.total_price`. Lines come from `event_values.items {name, quantity}` |

- **Real sale** (`orders_v2`): the status is not `failed`, `pseudo`, `pseudo_order`, `split`, `merged` or `merge`, and the order's stage (the order module's status map, section 9) is not cancelled or returned. The row's date is `date`, else `created_at`.
- **Order lines.** `orders_v2` lines are named from StockShip's catalogue: name plus pack size by `sku`, from the product facts held in memory. An unknown `sku` shows as the sku. POS archive lines use their own `product` name, else the `sku`.
- **`soil_test`** appears in the app's mock but has no source anywhere. It is never returned.
- **Store name** follows the Nearby radar (section 13): `Katyayani Krishi Kendra · <city>`. With no city, or a store id that is not in the store list, the name is just `Katyayani Krishi Kendra`.
- **The store list** combines three sources:
  - StockShip `franchises`: map point `location.coordinates`, warehouse `warehouse.warehouseId`, and email.
  - The franchise HO portal's `franchise_v2_franchises`: newer stores with no map point. For the same id, StockShip's row wins.
  - StockShip `employees` POS logins: only `email` + `franchiseId`.

### 13A.4 Stores within 50 km

- **Centre**, in order:
  - The partner's signup GPS (`vistaar_v2_agents.location`), with `source: signup`.
  - Else the centre of their pincode (the profile pincode, else the onboarding form's pincode in `preview`) from the pincode book (`pincode_map_v2`), with `source: pincode`.
  - Else `null`, and then `stores: []`. The app shows "Add your pincode in Edit Profile to see stores near you".
- **Which stores.** Only stores with a map point (StockShip `franchises`) are listed. A store that is only in `franchise_v2_franchises` shows once it has a map point. The distance is haversine and the limit is 50 km (fixed, TL), nearest first. The list has no cap beyond the store read (≤ 5,000 rows per collection). Store names match the Nearby radar.

### 13A.5 Freshness, failure and limits

- **Cache.** On the first call, each partner's whole feed is built from all sources and kept for **60 s** per process (up to 2,000 partners in memory). The store list is shared by all partners and also kept for 60 s. A walk-in just entered at a store shows within a minute; pull-to-refresh after a minute reads again. The `customer` hold check (`LeadsService.holds`) is never cached.
- **One source down means its rows are left out.** The sources are read in parallel, and a failed one is logged as a warning while the rest still answer, with no error.
  - Without the store list, MKTP-4 orders cannot be tied to a store and are left out, and store rows show `Katyayani Krishi Kendra`.
  - Without the catalogue, order lines show the sku.
  - Only the read of the partner's own leads is required. If it fails, the call fails and nothing is cached.
- **Read size.** Each source read returns at most 2,000 rows, newest first, from the earliest hold.

### 13A.6 Errors

- `401`: no partner session, or it has ended.
- `400 VALIDATION_FAILED`: `customer` is not `PII-…` ("This farmer is not valid."), `channel` is not `store` / `app`, `from` / `to` is not `YYYY-MM-DD`, or `month` is not `YYYY-MM`.
- `404 NOT_FOUND` "This farmer is not one of yours.": the `customer` is not held by the partner (feed and summary).
- `404 NOT_FOUND` "This partner could not be found.": the partner record is missing (stores).
- A `from` later than `to` is not refused; it returns an empty list.

### 13A.7 Collections read (read-only; nothing written)

| Collection (owner) | Read |
|---|---|
| `vistaar_v2_leads` (ours) | The held farmers (`agent_id`, ≤ 5,000) and the `customer` hold check |
| `vistaar_v2_agents` (ours) | Signup GPS and pincode, for the store centre |
| `orders_v2` (StockShip) | `{pii_id $in, marketplace $in [MKTP-2, MKTP-3, MKTP-4], date ≥ earliest hold}`, newest first, ≤ 2,000. Uses StockShip's existing `{pii_id: 1, date: -1}` index |
| `products_v2` → `bulk_v2` → `categories_v2` (StockShip) | Line names, through the in-memory product facts shared with orders |
| `franchise_v2_walkins`, `franchise_v2_prescriptions`, `franchise_v2_pos_orders` (franchise backend) | By `pii_id $in` **or** `phone $in` (10 digits) from the earliest hold, ≤ 2,000 each. These collections have no `pii_id` / `phone` index (48 / 11 / 507 rows on 2026-10-21; a scan is fine today). Ask for `{pii_id: 1}` and `{phone: 1}` once they grow; that is owed by the franchise team |
| `kkd_events` (Katyayani app) | `APP_LAUNCH` and `Cart Abandoned` events by `user_id $in` (10-digit mobile) from the earliest hold, ≤ 2,000. Only `_id` is indexed (43 test rows). Ask the Katyayani app team for `{user_id: 1, event_name: 1, created_at: -1}` before event volume goes live |
| `franchises` (StockShip), `franchise_v2_franchises` (franchise HO portal), `employees` (StockShip) | The store list, ≤ 5,000 rows each, cached 60 s. From `employees`, only `email` + `franchiseId` of rows that have a `franchiseId` |
| `pincode_map_v2` (ko-sales) | Pincode centre for the store ring (pincode book in memory) |

There is nothing to build in production and nothing is written (go-live gate in section 27).

### 13A.8 Before production: no dummy data (the Vistaar app)

The app's server build still reads the **mock seed** for KKD activity: `RemoteCustomersRepositoryImpl.kkdActivity` → `_local.kkdActivity()` in `customers_seed.dart`. Every screen below shows fake farmers' walk-ins, orders and carts until it is moved to the API. Nothing from the seed may ship.

| Where (app, `vistaar-2.0-ui`) | Today (mock) | Use instead |
|---|---|---|
| KKD & App activity page (`kkd_activity_page.dart`): list, tabs, farmer filter | Seed `kkdActivity` | `GET /kkd-activity` (`channel`, `customer`, paging) |
| Same page: the 4 tiles | Counted on the phone from the seed | `GET /kkd-activity/summary` |
| Customers list: "Active at KKD/app" badge (`farmers_page.dart`, last 7 days) | Seed | `GET /kkd-activity?from=<IST day 7 days ago>&limit=200` → the set of `customer_id`s |
| Customer details: timeline, open app carts, pitch (`farmer_details_page.dart`; `customer_catalog.dart` `openAppCarts` / `buildPitch` `kkd ?? kkdActivity`) | Seed | `GET /kkd-activity?customer=<pii_id>`. Open carts = `app_cart` rows with no later `app_order` (the same rule as the tile) |
| Home Today's tasks: "left an app cart" | Demo build only. The server build uses `GET /today`, which has **no** KKD cart task (section 7) | Nothing; do not add it from the seed. A backend KKD cart task in `/today` is not built |
| Nearby radar stores | Demo build only (`kkdStores` seed). The server build uses `GET /radar` `stores` | Already real; keep the seed out of the server build |

Rules for the app:

- **No seed fallback.** A failed call shows the error / retry state. An empty answer shows "No KKD or app activity from your farmers yet". Never fill the screen with seed rows.
- **Hide what has no data.**
  - Remove the `soil_test` chip, filter and icon from the screen and the farmer timeline.
  - Leave out store services and opening hours (not on record).
  - With `amount: null`, show no ₹ line (never "₹0").
  - Leave out the line when `note` is `null` or `items` is `[]`.
  - With `stores: []` or `centre: null`, show the empty line from 13A.4.
- Remove `kkdActivity` / `kkdStores` from `customers_seed.dart`, or keep them only behind the demo flag, never reachable on the Vistaar API.
- **Go-live gate:** the app build on `/kkd-activity` has shipped and the `soil_test` chip is hidden.

### 13A.9 Beta test data (`seed-test-kkd-activity`)

- **What it writes.** It was applied on beta on 2026-10-21. KKD activity has no collection of its own, so on the user's decision this seed writes into **other apps' collections**: `franchise_v2_walkins`, `franchise_v2_prescriptions`, `franchise_v2_pos_orders`, `orders_v2` and `kkd_events`.
  - Every row has a fixed `TEST-KKD-…` id (fixed `6b6b64…` ObjectIds in `orders_v2` / `kkd_events`), `source: 'test'` and `test_seed: 'seed-test-kkd-activity'`.
  - The StockShip orders are only `delivered` / `cancelled` and say "TEST DATA" in `notes`.
  - Dates are 0–6 days before the run, after the farmers' hold began (2026-10-13/14). A re-run moves them.
- **What VST-000006 sees.** `GET /kkd-activity` shows 12 rows. The tiles read walk-ins 3, store orders 1 · ₹1,240, app orders 2 · ₹2,230 and open app carts 2 · ₹3,749. The rows cover:
  - a walk-in with nothing bought, and an open app cart;
  - a walk-in and a POS store order on the same day;
  - a cart closed by a later app order (MKTP-3);
  - crop advice with 2 products;
  - a website order (MKTP-2) and an app open today;
  - a lost lead's walk-in, which still counts;
  - two app opens on one day, shown as one;
  - a `rejected` walk-in and a `cancelled` app order, which are **never shown**.
- **How to run it.** `node dist/scripts/seed-test-kkd-activity.js` is a dry run. `--apply` writes, replacing only rows that carry the tag. `--remove` deletes every tagged row from the five collections. The script refuses to run with `NODE_ENV=production` and builds no index (`autoIndex` / `autoCreate` off). Run `--remove` before anyone reads beta's franchise / StockShip reports for real numbers.

---

## 14. Attendance

### 14.1 App

- `GET /attendance/today` → AttendanceDay; `POST /attendance/punch-in`, `POST /attendance/punch-out` (body Punch) → today's AttendanceDay; `GET /attendance?month=YYYY-MM` → AttendanceMonth.
- Punch body: `{source: gps|registered, lat, lng (required and inside India for gps; 0,0 refused; absent for registered), accuracy_m?, label (required, ≤ 200)}`.
- AttendanceDay: `date, status (not_started|on_duty|day_closed|missed_punch_out), punched_in, first_in_at, session_in_at, last_out_at, worked_ms, location, sessions[]`. Month: `days[]` (punched days only, newest first, ≤ 31) + `summary {present_days, closed_days, worked_ms, avg_worked_ms}` (hours over closed days only).
- Rules: server clock only (the phone sends no time; the app's live timer uses the HTTP `Date` header: `worked_ms + (now − session_in_at)`); IST days; ≤ 10 sessions / day; punch-out location is never compared to punch-in; only today's session can be closed — an earlier open day is `missed_punch_out` and its open session isn't counted. The 14-day strip may cross months (fetch this and the previous month).
- **Streak reward (2026-10-21):** a successful punch-out counts the unbroken run of IST days with a punch-in ending today (looked back 60 days at most) and records an `attendance_streak` reward event with `streak_days` — once per partner per IST day (reward id `attendance_streak:<agent_id>:<day>:<kind>`). An `is N` rule pays the day the streak reaches N, an `at least N` rule every day it holds. Pending until HO decides it (section 10A). A failure to record is logged and never fails the punch-out.
- Errors: 400 `VALIDATION_FAILED`, 409 `ALREADY_PUNCHED_IN`, 409 `NOT_PUNCHED_IN`, 409 `PUNCH_LIMIT_REACHED` (11th punch-in), 409 `ATTENDANCE_CHANGED` (another device — refresh), 429 `TOO_MANY_REQUESTS` (> 10 / min).
- Storage: today / punch = `_id` lookup, month = `_id` range; the HO board and range views read by `date`, on the `{date: 1}` index (in the production checklist).

### 14.2 HO (`attendance.read`, read-only)

- `GET /admin/attendance?date=` (default today) → `summary {partners (approved + anyone who punched), on_duty, day_closed, missed_punch_out, not_started, worked_ms (closed sessions), avg_worked_ms}`, `rows[]` per partner (status, first in, last out, worked, where the last session started, sessions), `trend` (14 days ending on date). A partner blocked after punching still appears with `name: null`.
- `GET /admin/attendance/range?from&to` (both included, ≤ 366 days) — late = first punch-in after 10:00 IST (`late_after_min: 600`); full day = closed day ≥ 6 h. `summary {partners, present_days, avg_present, late_days, missed_days, full_days, worked_ms, avg_worked_ms, every_day, never}`; rows incl. `no_gps_days`, `break_days`, `avg_in_min` / `avg_out_min` (IST minutes past midnight), `marks` (`.` none · `C` closed · `O` on duty today · `M` left open), `minutes[]`. Reads only listed fields, never coordinates.
- `GET /admin/attendance/partners/:agentId?month=` — the app's month view + partner.

---

## 15. My Story

### 15.1 App (partner token)

| Method + path | Purpose |
|---|---|
| `GET /stories/content` | `{templates, designs, festivals, farmer_stories, meetings}`; `If-None-Match` → 304 |
| `POST /stories/images?kind=render\|photo` | Multipart `file` → UploadedStoryImage. render: JPG/PNG/WEBP ≤ 3 MB, strict 9:16, 540–2160 px wide. photo: ≤ 5 MB, ≥ 200 px a side, ≤ 4096 px longest. Type / size read from bytes |
| `POST /stories` | Save → Story |
| `GET /stories` | Story[], newest by `last_used_at`, max 20 |
| `GET /stories/:id`, `POST /stories/:id/share {channel}`, `DELETE /stories/:id` | `:id` must be a UUID |

- `POST /stories` body: `config.template` ∈ product|testimonial|tip|meeting|festival|custom; `config.lang` hi|en; `config.card` (custom card key, null for built-in); `config.theme` (design key; green, harvest, earth, sky always draw); `config.photo_mode` background|inset; `config.fields` — all nine always sent (unused = ""): headline / detail1–3 ≤ 120, body ≤ 400, price / mrp ≤ 12, emoji ≤ 16, stars 1–5; `selection` (opaque picker ids, optional); `image` required (a render path the caller uploaded); `photo` optional; `channel` optional ∈ status|download|farmer|copy.
- **Dedupe:** same `config` on the same `photo` = one row (moved to top, image replaced); `selection` is not part of the match. Unique `{agent_id, signature}` also stops double-tap double saves.
- **Cap 20:** a 21st save evicts the oldest with its files.
- **Reward (2026-10-21):** a save that creates a brand-new story records a `story_created` reward event (field `template`; once per story, reward id `story_created:<story id>:<kind>`). A dedupe save of an existing story or a share never does. Pending until HO decides it (section 10A); a failure to record is logged and never fails the save.
- Upload paths are signed receipts (`…/<uuid>~r~1080x1920~<time>~<sig>.png`); a receipt is trusted for 1 h without a bucket check, older paths are verified against the bucket. Returned URLs are signed 1 h (reused while ≥ 15 min left); cache bytes by path, never URL; `url` may be null if signing failed.
- `/stories/content` composition: templates = HO strip in order (suggested first; hidden / out-of-window omitted; empty → app's bundled six; unknown base → card skipped); designs in picker order, the first is default, nine colours `#RRGGBB[AA]`, optional public 9:16 art + overlay, `templates[]` restricts (empty = all); a removed design key keeps saved images, edit falls back to default; festivals = HO's live greetings (legacy keys diwali, chhath, sankranti, generic still work; fallback `text.en`); `farmer_stories` = approved Vistaar testimonials with words (newest 50) + HO samples; `meetings` = upcoming events for the cohort (`e:<id>`), own scheduled meetings (`m:<uuid>`), accepted gigs (`g:<GIG-n>`), soonest first. Crop calendar removed 2026-10-14.
- Each save / share also `$inc`s `vistaar_v2_story_stats` (per partner per IST day, by template and channel).
- Errors: `FILE_REQUIRED` 400, `FILE_TYPE_NOT_ALLOWED` 400, `IMAGE_SIZE_NOT_ALLOWED` 400, `FILE_TOO_LARGE` 413, `IMAGE_NOT_FOUND` 400, `UPLOADS_NOT_CONFIGURED` 503 (share anyway, save later), `NOT_FOUND` 404, `TOO_MANY_REQUESTS` 429. A failed save never blocks the share.

### 15.2 HO

**Template cards** `/admin/story-templates` (`content.*`; `:key`, not UUID): GET list (strip order, suggested first, all states), GET `/:key`, POST, PATCH `/:key`, DELETE `/:key` (custom only; built-in delete → 400, hide instead). Custom card: `key` (create-only, `^[a-z][a-z0-9_]*`, not a layout name; taken → 409 `TEMPLATE_EXISTS`), `base` (create-only), `label` / `hint` (en required), `texts {kicker (required), cta ("" = none)}` (PATCH replaces set), `fields` pre-fill per lang (PATCH replaces set), `emojis` ≤ 24 (empty = app's built-in 8), `default_design` (unknown → 400; later deleted → warning), `suggested`, `starts_at` / `ends_at`, `order`, `is_active` (at least one card must stay shown → 400). Response adds `builtin`, `status` live|scheduled|expired|inactive, `warnings`. A new layout needs an app release.

**Designs** `/admin/story-designs` (`:id` UUID): GET `?status&page&limit&sort`, `POST /image` (JPG/PNG/WEBP ≤ 3 MB, 9:16, 720–2160 px wide; 1080×1920 best), GET / POST / PATCH / DELETE. `key` immutable (409 `DESIGN_EXISTS`); colours required `bg_from`, `bg_to`, `text`, `accent`, optional derived `subtext`, `accent_text`, `soft`, `deco`, `avatar`; PATCH colours replaces the palette; `image` (null removes art); `overlay` 0–0.9 (0.35 default with art); `templates` subset; window; `order` — the first live design is the app default. Contrast `warnings` never block a save. Deleting a design never changes a saved story.

**Festivals** `/admin/story-festivals` (`:id` UUID): same CRUD. `key` `^[a-z][a-z0-9_]{1,40}$` (409 `FESTIVAL_EXISTS`); `label.en`, `emoji` (≤ 16) and `text.en` required; every lang needs headline + body. Keep one windowless festival so the picker is never empty.

**Samples** `/admin/story-samples`: list `?is_active&page&limit&sort`; `key` unique immutable (409 `SAMPLE_EXISTS`); `name`, `product`, `quote` (≤ 400) required; `stars` 1–5 (default 5).

**Activity** (`stories.read`): `GET /admin/stories/summary?from&to`, `GET /admin/stories/partners?from&to&page&limit` (most shares first), `GET /admin/stories/partners/:agentId`. IST days, default last 30, max 92. `totals {saved, shares (every share / download / send / copy incl. re-shares), partners}`, `by_template`, `by_channel {status, farmer, download, copy}`, `by_day`. A deleted story's shares stay counted.

**Saved stories**: `GET /admin/stories?agent_id&template&page&limit&sort` (`stories.read`), `GET /admin/stories/:id`, `DELETE /admin/stories/:id` (`stories.write`; removes files).

---

## 16. Meetings

Partner-only writes; HO read-only on purpose. **No delete** — cancel keeps the record.

### 16.1 App (partner token; others' meetings → 404)

| Method + path | Purpose |
|---|---|
| `GET /meetings?status&page&limit` | `scheduled` soonest first, else newest first |
| `GET /meetings/invitees?q&village&page&limit` | Caller's customers + open leads (lost excluded) `{pii_id, name, phone, village, stage}`; village matches first |
| `GET /meetings/:id` | MeetingDetail |
| `POST /meetings` (201) | Create |
| `PATCH /meetings/:id` | Any create field but `id` / `invite`; only while scheduled |
| `POST /meetings/:id/cancel` | `{note? ≤ 300}`; only while scheduled |
| `POST /meetings/:id/complete` | Needs ≥ 1 farmer present |
| `PUT /meetings/:id/attendees` | Whole list, ≤ 300 |
| `POST /meetings/:id/attendees/:phone/lead` | Capture as lead |

- Create: `id` (app UUID; retry-safe — same id returns the existing meeting, body not reapplied; id held by another partner → 409 `MEETING_EXISTS`), `type` ∈ farmer_meeting|crop_demo|field_day|disease_camp|soil_health_camp, `starts_at` (future), `village` ≤ 80, `title` ≤ 120 ("" → "<type> · <village>"), `venue` ≤ 120, `pincode` 6 digits, `organiser` self|officer (default self), `agenda` ≤ 500, `invite` ≤ 300 pii_ids (own customers / open leads only; others dropped silently; invites only at creation). Approved partner only.
- PATCH: null / "" clears venue / pincode / agenda; new `starts_at` future; title "" resets to default; changing type / village alone keeps the old title.
- Attendees PUT: `{attendees[{phone, name ≤ 80, present, village?}]}`. An invited phone stays `invited`, any other is `walk_in`; omitted farmers are removed; a phone matching an own lead / customer is linked (`pii_id`, `stage`); capture is kept for phones still listed; duplicate / bad mobile → 400. Concurrent save → server merges once more, then 409 `VERSION_CONFLICT` (optimistic lock on `updated_at`).
- Capture: body exactly `POST /leads` (phone must equal `:phone`, consent etc.); `found_via` forced to `meeting`; the attendee becomes `present: true, lead_captured: true` with `pii_id`. Already your lead / customer → 400; phone not on list → 404; leads errors pass through. If the meeting is cancelled at that moment the lead still stands. A capture records a `meeting_attendee_captured` reward event (fields `crops`, `acreage` from the body; once per attendee per meeting, reward id `meeting_attendee_captured:<meeting id>:<pii_id>:<kind>`, 2026-10-21); the new lead may also pay `lead_created`. Pending until HO decides it (section 10A); a failure to record is logged and never fails the capture.
- Lifecycle: `scheduled → completed | cancelled`; nothing moves back. Attendees and capture allowed in scheduled and completed, not cancelled (409 `MEETING_CLOSED`).
- Meeting carries `counts {invited, present, leads}` always matching the list. WhatsApp invites: no-op notifier for now.

### 16.2 HO (`leads.read`)

`GET /admin/meetings?agent_id&status&from&to&page&limit` (limit default 50 / max 200; newest `starts_at` first), `GET /admin/meetings/summary?agent_id&from&to` (default 1st of month → today) → `{meetings, by_status, partners, invited, present, leads, from, to}`, `GET /admin/meetings/:id` (attendees with each farmer's current stage with that partner).

---

## 17. Events

### 17.1 App (partner token; cut to caller's cohort — other cohort → 404)

- `GET /events` (upcoming soonest first), `GET /events/past?page&limit` (newest first), `GET /events/:id`, `POST /events/:id/register` (takes a seat; repeat = no-op), `DELETE /events/:id/register` (only before start; gives the seat back).
- Event: `{id (UUID), title, type (kisan_mela|training|webinar|field_day), starts_at, location, note, seats, registered_count, seats_left, status, registered}`.
- Seat = row `<event_id>:<agent_id>`; `registered_count` by conditional `$inc`. List counts may lag ≤ 1 min; the register answer is exact.
- **Reward (2026-10-21):** a register that takes a new seat records an `event_registered` reward event (field `event_id`; once per event per partner, ever — reward id `event_registered:<event_id>:<agent_id>:<kind>`, so leaving and registering again never pays twice). A repeat register (seat already held) records nothing. Pending until HO decides it (section 10A); a failure to record is logged and never fails the register.
- Errors: 409 `EVENT_FULL`, 409 `EVENT_CLOSED` (started or switched off), 404, 429 (> 20 / min).

### 17.2 HO (`content.read` / `content.write`)

- `GET /admin/events?status&type&cohort&page&limit&sort`, `GET /:id`, `GET /:id/registrations?page&limit` (`{agent_id, name, phone, cohort, district, registered_at}`), POST, PATCH, DELETE.
- Fields: `title` ≤ 120, `type`, `starts_at` (registration closes then), `location` ≤ 200, `note` ≤ 300 (printed on a story invite), `seats` 1–100000 and never below `registered_count` (400, or 409 `EVENT_SEATS_TAKEN` if partners registered meanwhile), `cohorts` (empty = all), `is_active`. Status computed: upcoming|past|inactive.
- DELETE removes every seat; to keep history, switch off instead.

---

## 18. Gigs

### 18.1 State machine

```
open ──accept / HO assign──▶ accepted ──check-in──▶ checked_in ──submit──▶ submitted ──▶ approved | rejected
  ▲                            │                        │
  └── partner release (before the gig's IST day) ───────┘ (accepted only)
  └── HO reopen (from accepted / checked_in: check-in, farmers, photos cleared) ┘
HO cancel: from anything not approved / rejected / cancelled → cancelled
```

- approved, rejected, cancelled are final; a rejected gig can't be resent. Any refused transition → 409 `GIG_CLOSED`. Every move is a conditional update on the status read.
- `missed` is a flag, not a status: held (accepted / checked_in) and the IST day passed. Late check-in and submit still work; it stays in Mine until HO cancels or reopens.
- Check-in is **never refused**; it records flags: `early` (before the gig's IST day), `late` (after), `no_gps`, `far` (beyond `gig_checkin_radius_m`, default 500 m, from the HO-pinned venue; no pin → no `far`).

### 18.2 Pay (earning cohorts, 2026-10-16)

| `payout` on the gig | `payout_source` | What it pays |
|---|---|---|
| A number | `gig` | That ₹, whoever takes the gig |
| Left out / null | `cohort` | Null while open — each viewer sees their own cohort rate ("Your rate"); fixed at accept / assign to the taker's earning-cohort `meeting_gig_payout`, else settings `gig_payout` |

- Fixed while held: a later cohort move or settings change doesn't touch it. Release or reopen sets a cohort-paid `payout` back to null.
- HO switches the source with PATCH (`payout: null` → cohort; a number → gig), only while open and unheld. Gigs posted before 2026-10-16 are `gig`. If the payout was edited between read and take, accept / assign answers 409 `GIG_TAKEN` / `GIG_CLOSED`.
- Earned at HO approval; reaches the wallet (`gig_earned`) only while `gig_pay_enabled` is on (section 10.5). HO lists show a null payout as "Partner's cohort rate"; `approved_payout` counts fixed payouts only.
- **Rule-engine gig rewards are not gigs:** a `gig` (₹) reward from any trigger's rule (usually a follow-up) comes from the rule engine (section 10A), is listed in `GET /rewards`, approved on the rewards desk, and shares `gig_earned` and the same switch. `earned_this_month` counts meeting gigs only.
- **Approval bonus (2026-10-21):** HO approval also records a `gig_approved` reward event for the gig's partner (fields `attendees`, `photos` — the counts on the row; once per gig, reward id `gig_approved:<GIG-n>:<kind>`) — a rule bonus over the gig's own payout, usually coins, pending until decided on the rewards desk. A failure to record is logged and never fails the approval.

### 18.3 App (partner token)

| Method + path | Purpose / rules |
|---|---|
| `GET /gigs?tab=available\|mine\|history&page&limit` | available = open, not started, for the onboarding cohort (no cohorts = all) and state (when both known), nearest pinned venue first then soonest; cached ≤ 1 min per server. mine = accepted / checked_in / submitted, soonest first. history = approved / rejected / cancelled, latest first |
| `GET /gigs/summary` | `{available, mine, earned_this_month, pay_enabled}` |
| `GET /gigs/:id` | GigDetail (attendees, photos signed 1 h) |
| `POST /gigs/:id/accept` | Approved partner only. Taken / race → 409 `GIG_TAKEN`; started / decided / cancelled → 409 `GIG_CLOSED`; re-accept idempotent. `warning` "You already have a gig that day." — never blocks. A cohort-paid gig's pay is fixed here |
| `POST /gigs/:id/release` | Only accepted, before the gig's IST day; a cohort-paid payout goes back to null |
| `POST /gigs/:id/check-in` | `{location? {lat, lng}, accuracy_m?}`; server time; repeat = no-op. Records `check_in {lat, lng, accuracy_m, at, distance_m, flags[]}` |
| `PUT /gigs/:id/attendees` | Whole list ≤ 300 `{phone, name ≤ 80, village? ≤ 80}`, only while checked_in. Not linked to leads (capture via `POST /leads` with `found_via: 'meeting'`) |
| `POST /gigs/:id/photos/upload-url` | `{content_type (jpeg/png/webp/heic), size}` → signed PUT ticket (15 min) to `vistaar/gigs/<VST>/<GIG>/<uuid>.ext`; > 5 MB → 400 |
| `POST /gigs/:id/photos` (201) | `{path}`; file verified (`MEDIA_NOT_FOUND`); same path = no-op; 7th → 400 |
| `DELETE /gigs/:id/photos/:photoId` | Removes photo and file |
| `POST /gigs/:id/submit` | Needs ≥ `min_farmers` attendees and ≥ `photos_required` photos (400 lists all problems) |

Gig shape: `id`, `title`, `village`, `district`, `state`, `venue`, `venue_point`, `starts_at`, `ends_at`, `expected_farmers`, `min_farmers`, `photos_required`, `payout` (on an open cohort-paid gig: what it pays you), `payout_source` (`gig` \| `cohort`), `products[]`, `requirements[]`, `status`, `distance_km` (registered location → venue, 1 dp), `missed`, `check_in`, `attendees_count`, `photos_count`, `reject_reason`, `cancel_reason`. `venue_point` is sent (the HO pin `{lat, lng}`, null when not pinned; `gigs.service.ts` `viewOf`) — `GIGS-APP.md`'s line "the venue's coordinates are not sent; directions use venue / village" is stale. A gig not open for your cohort and not yours → 404. No push notifications yet. > 30 calls / min per write route → 429.

Errors: `VALIDATION_FAILED`, `FILE_TOO_LARGE`, `MEDIA_NOT_FOUND` 400; `PARTNER_NOT_APPROVED` / `ACCOUNT_BLOCKED` 403; 404; `GIG_TAKEN`, `GIG_CLOSED` 409; 429.

### 18.4 HO (`gigs.read` / `gigs.write` / `gigs.review`)

| Method + path | Capability | Rules |
|---|---|---|
| `GET /admin/gigs?status&agent_id&state&district&from&to&page&limit` | read | Default limit 50; latest `starts_at` first |
| `GET /admin/gigs/summary` | read | Default this IST month (future included): `by_status, partners, approved_payout, farmers, from, to` |
| `GET /admin/gigs/:id` | read | AdminGigView with review data (`payout` null = cohort-paid, not yet taken; `payout_source`) |
| `POST /admin/gigs` (201) | write | CreateGig |
| `PATCH /admin/gigs/:id` | write | Only while open and unheld; null clears district / state / pincode / venue / venue_point (and `payout` → cohort-paid); new `starts_at` future |
| `DELETE /admin/gigs/:id` | write | Only if never taken, else 409 `GIG_CLOSED` (cancel instead) |
| `POST /admin/gigs/:id/assign {agent_id}` | write | From open, not started, partner approved + active + in the gig's cohorts (else 400); fixes a cohort-paid gig's rate for that partner; state and their other gigs that day are not checked |
| `POST /admin/gigs/:id/reopen` | write | From accepted / checked_in → open; clears check-in / farmers / photos (files stay in the bucket); cohort-paid `payout` → null; `releases[] += {by: 'ho'}` |
| `POST /admin/gigs/:id/cancel {reason 1–300}` | write | Final; partner sees reason |
| `POST /admin/gigs/:id/approve` | review | From submitted; final; **approval pays**; records a `gig_approved` reward event (18.2) |
| `POST /admin/gigs/:id/reject {reason 1–300}` | review | From submitted; final |

- CreateGig: required `title` ≤ 120, `village` ≤ 80, `starts_at` future, `ends_at` > starts. Optional `district` ≤ 60, `state` ≤ 60 (upper), `pincode` 6 digits, `venue` ≤ 120, `venue_point`, `expected_farmers` 0–300 (0), `min_farmers` 1–300 (settings), `photos_required` 0–6 (settings), `payout` ₹ 0–1,00,000 (left out / null = the taker's cohort rate), `products` ≤ 20 × ≤ 80, `requirements` ≤ 10 × ≤ 120, `cohorts` (onboarding cohort keys; empty = every partner).
- Review data: `check_in` with flags; `attendees`; `photos` (signed 1 h); `repeat_phones[{phone, partner_phone, gigs[]}]` — an attendee phone seen at another gig (any partner / status) from 30 days before this gig on, or the partner's own phone.
- Settings: `gig_payout` (250; the cohort-paid fallback, read when the gig is taken), `gig_min_farmers` (15) and `gig_photos_required` (3) (new-gig defaults; each gig keeps its copy), `gig_checkin_radius_m` (500; read at every check-in), `gig_pay_enabled` (false), `gig_pay_enabled_at` (read-only).
- Errors: 400 `VALIDATION_FAILED`, 400 `PARTNER_NOT_APPROVED` (assign), 403, 404, 409 `GIG_TAKEN`, `GIG_CLOSED`.

---

## 19. Testimonials

### 19.1 App (partner token; approved, active partners only)

| Method + path | Purpose / rules |
|---|---|
| `GET /testimonials/consent` | `{version, text {en, hi}}` (settings `testimonial_consent`) |
| `POST /testimonials/uploads` | `{kind, content_type, size}` → signed PUT (30 min, exact headers) to `vistaar/testimonials/<VST>/<kind>/<uuid>.ext`. Video mp4 / quicktime / 3gpp / webm ≤ 60 MB and ≤ 90 s; photo jpeg / png / webp / heic / heif ≤ 10 MB |
| `POST /testimonials` | Submit (see below) → status `submitted` |
| `GET /testimonials/mine?status&page&limit`, `GET /testimonials/mine/:id` | Own submissions |
| `GET /testimonials/library?q&bulk&family&crop&kind&state&district&sort&page&limit` | Approved from every partner; `sort` shared (default) \| newest; cards never carry farmer phone or `pii_id`; approved URL is lasting |
| `POST /testimonials/:id/view`, `POST /testimonials/:id/share` | → `{views, shares}` |

Submit fields: `id` (app UUID, retry returns the first), `pii_id` (one of the partner's own farmers, else 404), exactly one of `bulk` (BK-…) / `family` (combo), `crop` 1–40, `kind` video|photo|text, `media_path` (required for video / photo, absent for text; one file = one testimonial), `duration_sec` (video, 1–90), `text` (≤ 1000; ≥ 2 for text), `rating` 1–5, `consent_version` (mismatch → 409 `CONSENT_OUTDATED`, `details[0]` current version), `consent_lang` en|hi. The consent record (exact words, version, lang, server time) goes to `vistaar_v2_testimonial_consents`. `coins_awarded` / `gig_id` stay null until those integrations.

Errors: `VALIDATION_FAILED`, `FILE_TYPE_NOT_ALLOWED`, `FILE_TOO_LARGE`, `MEDIA_NOT_FOUND`, `PRODUCT_NOT_FOUND` 400; 403; 404; 409 `CONSENT_OUTDATED`; 503 `UPLOADS_NOT_CONFIGURED`.

### 19.2 HO — partner submissions desk `/admin/testimonial-submissions` (`:id` UUID)

- `GET ?status&kind&agent_id&q&page&limit&sort`, `GET /summary`, `GET /:id`, `POST /:id/approve`, `POST /:id/reject {reason ≤ 300}`, `POST /:id/remove {reason?}`, `POST /:id/withdraw-consent {reason}`.
- Action matrix: approve from submitted / rejected / removed (never after a consent withdrawal); reject from submitted; remove from approved; withdraw-consent from any state, once (a retry after a failure finishes the erase).
- **Approve** writes rating + words to `product_reviews` and (video / photo) media to `product_testimonials`, both `source: 'vistaar'`, `verified: true`, `verified_by` = HO email, upsert by the `_id` reserved at submit; gives the file a lasting link; enters the Library.
- **Remove** sets `deleted: true` on both rows and kills the link; approving again restores.
- **Consent withdrawal**: the consent row is marked withdrawn (kept forever); Stockship rows and the file are deleted; submission → removed, never approvable again. A concurrent approve sees the withdrawal and deletes what it published (409 `CONSENT_WITHDRAWN`).
- Consent wording: `PUT /admin/settings {testimonial_consent_text {en, hi}}` (new version; the app must re-show it).
- Errors: 404, 409 `TESTIMONIAL_NOT_ALLOWED`, 409 `CONSENT_WITHDRAWN`, 400.

### 19.3 HO — Vistaar testimonials desk `/admin/testimonials` (`:id` = 24-char Mongo id)

- Every `source: 'vistaar'` row in Stockship's `product_testimonials`; another app's row → 404. Trays: pending (`deleted != true, verified != true`), approved (`verified: true`), removed (`deleted: true`; restorable).
- `GET ?status&type&media_type&q&page&limit&sort`, `GET /summary`, `GET /:id`, `POST` (CreateTestimonial), `POST /media` (photo JPG/PNG/WEBP ≤ 10 MB, video MP4/MOV/WEBM ≤ 60 MB, voice MP3/M4A/AAC/OGG/WAV ≤ 20 MB → lasting public link), `PATCH /:id` (verified / deleted / review / media / name), `DELETE /:id`.
- CreateTestimonial: exactly one of `bulk` / `family` (must exist in `bulk_v2.sku` / `combos_v2.family`, else 400 `PRODUCT_NOT_FOUND`), `media {media_type, media_url https ≤ 2000}`, `user.contact` (stored +91XXXXXXXXXX), `user.name` ≤ 80, `review` ≤ 2000, `verified: true` approves at once. Partner rows are read-only here (409 `TESTIMONIAL_FROM_PARTNER`).
- Stockship side: its POST refuses `source: vistaar` (400), its PUT refuses a Vistaar row (403); it may list them.

### 19.4 Shared rows

The exact `product_reviews` / `product_testimonials` rows Vistaar writes are in `docs/VISTAAR-PRD-DATABASE.md`.

---

## 20. Feedback

### 20.1 App (partner token)

- `GET /feedback/reasons` → `{detractor, passive, promoter}` each `{question, chips[]}`; all three always present.
- `POST /feedback` (201) → `{id, bucket, follow_up_due_at, created_at}`. Fields: `nps` int 0–10 (required); `reasons` ≤ 10 × ≤ 60 (stored as shown, trimmed, repeats dropped, not validated against today's chips); `comment` ≤ 500; `rating` 1–5 (independent of NPS; omit for 0 stars).
- `POST /feedback/suggestions` (201) → `{ref: 'SUG-…', product, created_at}`. Fields: `product` 2–80 (required), `crop` ≤ 40, `monthly_demand` ≤ 30, `note` ≤ 300.
- Bucket server-side: 0–6 detractor, 7–8 passive, 9–10 promoter. A detractor opens a call-back owned by the partner's owner (reporting officer), **due at the end of the 2nd working day (Mon–Sat, IST)**; null for others. Partner snapshot copied at submit. Nothing is overwritten — "give more feedback" adds a row.
- Caps: 10 answers + 20 suggestions per partner per IST day (429 `FEEDBACK_LIMIT`, show `details[0]`); 5 POSTs / min (429 `TOO_MANY_REQUESTS`). The daily cap is check-then-insert, bounded by the per-minute throttle.

### 20.2 HO (`feedback.read` / `feedback.write`)

- `GET /admin/feedback?page&limit&sort&bucket&follow_up(open|done|overdue)&agent_id&from&to&q` — sort `-created_at` default, ±nps, ±follow_up.due_at; "Call-backs to make" = `?follow_up=open&sort=follow_up.due_at`.
- `GET /admin/feedback/summary?from&to` — `total`, per bucket, `nps` = %promoters − %detractors (−100…100, null with none), `rating {count, average, stars[5]}`, reasons per bucket, `follow_ups {open, overdue}` (all open, not just the range).
- `GET /admin/feedback/:id`; `PATCH /admin/feedback/:id/follow-up {status: done|open, note ≤ 500}` — open clears `done_by` / `done_at`; the note replaces every time (omitted = cleared); score 7–10 → 400.
- `GET` / `PUT /admin/feedback/reasons` — all three groups, each `{question ≤ 120, chips 1–12 × ≤ 60}`; past answers keep their text.
- Product suggestions: `GET /admin/product-suggestions?…`, `GET /summary`, `GET /top?from&to&limit` (groups by `product_key` → `{product_key, product, count, partners, crops[], last_at}`), `GET /:ref`, `PATCH /:ref {status (new|reviewed|planned|declined) and/or ho_note}`.

---

## 21. FAQs

- App: `GET /faqs` (partner token) → `{sections[{key, label, emoji}], faqs[{id, category, q, a}]}`, no paging. Only sections switched on **and** holding ≥ 1 active FAQ, in HO order; every FAQ's `category` is a key present in the same response. `q` is unique ignoring case and spacing (a `?q=<question>` deep link opens exactly one). Cached ≤ 60 s.
- HO sections `/admin/faq-sections` (`content.*`): `key` 2–41 chars `^[a-z][a-z0-9_]*`, immutable (`_id`); `label` 1–40; `emoji` ≤ 16; `order`; `is_active` (off hides the section and every FAQ in it). GET (array, not paged), GET `/:key`, POST, PATCH `/:key`, DELETE `/:key` only when empty (409 `FAQ_SECTION_IN_USE`); duplicate → 409 `FAQ_SECTION_EXISTS`.
- HO FAQs `/admin/faqs` (`:id` UUID): `category` (existing key; switched-off fine; changing it moves the FAQ), `q` 3–300 (normalised `q_key` unique; 409 `FAQ_EXISTS`), `a` 1–2000 plain text, `order`, `is_active`. GET `?page&limit&sort&category&is_active`, GET `/:id`, POST, PATCH, DELETE (for good).

---

## 22. Terms and conditions

- Shared `terms_and_conditions` with `profiles: ['vistaar']`; every read and write filters on it. One document holds the privacy policy, partner-terms summary and Partner Agreement.
- App: `GET /terms-and-conditions` — `@Public` (login screen), 600 reads / min / IP, cached ≤ 1 min → `{toc_id, version, title, link}`. 404 = none yet (app keeps its built-in summary). Store `toc_id` + `version` with an acceptance; a higher version = text changed.
- Row: `toc_id` `TOC-n` (server-set; next across the whole collection; retry on collision; 503 `TERMS_ID_UNAVAILABLE` after several tries), `title` 1–120, `link` (https, ≤ 1000), `profiles` (read-only), `is_active` (true switches every other Vistaar row off), `__v`. **Version = `__v + 1`**; editing text / title / link keeps `toc_id` and raises `__v` by one; toggling on/off doesn't. A new `TOC-n` only for the first T&C or a deliberate fresh start.
- HO `/admin/terms-and-conditions` (`content.*`): `GET /` (`?is_active&sort&page&limit`), `GET /:toc_id`, `POST {title, link, is_active?}`, `PATCH /:toc_id` (switching one on switches others off — rollback this way), `DELETE /:toc_id` (only a switched-off version; active → 409 `TERMS_IN_USE`), `GET /:toc_id/text` → `{toc_id, version, text}` (409 `TERMS_NOT_EDITABLE` if uploaded, not editor-made), `PUT /:toc_id/text` (text + the `__v` opened; server remakes the .docx, repoints `link`, raises `__v`; stale → 409 `VERSION_CONFLICT`; also makes an uploaded version editable), `POST /compose` (first T&C or fresh start: new `TOC-n`, `is_active` default true).
- Docx mechanics (`terms-docx.ts`): the server builds the .docx and keeps the editable text inside it as a custom XML part — no other store. Old document files stay in the bucket unreferenced.
- Text schema: `title` 1–120; `intro` ≤ 1000 | null; `sections` 1–40 × {`heading` 1–120, `body` ≤ 4000 | null (blank line = new paragraph), `points` ≤ 30 × 1–1000, `items` ≤ 20 × {`title` 1–80, `detail` 1–600, `purpose` ≤ 400 | null}} printed as title / detail / "Used: purpose".

---

## 23. Info pages

- Three pages, one row each in `vistaar_v2_info_pages`; optimistic `version`; content validated by the page's own DTO.
- App (all `@Public`, 600 reads / min / IP, cached ≤ 1 min; 404 = not created → app keeps bundled text): `GET /about-program`, `GET /about-company`, `GET /contact-us` (adds `open_now`, computed per request on the server clock in IST) → `{version, updated_at, content}`.
- HO `/admin/about-program`, `/admin/about-company`, `/admin/contact-us` (`content.*`): GET (404 = not created), POST (whole content, all fields required; 409 `INFO_PAGE_EXISTS`), PATCH (`version` required + any top-level fields; each sent field replaces that whole part; validated as the whole page after the edit; stale → 409 `VERSION_CONFLICT`, nothing written), DELETE (app falls back to built-in text). 400 `VALIDATION_FAILED` lists every problem in `details[]`.
- about-program: `hero {title, tagline 1–120, intro 1–1000}`; `who_can_join.heading` (cards = cohorts from `GET /onboarding/cohorts`); `earn.heading` + `commission`, `gigs`, `no_payout`, `referral` each `{title, body}`; `lifecycle {heading, steps 1–3 of {key pending|confirmed|withdraw, title, body}, reversed_note}`; `payouts {heading, points ≤ 30}`; `rules {heading, items ≤ 30 × {text, cohort | null}, sop {label, sop_id} | null}`; `coins {heading, headline, body}`; `more.items ≤ 3 {key testimonials|grievances|kkd_activity, title, body}`; `footer`. Placeholders allowed: only `{min_withdrawal}` and `{grievance_sla_hours}` (today 48); any other `{…}` refused.
- about-company: `name`, `tagline`, `story ≤ 10`, `mission`, `stats ≤ 8 {label 1–60, value 1–30}`, `what_we_make` / `ecosystem` ≤ 30 tiles `{title, text, emoji}`, `quality_points ≤ 30`, `contact {helpline, email, website https}`, `social ≤ 10 {label, url https}`.
- contact-us: `helpline` / `whatsapp {number (exactly 10 digits; app adds +91), label 1–30}`, `support_email`, `privacy_email`, `play_store_url` https, `hours {days 1–7 distinct ISO weekdays, opens, closes HH:mm IST (closes > opens, exclusive), label}`, `ticket_categories 1–30 × 1–60`, `ticket_reply_note 1–120`. Contact Us also feeds the HO numbers the app's help / privacy / feedback screens use. Tickets not built.

---

## 24. Banners

- App: `GET /banners` (partner token) → PartnerBanner[], display order, max 10; `If-None-Match` → 304; cached ≤ 1 min. Live = switched on, past `starts_at`, before `ends_at`; cohort-targeted → only those cohorts; no cohorts → everyone; a partner without a cohort yet sees only untargeted ones. Shape `{id, title / subtitle / cta (localised, fallback en), link (in-app route starting "/"), tone (primary|warning|success|info), emoji, image {url, width, height} | null}`; image null = text banner.
- HO (`content.read` list / view; `content.write` the rest):
  - `POST /admin/banners/image` — multipart, JPG/PNG/WEBP sniffed from bytes, ≤ 2 MB, exactly 2.4:1 (±1 px), ≥ 600×250 (design 1200×500); the portal crops client-side first → `{path, url, content_type, size, width, height}`. Image saved first, banner after; an unused upload stays; replaced / deleted images are removed once no banner uses them.
  - `GET /admin/banners?status(live|scheduled|expired|inactive)&cohort&page&limit&sort`, `GET /:id`, `POST`, `PATCH /:id` (any subset; null clears subtitle / cta / image / emoji / starts_at / ends_at), `PUT /admin/banners/order {ids}` (every banner id, first first; mismatch → 409 `BANNERS_CHANGED`), `DELETE /:id`.
  - CreateBanner: `title` (en required), `subtitle` / `cta` (text banner only), `image` (path; null = text), `link` (≤ 300, web URLs refused — the app has no web view), `tone` / `emoji` (text only), `cohorts` (bad key → 400 `COHORT_NOT_FOUND`), `starts_at` / `ends_at` (ends > starts), `order` (lower first, ties newest), `is_active`.
  - Errors: `VALIDATION_FAILED`, `COHORT_NOT_FOUND`, `FILE_REQUIRED`, `FILE_TYPE_NOT_ALLOWED`, `IMAGE_SIZE_NOT_ALLOWED`, `IMAGE_NOT_FOUND`, 413 `FILE_TOO_LARGE`, 503 `UPLOADS_NOT_CONFIGURED`, 404, 409 `BANNERS_CHANGED`.

---

## 25. Settings reference

One row `vistaar_v2_settings._id: 'vistaar'`. Read `GET /admin/settings` (`agents.read`), write `PUT /admin/settings` (`settings.write`; send only changed fields; `updated_by` / `updated_at` are set on every write). The app reads settings through each module (cached 60 s). The settings module is unchanged since 17 October.

| Field | Default | Range / notes |
|---|---|---|
| `default_owner_agent_id` | null | Owner for new signups; an active `agents_v2` staff id `A0-…` (`400 OWNER_NOT_FOUND`); `null` or `""` clears it |
| `lead_owner_agent_id` | null (= the one active Offline Head, USR-1037) | Override owner of farmer leads; active `A0-…` account (`400 OWNER_NOT_FOUND`); `null` or `""` clears it. On beta the owner is still the Offline Head — the approving-head rule of `feat/lead-owner` is not merged (section 30) |
| `conflict_radius_km` | 5 | Nearby-network check, 0.5–50 km |
| `farmer_consent` `{version, text {en, hi}}` | null = built-in v1 | Written as `farmer_consent_text {en, hi?}` (≤ 600 each); new text = new version |
| `testimonial_consent` | null = built-in v1 (draft, not legal-approved) | Same shape; written as `testimonial_consent_text` |
| `lead_release_days` | 15 | 1–365 |
| `customer_release_days` | 45 | 1–365 |
| `return_window_days` | 7 | 0–30; changing it moves the confirm date of not-yet-confirmed orders |
| `min_withdrawal` | 500 | 1–1,00,000 |
| `tds_rate_with_pan` | 2 | 0–30, ≤ 2 decimals |
| `tds_rate_without_pan` | 20 | 0–40, ≤ 2 decimals |
| `monthly_target` | 1,00,000 | 1–10,00,00,000 (₹ delivered sales) |
| `feedback_reasons` | null = seed chips | 3 groups × {question ≤ 120, chips 1–12 × ≤ 60}; written through `PUT /admin/feedback/reasons` (`feedback.write`), not `PUT /admin/settings` |
| `gig_payout` | 250 | 0–1,00,000; ₹ for a cohort-paid gig when the taker's earning cohort has no `meeting_gig_payout` (read when the gig is taken) |
| `gig_min_farmers` | 15 | 1–300 (copied) |
| `gig_photos_required` | 3 | 0–6 (copied) |
| `gig_checkin_radius_m` | 500 | 50–20,000 (read at every check-in) |
| `gig_pay_enabled` | false | Approved meeting-gig pay **and** approved `gig` (₹) rewards of any trigger reach the wallet only when on; keep off until Finance confirms TDS |
| `gig_pay_enabled_at` | — | Read-only; set once, never cleared |

---

## 26. Error code catalogue

The complete `API_ERROR_CODES` list in beta's `src/common/errors/api-error.ts` — **108 codes** (102 on 17 October; new: `ID_IN_USE`, `ORDER_ID_UNAVAILABLE`, `CREDENTIALS_NOT_USED`, `NAME_CHANGE_NOT_PENDING`, `BANK_CHANGE_PENDING`, `BANK_CHANGE_NOT_PENDING`), grouped in the file's order. Status codes as the code and the feature docs give them; where a code is reused by a new route, the new use is named.

| Group | Codes |
|---|---|
| Generic | `VALIDATION_FAILED` 400, `NOT_FOUND` 404 |
| Login | `INVALID_PHONE` 400, `OTP_NOT_REQUESTED` 400, `ACCOUNT_NOT_FOUND` 404, `ACCOUNT_EXISTS` 409, `OTP_INVALID` 401, `OTP_LIMIT` 429, `OTP_UNAVAILABLE` 503, `IDENTITY_UNAVAILABLE` 503, `ACCOUNT_BLOCKED` 403 (also `PATCH /me`, the bank change and `POST /orders/id` for a blocked or switched-off account), `SESSION_INVALID` 401 |
| Stages | `STAGE_NOT_ALLOWED` 409 (also a verification call once the partner is approved, rejected or blocked), `STAGE_CHANGED` 409 |
| Onboarding | `COHORT_REQUIRED` 400, `COHORT_NOT_FOUND` 400, `CONFIG_NOT_PUBLISHED` 409, `ONBOARDING_LOCKED` 409, `UNKNOWN_FIELD` 400, `FIELD_NOT_EDITABLE` 409, `REQUIRED_FIELDS_MISSING` 400, `VERSION_CONFLICT` 409 |
| KYC review | `NOT_A_DOCUMENT` 400, `DOCUMENT_MISSING` 400, `DOCUMENTS_NOT_VERIFIED` 409 |
| **Duplicate Aadhaar / PAN (new)** | `ID_IN_USE` 409 — the Aadhaar or PAN is already on another partner's form: app save and submit, HO edit-values; `details` = the clashing field keys (e.g. `["aadhaar"]`), never the number |
| Config / cohorts (HO) | `CONFIG_INVALID` 400 (form / config editor); 409 on a bank change when the partner's form has no payout account field. `NO_DRAFT` 400, `COHORT_EXISTS` 409, `COHORT_IN_USE` 409 |
| HO access | `NO_ADMIN_ACCESS` 403, `ROLE_NOT_ALLOWED` 403, `OWNER_NOT_FOUND` 400 |
| Uploads | `UPLOADS_NOT_CONFIGURED` 503, `FILE_REQUIRED` 400, `FILE_TOO_LARGE` 413, `FILE_TYPE_NOT_ALLOWED` 400 (also `PATCH /me`: the photo is not an image) |
| Cart / catalogue / drafts | `OUT_OF_STOCK` 409, `CART_LIMIT_REACHED` 409, `CART_BUSY` 409, `CATALOG_UNAVAILABLE` 503, `DRAFT_CART_EMPTY` 409, `DRAFT_ID_UNAVAILABLE` 503 |
| **Orders (new)** | `ORDER_ID_UNAVAILABLE` 503 — `POST /orders/id`: no `app_counters._id: 'vistaar_orders'` row, the old `KSV-` numbers could not be read, or no free number after 100 skips; retry with the same `request_id` |
| Banners / images | `IMAGE_SIZE_NOT_ALLOWED` 400, `IMAGE_NOT_FOUND` 400 (also `PATCH /me`: the photo path is not an upload in the partner's own `KO-documents/<pii_id>/` folder), `BANNERS_CHANGED` 409 |
| Testimonials | `PRODUCT_NOT_FOUND` 400, `MEDIA_NOT_FOUND` 400, `TESTIMONIAL_NOT_ALLOWED` 409, `CONSENT_WITHDRAWN` 409, `TESTIMONIAL_FROM_PARTNER` 409 |
| Attendance | `ALREADY_PUNCHED_IN`, `NOT_PUNCHED_IN`, `PUNCH_LIMIT_REACHED`, `ATTENDANCE_CHANGED` (409) |
| Stories / FAQs | `FESTIVAL_EXISTS`, `SAMPLE_EXISTS`, `DESIGN_EXISTS`, `TEMPLATE_EXISTS`, `FAQ_EXISTS`, `FAQ_SECTION_EXISTS`, `FAQ_SECTION_IN_USE` (409) |
| Events | `EVENT_FULL`, `EVENT_CLOSED`, `EVENT_SEATS_TAKEN` (409) |
| Meetings | `MEETING_CLOSED`, `MEETING_EXISTS` (409) |
| Gigs | `GIG_TAKEN`, `GIG_CLOSED` (409) |
| Terms / info pages | `TERMS_IN_USE` 409, `TERMS_ID_UNAVAILABLE` 503, `TERMS_NOT_EDITABLE` 409, `INFO_PAGE_EXISTS` 409 |
| Farmer leads | `PARTNER_NOT_APPROVED` 403 (400 on HO transfer / assign; also `PATCH /me`, the bank change and `POST /orders/id` before approval), `SELF_LEAD` 400, `FARMER_TAKEN` 409, `NOT_A_FARMER` 409, `CONSENT_OUTDATED` 409, `LEADS_NOT_CONFIGURED` 503, `LEADS_UNAVAILABLE` 503 |
| Order events | `ORDER_EVENTS_NOT_CONFIGURED` 503 |
| Feedback | `FEEDBACK_LIMIT` 429 |
| Payments | `CREDENTIALS_MISSING` 400 (switching an option on without approved keys; never Cashfree), **`CREDENTIALS_NOT_USED` 400 (new — keys submitted for Cashfree, which KO Utils holds)**, `CREDENTIALS_NOT_CONFIGURED` 503, `CREDENTIALS_UNREADABLE` 503, `CREDENTIALS_PENDING`, `CREDENTIALS_NOT_PENDING`, `CREDENTIALS_EXPIRED`, `CREDENTIALS_NOT_TESTED` (409), `APPROVER_IS_SUBMITTER` 403 |
| Commission plans | `PLAN_EXISTS`, `PLAN_LOCKED` (409) |
| Wallet | `BELOW_MIN_WITHDRAWAL` 400, `NOT_ENOUGH_BALANCE` 409, `WITHDRAWAL_OPEN` 409, `BANK_NOT_VERIFIED` 409, `WITHDRAWAL_CHANGED` 409 (and `BANK_CHANGE_PENDING`, below) |
| Earning | `EARNING_COHORT_LOCKED` 400 (conditions — or legacy filters — on, or archive of, `ec_default`), `EARNING_ARCHIVED` 409, `EARNING_ORDER_CHANGED` 409 |
| Farmer OTP | `LEAD_OTP_REQUIRED` 400, `LEAD_OTP_INVALID` 400 (expired, other mobile or partner) |
| Rewards | `REWARD_NOT_PENDING` 409 |
| **Profile (new)** | `NAME_CHANGE_NOT_PENDING` 409 — HO approve / reject of a name that is no longer waiting (none waiting, or the partner sent a newer one) |
| **Bank account change (new)** | `BANK_CHANGE_PENDING` 409 — a change is already waiting (`POST /me/bank-change`), and a new withdrawal while one waits (`POST /wallet/withdrawals`); `BANK_CHANGE_NOT_PENDING` 409 — the partner's withdraw or HO's approve / reject of a change no longer waiting |

Framework codes (`FRAMEWORK_ERROR_CODES`, 12, not usable through `apiError()`): `UNAUTHORIZED`, `FORBIDDEN`, `SERVICE_UNAVAILABLE`, `INTERNAL_SERVER_ERROR`, `TOO_MANY_REQUESTS`, `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`, `DUPLICATE_KEY`, `INVALID_ID`, `SCHEMA_VALIDATION_FAILED`, `DATABASE_UNAVAILABLE`, `INTERNAL_ERROR`. `WIRE_ERROR_CODES` is the union of both lists.

Rule: a 4xx (except 401, 408, 429) is final; a 5xx or no answer may be retried (for `POST /orders/id`, always with the same `request_id`). `details` is an array of sentences; the app shows `details[0]`.

---

## 27. Production: env vars, indexes, data steps, go-live gates

### 27.1 Environment (every var is declared in `config/env.schema.ts` and `.env.example`; `env.schema.ts` is unchanged since 17 October — no new var)

| Var | Required | Default | Production rule |
|---|---|---|---|
| `NODE_ENV` | no | `development` (development / test / production) | `production` (else index builds run at boot) |
| `PORT` / `HOST` | no | 3000 / 0.0.0.0 | — |
| `MONGODB_URI` | **yes** | — | Production `CRM-Database`, **same region as the app** (28 ms RTT was most of every request) |
| `MONGODB_DB_NAME` | no | `CRM-Database` | — |
| `MONGODB_MAX_POOL_SIZE` / `MIN` | no | 50 (1–500) / 5 (0–100) | Processes × max ≤ Mongo connection limit; min ≤ max |
| `WEB_CONCURRENCY` | no | 0 (0–64; 0 = one per core) | Read from the process env, not `.env` |
| `CORS_ORIGINS` | no | '' (no browser origin) | HO hosts only, never `*` |
| `LOG_LEVEL` | no | `info` | `/health` not logged |
| `SWAGGER_ENABLED` | no | `false` | `false` unless `/docs` should be public |
| `B2B_API_URL` | **yes** | — | Boot fails without it; no server token (`x-b2b-token` per request) |
| `B2B_MARKETPLACE_CODE` | no | `MKTP-1` | — |
| `CATALOG_CACHE_TTL_SECONDS` | no | 60 | — |
| `VISTAAR_JWT_SECRET` | **yes**, ≥ 32 chars | — | Unique random (`openssl rand -base64 48`) |
| `ACCESS_TOKEN_TTL_SECONDS` | no | 43200 (12 h; 300 s – 7 d) | — |
| `REFRESH_TOKEN_TTL_DAYS` | no | 30 (1–180) | — |
| `OTP_API_URL` | no | `https://utils.ko-tech.in` | DLT template confirmed |
| `OTP_TIMEOUT_MS` | no | 10000 | — |
| `OTP_TEST_NUMBERS` / `OTP_TEST_CODE` | no | '' / — (4–6 digits) | **Empty** in production (boot refuses) |
| `ORDER_EVENTS_SECRET` | no, ≥ 24 chars | — | Unset = hook 503 and leads never become customers |
| `PAYMENTS_ONLINE_ENABLED` | no | `false` | Stays false until real payment is live; `true` needs `PAYMENTS_CREDENTIALS_KEY` |
| `PAYMENTS_CREDENTIALS_KEY` | no, 32 bytes base64 | — | Production-only; unset = 503 `CREDENTIALS_NOT_CONFIGURED`; losing it = resubmit every key |
| `PAYMENTS_CREDENTIALS_KEY_ID` | no | `k1` (`^[a-z0-9-]{1,16}$`) | Lets the key be rotated |
| `PAYMENTS_ALERT_WEBHOOK_URL` | no | — | Finance + tech Slack |
| `SSO_JWKS_URL` | no | `https://sso.ko-tech.in/.well-known/jwks.json` | — |
| `SSO_ISSUER` / `SSO_AUDIENCE` | no | — | — |
| `FIREBASE_PROJECT_ID` / `_CLIENT_EMAIL` / `_PRIVATE_KEY` / `_STORAGE_BUCKET` | no (all four together) | — | Org bucket `micro-dealer.appspot.com`; without them uploads → 503 |

OTP limits are not env vars: 3 SMS and 5 guesses per number per 10 min (sign-in and farmer OTP counted separately), in `vistaar_v2_otp_attempts`. The Razorpay Key ID the app receives and the payment test / live mode are not env vars either: HO enters and approves them in the portal (section 12).

### 27.2 Indexes

`PROD-CHECKLIST.md` holds **85** exact `createIndex` commands (82 on 17 October; new: `vistaar_v2_onboarding_data` `{'id_keys.aadhaar_hash': 1}` and `{'id_keys.pan': 1}`, both partial on `$exists`, not unique — the save refuses a clash; and `vistaar_v2_order_ids` `{order_id: 1}`, for support lookups only). The full list, per collection, is in `docs/VISTAAR-PRD-DATABASE.md` section 11.

`IndexSyncService` builds the schema indexes outside production only. Since 17 October it first asks Mongo which declared indexes are missing (`diffIndexes`) and queues a build only for those, tags each build (`vistaar-index-sync:<collection>`) and kills its own build when it times out, so a restart no longer leaves more builds queued behind a wedged one (the code records 969 queued by 2026-10-16 on the shared beta host). `PROD-CHECKLIST.md` still notes that none of the indexes existed on beta (2026-10-09, host out of disk); the code stays correct without them.

### 27.3 Data steps

1. `seed-onboarding.js --apply` once (or set up in the portal); `--republish` for forms seeded before 2026-10-09.
2. `PUT /admin/settings {default_owner_agent_id}`.
3. Exactly one active USR-1037 Offline Head in `agents_v2`, or `settings.lead_owner_agent_id` (neither → `POST /leads` 503).
4. Role USR-1040 "Vistaar Partner" in `userroles` (`{UserRoleId, role_name, agent_categories: [], __v: 0}`), added by the ko-sales owner (`POST /api/v1/agents/roles` takes max + 1 — check max is USR-1039 first; not on beta yet).
5. `backfill-partner-place.js` (dry run, then `--apply`; only `vistaar_v2_agents`; idempotent; beta done 2026-10-14).
6. `backfill-lead-location.js` (dry run, then `--apply`) for farmer leads.
7. `app_counters` rows `leads`, `contacts`, `addresses`, `draft_orders` must exist (never created by this service).
8. **New:** the order-number row, once, by hand: `db.app_counters.insertOne({ _id: 'vistaar_orders', count: 0, updated_at: new Date() })` (never upserted in code; without it `POST /orders/id` answers 503 `ORDER_ID_UNAVAILABLE`).
9. **New:** after deploy, build the two `id_keys` indexes, then `node dist/scripts/backfill-id-keys.js` (dry run), then `--apply` — fills `id_keys` on forms saved before the Aadhaar / PAN check (the check cannot see them until then). Only `vistaar_v2_onboarding_data`; skips a row saved meanwhile; safe to run again. It prints each Aadhaar / PAN held by more than one partner as agent ids, never the number — hand those groups to HO.
10. After deploy: `POST /admin/earning-cohorts/recompute` once (places partners approved before earning cohorts).
11. `seed-faqs.js --apply` (5 sections, 11 FAQs); `seed-story-content.js --apply` (on production skip the 3 sample events and delete the `diwali_lights` design; HO replaces the 8 sample farmer stories); `seed-info-pages.js --apply` (HO replaces placeholder numbers and links); `seed-terms.js --apply` after Legal signs off.

### 27.4 Go-live gates per feature

| Feature | Gate |
|---|---|
| Farmer leads | Leads indexes (`{pii_id}` unique keeps one farmer, one partner); HO adds farm location to the consent wording (DPDP); lead owner present; sales-operation excludes `source: 'vistaar'` from cohort / profiled routers; ko-sales / sales-operation told about direct inserts and the `follow_up_date` mirror; optional `lead_sources` row `{source_code: 'vistaar', display_name: 'Vistaar Agent'}` |
| Rewards + farmer OTP | **Breaking for the app:** `POST /leads` without `otp_token` → 400 `LEAD_OTP_REQUIRED`; release the app build with this backend. The 2 rewards indexes (no new one for the eight triggers added 2026-10-21); SMS budget for one OTP (up to 3 sends) per farmer; `OTP_TEST_NUMBERS` empty; `rewards.read` / `rewards.review` to heads and admins. Writes only `vistaar_v2_rewards`, `vistaar_v2_leads.otp_verified_at` and `lead-*` OTP rows |
| Earning cohorts | The 4 `vistaar_v2_earning_*` indexes (assignments unique partial first); recompute once after deploy; `earning.read` / `earning.write` to heads and admins; **agree the `ec_default` plan with Finance before saving it** (it moves every approved partner's new orders and every cohort without its own plan); tell HO that gigs posted with an empty payout pay the cohort rate |
| **Profile, bank change, duplicate ID (new)** | The two `id_keys` indexes, then `backfill-id-keys.js` (27.3 step 9). Writes `vistaar_v2_agents` (profile edit, `pending_name`, verification calls, name decisions) and `vistaar_v2_onboarding_data` (`bank_change`, `id_keys`); an approved bank change also copies the proof to `piis.documents.bank_details` (`source: 'vistaar'`; another portal's entry is never replaced). While a bank change waits, no new withdrawal (`409 BANK_CHANGE_PENDING`); the bank file pays the account on the form at that moment |
| Customers | `ORDER_EVENTS_SECRET` set; order service calls the hook `{order_id, pii_id, agent_id, order_date}` |
| Orders | Checkout (not built) writes orders through Katyayani Utils → Stockship with `source: 'MKTP-5'` and the partner's VST- id in `agent`; Stockship keeps `marketplace: 'MKTP-5'` (what this service filters on) and rewrites `source` / `sub_source` from `marketplaces_v2`. Stockship's create-order checks `agent` against `agents_v2`, so it must accept a VST- id on `MKTP-5`; Stockship told `MKTP-5` orders with a VST- `agent` will appear |
| **Order numbers (new)** | `vistaar_v2_order_ids {order_id: 1}`; the `app_counters` `vistaar_orders` row (27.3 step 8); nothing else issues `KSV-` numbers (confirm the old CRM-Backend no longer does — beta's last old `KSV-` order is 2026-05-30; old numbers in `orders_v2` are skipped, new ones from another writer would not be); checkout passes the `KSV-` number to Stockship create-order as `order_id`; ask Stockship for `{order_id: 1}` on `orders_v2` (27.5) |
| Commission / wallet | Withdrawals indexes first (the unique partial `open: true` stops two open withdrawals across processes); Finance signs off rates and HO saves plans `draft: false`; settings checked (7 / 500 / 2 / 20 / 1,00,000); Finance role added to `payouts.manage` / `commission.read`; bank template vs generic CSV; commission exists only for orders with `marketplace: 'MKTP-5'` and the partner's VST- id in `agent`; every form keeps PAN (`org_document: pan`), bank proof (`org_document: bank_details`) and `maps_to: details.bank_account` |
| Draft orders | `app_counters._id: 'draft_orders'` exists; B2B / Sankalp told about `entry_path: 'vistaar'`, `reminder_sent`, the shared DFT-n series |
| Cart | Auth guard live (done); B2B told about `source: 'vistaar'` rows |
| Attendance | `{date: 1}` index (HO board and range views filter on `date`); app build with geolocator GPS; product decides auto-close / absent days / regularisation |
| Banners / My Story / testimonials | `FIREBASE_*`; their indexes (11 story / event + 4 FAQ; 10 testimonials); app builds. Testimonials web build only: bucket CORS PUT with `Content-Type` + `x-goog-content-length-range`; HO reviews testimonial consent wording |
| Terms / info pages | No index; seeds; Stockship / RLM owners told; app builds |
| Feedback | Eight indexes; roles; product agrees the detractor promise (2 working days, Mon–Sat IST) |
| Payment options | 2 audit + 3 credentials indexes; `PAYMENTS_CREDENTIALS_KEY`; Slack URL; ≥ two active company admins; `PAYMENTS_ONLINE_ENABLED` false until gateway order / signature verify / webhook are live. Razorpay takes the Key ID only and Cashfree no keys at all (KO Utils holds them; Cashfree is on/off only) |
| **KKD & App activity (new)** | Nothing to build and nothing written (reads only); `orders_v2` rides Stockship's existing `{pii_id: 1, date: -1}`; app build on `/kkd-activity` shipped with the `soil_test` chip hidden and **no mock seed** left in the server build (`KKD-ACTIVITY-APP.md` lists every screen to move to the API); at scale, the other teams' indexes in 27.5 |

### 27.5 Owed by other teams

- **Utils:** SMS template / DLT (now also for farmer OTP traffic). **Infra:** Firebase service account.
- **Stockship (testimonials):** add `'vistaar'` to `REVIEW_SOURCES`; recompute `bulk_v2` / `combos_v2` average ratings over verified rows only; our approvals don't trigger their `syncRating`; build `{source, verified, deleted, created_at}` and `{bulk, verified, deleted}` on both collections.
- **Stockship (orders):** accept a VST- `agent` on `MKTP-5` in create-order; `{order_id: 1}` on `orders_v2` (unique if the data allows) — without it each process's one boot read of the old `KSV-` numbers is a full scan (~3 s on beta's 534k orders), and so is Stockship's own duplicate check on every create-order.
- **Stockship (orders, at scale):** `{agent: 1, date: -1}` on `orders_v2`; the `{marketplace, order_status, date}` index the HO order screens rely on already exists on the production main DB (`marketplace_1_order_status_1_date_-1`, read-only check 21 October 2026; `ORDERS-HO.md` still says `{source, order_status, date}`).
- **Franchise backend (KKD activity, at scale):** `{pii_id: 1}` and `{phone: 1}` on `franchise_v2_walkins`, `franchise_v2_prescriptions`, `franchise_v2_pos_orders` (no such index; 48 / 11 / 507 rows on 2026-10-21 — a scan is fine today). **Katyayani app:** `{user_id: 1, event_name: 1, created_at: -1}` on `kkd_events` (only `_id`; 43 test rows) before its event volume goes live.
- **B2B (at scale):** `{entry_path, status, updated_at: -1}` on `draft_orders`. `carts` needs nothing (shard `{_id: 'hashed'}` if ever sharded).

---

## 28. Performance and capacity

Measured 2026-10-13 / 15 on a 12-core laptop, production build, beta Mongo ~28 ms away, autocannon on the same machine — numbers are a floor. `PERFORMANCE.md` is unchanged since 17 October; nothing merged since (KKD activity, order numbers, profile / bank change, order search) has been load-tested.

| Route | Req/s (1 process, 50 conn) | p50 |
|---|---|---|
| `/faqs` (cached, 0 DB) | ~1,700 | 27 ms |
| `/banners` (0 DB) | ~1,630 | 28 ms |
| `/attendance/today` | ~880 | 54 ms |
| `/events` | ~840 | 56 ms |
| `/stories` | ~780 | 60 ms |
| `/stories/content` | ~560 | 82 ms |
| `/orders` | ~520 | 92 ms |
| `/performance/standing` (5-min cache) | ~2,500 | 18 ms |
| `/commission/summary` (warm) | ~2,160 | 21 ms |
| `/commission/ledger` | ~1,850 | 25 ms |
| `/wallet` (withdrawals read fresh) | ~700 | 68 ms |
| `/performance?period=3m` | ~640 | 76 ms |

4-worker cluster, 200 connections: `/faqs` ~6,200 req/s; `/attendance/today` ~2,070; `/events` ~1,730; `/stories/content` ~1,140. Cached routes scale with cores; DB-bound ones roughly double, then are held by Mongo RTT. A cold commission book is ~190 ms.

Capacity model: ~1 request / 10 s per active user → one process (~800 req/s mixed) ≈ 8,000 simultaneous users; one 4-core VM ≈ 25,000–35,000. 20M registered at 1–2 % peak online → 200K–400K at once → 20K–40K req/s → ~25–50 processes (~7–12 four-core machines) and Mongo sized for ~20K queries/s.

Optimisations added by the beta performance audit (rows 17–24 of `PERFORMANCE.md`): 60 s list caches moved to a single-flight `TtlCache` (no stale overwrite of an HO edit); HO story summary uses `$facet` (avoids the 16 MB limit); save and share counted in one `$inc`, old files deleted in parallel; `_id` tie-break indexes on meetings, gigs and testimonials; `{stage, created_at}` on leads and attendance `{date}` listed; customer detail reads only that farmer's orders; independent reads run in parallel (wallet, onboarding save, refresh, cart); approve / reject / pay answer from the row just written.

Optimisations in place before that: one short log line per request; cluster entry; signed URL reuse (LRU 50K); cohort cache (LRU 100K); shared `/stories/content` build every 15 s; OTP counts in Mongo (verified: 10 concurrent guesses → exactly 5 allowed); public reads 600 / min / IP; signed upload receipts (skip bucket checks); `/orders` counts only on a full page; pool sizes by env; commission book as one projected aggregation cached 60 s; catalogue facts in memory hourly; plans / settings 60 s, standing 5 min; order lines named from catalogue memory; withdrawals cached for display, fresh before money; HO carts read only the page's partners; batch UTR updates in one round trip.

Built into the code merged since 17 October (from the code, not measured):
- **KKD activity:** one merged feed per partner, built from all sources read in parallel (`Promise.allSettled` — one source down only drops its rows), each source capped at 2,000 rows from the earliest hold, then filtered and paged in memory; cached 60 s per partner (up to 2,000 partners per process); the store list (stores, warehouses, POS logins) cached 60 s for everyone. Its own orders read rides `orders_v2` `{pii_id, date}`.
- **Order numbers:** the old `KSV-` numbers are read once per process at boot (a full `orders_v2` scan — ~3 s on beta's 534k orders; an order number asked for in those first seconds waits for it), so no number waits on an `orders_v2` lookup afterwards; one number per attempt rests on `_id`, with no other index needed; at most 100 taken numbers are skipped per call.
- **Order search** (`GET /orders?q=`): one extra condition next to `agent` — exact `order_id`, a phone-end regex, or a case-insensitive regex per name word — so it stays inside one partner's own orders.
- **IndexSyncService** (outside production): queues only missing indexes and kills its own timed-out builds (27.2), so restarts on a wedged host no longer pile up builds.

Ops still to do: same-region deploy; build the production indexes (incl. the `otp_attempts` TTL); Stockship `{agent, date}` and `{order_id}` on `orders_v2`; re-run the load test on staging with production-like data. Watch list: unfiltered `/admin/draft-orders` sorts in memory; testimonial HO lists scan Stockship collections (only `_id` indexed); HO search boxes are unanchored regex (prefix / text index past ~100K rows); `/admin/performance/board` cold sweep (nightly snapshot if it passes ~30 s); feedback daily cap is check-then-insert; KKD activity's franchise collections have no `pii_id` / `phone` index and `kkd_events` only `_id` (fine at today's tens to hundreds of rows — 27.5); the boot scan of `orders_v2` for old `KSV-` numbers until Stockship indexes `order_id`.

To re-run: build, `NODE_ENV=production` on `PORT=3100`, mint partner tokens with `VISTAAR_JWT_SECRET` (claims in section 2.2), autocannon 12 s at 50 and 200 connections per route.

---

## 29. Test data (beta)

- Beta-only records; test farmer mobiles `60000xxxxx`. Beta's Offline Head is `A0-2691`; no settings owner override. Without an Offline Head, seeding and app add-lead stop with `LEADS_NOT_CONFIGURED`.
- Partners: **VST-000006** (other_company_employee; main test partner — every stage, takeover, transfer target) and **VST-000007** (vistaar_agent; "the other partner"). Both real OTP login.
- `seed-test-leads.js [--apply]`: 15 farmers 6000000101–115 covering stages, follow-ups (due / overdue / future), `FARMER_TAKEN`, released-after-16-days takeover, HO transfer, "releases in 2 days", Today's-tasks cases. Dates are relative to the seed day.
- Customers are never seeded (`orders_v2` is Stockship's): place a real order, then call the hook by hand with beta `ORDER_EVENTS_SECRET`.
- Radar: `GET /radar?lat=23.2599&lng=77.4126&km=50` as VST-000006 (Bhopal).
- `seed-test-meetings-gigs.js [--apply|--remove]` (2026-10-15): 5 meetings (tomorrow with invites, today urgent, completed with walk-ins, cancelled, next week empty) + 5 gigs `GIG-900001–5` (open, HO edit/assign/delete, accepted tomorrow, checked-in, submitted with a `far` flag). Writes only `vistaar_v2_meetings` + `vistaar_v2_gigs`; gig pay is off so approval doesn't touch the wallet.
- **`seed-test-kkd-activity.js [--apply|--remove]` (new, applied on beta 2026-10-21):** KKD activity owns no collection, so — on the user's decision, unlike every other seed — it writes into **other apps' collections**: `franchise_v2_walkins`, `franchise_v2_prescriptions`, `franchise_v2_pos_orders` (franchise backend), `orders_v2` (Stockship) and `kkd_events` (Katyayani app). Every row has a fixed `TEST-KKD-…` id (fixed `6b6b64…` ObjectIds in `orders_v2` / `kkd_events`), `source: 'test'` and `test_seed: 'seed-test-kkd-activity'`; its Stockship orders are only `delivered` / `cancelled` with "TEST DATA" in `notes`. Dates are 0–6 days back from the run (after the farmers' hold began 2026-10-13/14) — re-run to move them. `GET /kkd-activity` as VST-000006 then shows 12 rows; tiles: walk-ins 3, store orders 1 · ₹1,240, app orders 2 · ₹2,230, open app carts 2 · ₹3,749. Cases: Ramesh Patel (101) walk-in at Raisen (FR-100) with nothing bought + an open app cart ₹2,450; Suresh Yadav (102) walk-in + POS store order ₹1,240 the same day, and an app cart ₹899 then an app order ₹1,450 (MKTP-3) — cart **not** open; Mahesh Kushwaha (103) crop advice at Bhopal (FS-1), a website order ₹780 (MKTP-2) and an app open today; Kamla Bai (105, lost lead) walk-in — lost leads still count; Rajendra Singh (106) two app opens yesterday (one `app_open` per IST day) + an app cart ₹1,299 today; Vikram Chouhan (113) a `rejected` walk-in and a `cancelled` app order — **never shown**. `--apply` replaces only tagged rows; `--remove` deletes every row with the tag from the five collections — run it before anyone reads beta's franchise / Stockship reports for real numbers.
- `seed-banners.js [--apply|--remove]`: 5 test banners (`created_by: 'seed:test-banners'`), beta / local only. `seed-terms.js` on beta made TOC-6 active (TOC-4 / 5 off).
- `seed-test-payment-keys.js [--apply]`: dummy **test** merchant keys for each payment option that has none — Razorpay a Key ID only, PhonePe client id / version / secret; Cashfree none (keyless). Sealed with the machine's `PAYMENTS_CREDENTIALS_KEY`, submitted and approved by two seed identities, gateway check skipped; refused in production; real test keys entered in the portal replace them on approval.
- Farmer OTP: the seed signs the `POST /leads/otp/verify` token with the server's secret, so no SMS is sent. Adding in the app needs the mobiles in `OTP_TEST_NUMBERS` + `OTP_TEST_CODE`. With earning rules set, seeded adds record pending `lead_created` rewards.
- Nothing auto-deletes; remove by mobile — beta only.

---

## 30. Not built yet, and doc discrepancies

### 30.1 Not built

- **Not on beta yet: lead owner = approving Offline Head (branch `feat/lead-owner`).** On beta a new farmer lead is still owned by the one active Offline Head (USR-1037) unless `settings.lead_owner_agent_id` names another (section 25).
- Checkout / order placement from the cart: this service reads orders and hands out `KSV-` numbers (`POST /orders/id`), but the order itself (through Katyayani Utils → Stockship) is not built; nor are the gateway order / verify / webhook for online payment (KO Utils creates Razorpay / Cashfree orders for the app; the payment webhook that would issue a prepaid order's number is not built).
- Gig pay into the wallet — meeting gigs and approved gig (₹) rewards (built, switched off until Finance confirms TDS).
- Coins: no redeem or spend; never money or wallet. HO can't create a reward by hand; an archived earning cohort can't be restored; a rule's trigger or cohort can't change; a new trigger needs code (the catalog now has 10: `lead_created`, `follow_up_done`, `lead_stage_advanced`, `reorder`, `meeting_attendee_captured`, `gig_approved`, `event_registered`, `attendance_streak`, `onboarding_approved`, `story_created`).
- Per-cohort commission does nothing until HO saves an `ec_default` plan (everyone stays on partner-type plans).
- WhatsApp sending (meetings use a no-op notifier) and push notifications (commission, gigs).
- Attendance auto-close of forgotten punch-outs, absent days, regularisation; farm-visit counts.
- Radar "new farmers" layer (TL decision); training courses (health factor counts as good meanwhile; the profile timeline's `active` step will also need Product Knowledge L1 once that exists); "farmer left an app cart" Today task (`GET /today` has no KKD cart task).
- KKD & App activity: `soil_test` has no source anywhere and is never returned; store services and opening hours are not on record; no commission is paid on any KKD / app activity (follow-up only, TL).
- Profile / KYC: no HO list of waiting name changes or bank account changes (open the partner).
- My Performance PDF export; support tickets from Contact Us; coins for testimonials; partial-return commission (a return reverses the whole order inside the window).

### 30.2 Doc discrepancies to resolve

- **Bank change and the profile copy (new):** `ONBOARDING-HO.md` §3 and `ONBOARDING-APP.md` §6 say an approved bank change does **not** update `profile.details.bank_account`; beta's code does — `BankChangeService.approve` calls `AgentsService.setProfileBankAccount`, which `$set`s `profile.details.bank_account` to the new holder / number / IFSC whenever the profile has `details`. Payouts and the bank file read the form either way, so `GET /wallet` `bank` stays the account to show; the docs are stale.
- **Vistaar orders filter (new):** code reads Vistaar's orders by `marketplace: 'MKTP-5'` (`orders.domain.ts` `VISTAAR_MARKETPLACE`; orders, HO orders, customers, commission), and `ORDERS-APP.md`, `ORDERS-HO.md`, `ORDER-EVENTS.md`, `COMMISSION-LOGIC.md` and `PROD-CHECKLIST.md` say so; still saying `source` are `CLAUDE.md` (*Shared records*: "the partner's orders: `source: 'vistaar'`"), `DATABASE.md`'s commission row ("one aggregation on `{ agent, source }`" — its orders row says `MKTP-5`) and the `orders.read` comment in `access.domain.ts` ("source vistaar").
- **HO orders index (new wording):** `order.repository.ts` says the HO order screens ride Stockship's `{marketplace, order_status, date}`; `ORDERS-HO.md` still says `{source, order_status, date}`; `PROD-CHECKLIST.md` names neither (only `{agent, order_status, date}` and `{pii_id, date}`). The production main DB has `marketplace_1_order_status_1_date_-1` (and `agent_1_order_status_1_date_-1`), read-only check 21 October 2026 — so the code's wording is right and `ORDERS-HO.md` is out of date.
- **Public read rate limit:** `ONBOARDING-APP.md` says 60 calls / min per network; beta's code is 600 / min per IP (`onboarding.controller.ts:49`, `info-pages/controllers/public-read.ts:5`), matching `PERFORMANCE.md` 6b. The doc is stale.
- **Gig venue coordinates (resolved in code):** `GIGS-APP.md` lists `venue_point` in the gig shape "for directions" but also says the venue's coordinates are not sent; the code sends `venue_point` on every gig view (`gigs.service.ts` `viewOf`). The "not sent" line is stale.
- **Story / event index count:** `PROD-CHECKLIST.md`'s My Story gate says "nine" story / event indexes; its own list and the code have 11.
- **Database:** the differences between beta's code and `DATABASE.md` / `PROD-CHECKLIST.md` / `CLAUDE.md` are listed in `docs/VISTAAR-PRD-DATABASE.md` section 10. Re-checked on `5113b6c`, the ones that affect production still stand: the HO orders index above; `app_counters.piis` is still taken with `upsert: true` (`pii.repository.ts`), unlike every other counter (the new `vistaar_orders` row included — never upserted); a credential set in the short-lived status `approved` still keeps its sealed secrets (approval does not touch them; only retiring a set clears them), so a set stuck there holds secrets and blocks the provider until approved again or rejected; commission's `orders_v2` filter still compares the raw `order_status` exactly (`$nin` of the not-counted set) while `isCounted()` trims and lower-cases.
- **Gig pay "final":** `COMMISSION-LOGIC` says approved gig pay is final with no reversal, while `GIGS-HO` warns that switching `gig_pay_enabled` off again pulls gig pay back out of the wallet. Both hold (approval is final; the switch controls whether gigs count at all) — keep the switch on once on.

---

## 31. Function reference

Every function in `src/` except tests: **2,101 functions in 296 files**. The list was generated from the TypeScript source with the compiler, so none is missing; each purpose line was written by reading that function's body. No code is copied here.

How to read it:
- **Function** — `Class.method` for class members, the bare name for top-level functions.
- **Line** — where it starts in that file, as of latest `beta` (`5113b6c`) on 22 October 2026. Lines shift as code changes; search by name if one has moved.
- **Route / guard** — for controller methods: HTTP verb and path (without the global prefix `/api/v2`), plus `@Public` or the `@Can(...)` capability.
- **Kind** — `async`, `private`, `static`, `get` for class members; `export` or `local` for top-level functions.
- Files with no functions (schemas, DTOs, module wiring) are left out; schemas are in `docs/VISTAAR-PRD-DATABASE.md`.
- Grouped as the code is: shared layers first (`common`, `config`, `core`, `database`, `main.ts`), then one block per module; `scripts` sits after `commission`, and `earning` + `rewards` come last.

### common

#### `src/common/decorators/admin-api.decorator.ts`

File role: Common decorator: marks a route as an HO admin API so the auth guard checks the SSO token.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `AdminApi` | 10 |  | export | Sets isAdminApi metadata so AppAuthGuard requires an SSO token. |

#### `src/common/decorators/public.decorator.ts`

File role: Common decorator: marks a route as public so the global auth guard skips it.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `Public` | 12 |  | export | Sets isPublic metadata so AppAuthGuard lets the route through without a token. |

#### `src/common/dto/page-query.dto.ts`

File role: Common DTO: shared page / limit / sort query params with clamping and Mongo skip/sort helpers.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `PageQueryDto.skip` | 59 |  | get | Returns (page - 1) * limit for Mongo skip. |
| `PageQueryDto.sortSpec` | 63 |  | get | Turns sort string (field or -field) into a Mongo sort object. |
| `WithPaging` | 99 |  | export | Copies the skip and sortSpec getters onto another DTO class. |
| `boundedInt` | 114 |  | local | Parses a value to an integer clamped to min..max, or returns the fallback. |

#### `src/common/errors/api-error.ts`

File role: Common error helpers: build HttpExceptions with an API_ERROR_CODES code for AllExceptionsFilter

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `apiError` | 217 |  | export | Builds an HttpException with status, error code, message and optional details |
| `badRequest` | 229 |  | export | Shortcut for a 400 apiError with the given code |
| `forbidden` | 235 |  | export | Shortcut for a 403 apiError with the given code |
| `notFound` | 241 |  | export | Shortcut for a 404 apiError with code NOT_FOUND |
| `unauthorized` | 244 |  | export | Shortcut for a 401 apiError with the given code |
| `tooMany` | 250 |  | export | Shortcut for a 429 apiError with the given code |
| `unavailable` | 257 |  | export | Shortcut for a 503 apiError with the given code |
| `conflict` | 264 |  | export | Shortcut for a 409 apiError with the given code |
| `serviceUnavailable` | 270 |  | export | Shortcut for a 503 apiError with the given code (same as unavailable) |

#### `src/common/errors/validation.factory.ts`

File role: Common errors: turns class-validator errors into one VALIDATION_FAILED error with plain-English details.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `validationExceptionFactory` | 22 |  | export | Returns VALIDATION_FAILED 400 with flattened per-field sentences as details. |
| `flatten` | 32 |  | local | Walks nested ValidationErrors and turns each constraint into a sentence with its field path. |
| `sentence` | 49 |  | local | Rewrites one class-validator message into a plain-English sentence per rule. |
| `label` | 127 |  | export | Turns a field path into a readable label, with row number and language notes. |

#### `src/common/utils/geo.util.ts`

File role: Common util: GPS helpers (India bounds check, GeoJSON point, haversine distance).

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `isIndiaFix` | 13 |  | export | True when lat/lng are finite and inside India's bounding box. |
| `toPoint` | 24 |  | export | Builds a GeoJSON Point with [lng, lat]. |
| `haversineKm` | 31 |  | export | Great-circle distance in km between two lat/lng points. |
| `kmToRadians` | 47 |  | export | Converts km to radians of Earth radius (for $centerSphere). |

#### `src/common/utils/image-size.util.ts`

File role: Common util: reads image type and pixel size from PNG, JPEG and WEBP headers.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `imageInfo` | 12 |  | export | Returns mime, width, height for a PNG, JPEG or WEBP buffer, else null. |
| `png` | 16 |  | local | Reads width/height from a PNG IHDR header, or null. |
| `jpeg` | 24 |  | local | Scans JPEG markers for a SOF segment and reads its size, or null. |
| `webp` | 54 |  | local | Reads size from WEBP VP8, VP8L or VP8X chunk, or null. |
| `sized` | 88 |  | local | Returns the ImageInfo only when width and height are positive. |

#### `src/common/utils/ist-day.util.ts`

File role: Common util: IST day, month and financial-year date arithmetic.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `istDayStart` | 7 |  | export | Returns the instant of midnight IST for the given date. |
| `istDaysBetween` | 14 |  | export | Number of IST calendar days between two dates. |
| `istMonthKey` | 21 |  | export | Returns the IST YYYY-MM month key of a date. |
| `istMonthStart` | 26 |  | export | Returns the instant a YYYY-MM month starts in IST. |
| `addMonths` | 32 |  | export | Adds n months to a YYYY-MM key. |
| `fyStart` | 39 |  | export | Returns the YYYY-04 start month of the financial year for a month key. |
| `istDayRange` | 48 |  | export | Turns optional from/to YYYY-MM-DD into IST start and exclusive end dates. |

#### `src/common/utils/keyed-serial-queue.ts`

File role: Common util: in-process queue that runs tasks one at a time per key.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `KeyedSerialQueue.run` | 13 |  |  | Chains a task after earlier tasks of the same key; drops the key when drained. |
| `KeyedSerialQueue.size` | 32 |  | get | Number of keys with pending tasks. |

#### `src/common/utils/phone.util.ts`

File role: Common util: normalises Indian mobile numbers to 10 digits.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `normalizeMobile` | 9 |  | export | Strips non-digits and a 0/91/091 prefix; returns a 10-digit 6-9 mobile or null. |

#### `src/common/utils/regex.util.ts`

File role: Common util: escapes text for safe use inside a RegExp.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `escapeRegex` | 2 |  | export | Escapes RegExp special characters in a string. |

#### `src/common/utils/ttl-cache.ts`

File role: Common util: small in-memory promise cache with TTL and max size.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `TtlCache.get` | 21 |  |  | Returns a fresh cached promise or runs load, caches it, drops failures and evicts oldest past max. |
| `TtlCache.peek` | 40 |  |  | Returns a fresh cached promise without loading. |
| `TtlCache.delete` | 46 |  |  | Removes one key. |
| `TtlCache.size` | 50 |  | get | Number of cached entries. |

#### `src/common/utils/zip.util.ts`

File role: Common util: minimal zip writer and single-entry reader (used for .docx).

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `writeZip` | 20 |  | export | Builds a deflated zip buffer from name/data entries. |
| `readZipEntry` | 69 |  | export | Reads one named entry (max 5 MB) from a zip buffer, or null on any problem. |

### config

#### `src/config/env.schema.ts`

File role: Config: zod schema for every env var, validation at boot, CORS and cluster-size helpers.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `validateEnv` | 178 |  | export | Parses env with refinements; throws listing every invalid variable. |
| `parseCorsOrigins` | 192 |  | export | Splits comma-separated CORS_ORIGINS into trimmed non-empty origins. |
| `resolveCorsOrigin` | 209 |  | export | Returns true for *, the origin list, or false when empty. |
| `clusterWorkerCount` | 222 |  | export | Uses WEB_CONCURRENCY when positive, else CPU count (min 1). |

### core

#### `src/core/auth/app-auth.guard.ts`

File role: Core global guard: authenticates every non-public route with a partner token or, for admin routes, an SSO token.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `AppAuthGuard.canActivate` | 30 |  | async | Skips @Public routes; needs a bearer token; admin routes verify SSO, others the partner token; sets request.user. |
| `bearer` | 72 |  | local | Extracts the token from a Bearer Authorization header, or null. |

#### `src/core/auth/partner-token.service.ts`

File role: Core auth: signs and verifies the partner HS256 access token.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `PartnerTokenService.sign` | 35 |  |  | Signs an HS256 access JWT with sub, agent_id, pii_id and the configured TTL. |
| `PartnerTokenService.verify` | 51 |  |  | Verifies the partner JWT and claim shape; returns the partner principal or null. |

#### `src/core/auth/sso-token.verifier.ts`

File role: Core auth: verifies the company SSO RS256 token against its JWKS.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `SsoTokenVerifier.verify` | 43 |  | async | Verifies an RS256 SSO token by JWKS kid; returns admin principal with email, or null; throws SsoUnavailableError if JWKS is down. |

#### `src/core/filters/all-exceptions.filter.ts`

File role: Core global filter: maps every thrown error to the error envelope with a code and plain message.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `AllExceptionsFilter.catch` | 40 |  |  | Describes the error, logs 5xx, and sends the failure envelope with requestId and x-request-id header. |
| `describe` | 75 |  | local | Maps HttpException, Fastify, Mongo and Mongoose errors to status, code, message, details. |
| `isDatabaseUnreachable` | 199 |  | local | True for Mongo auth/access codes or connection, selection and topology errors. |
| `isFastifyClientError` | 219 |  | local | True for a 4xx error whose code starts with FST_. |
| `plain` | 272 |  | local | Swaps known framework messages for user-friendly wording. |
| `codeFor` | 279 |  | local | Derives an error code from the HTTP status name. |
| `v2Code` | 305 |  | local | Maps BAD_REQUEST and UNPROCESSABLE_ENTITY to VALIDATION_FAILED. |
| `slug` | 309 |  | local | Upper-snake-cases a string. |

#### `src/core/http/cors-options.ts`

File role: Core HTTP: builds the CORS options for the app.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `corsOptions` | 27 |  | export | Returns CORS options with the origin, credentials on and allowed methods. |

#### `src/core/http/empty-json-body.ts`

File role: Core HTTP: Fastify JSON parser that accepts an empty body as {}.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `allowEmptyJsonBody` | 22 |  | export | Replaces the JSON parser so an empty application/json body parses as {}. |

#### `src/core/http/json-etag.ts`

File role: Core HTTP: Fastify hook adding ETag and 304 handling to GET JSON responses under /api/v2.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `registerJsonEtag` | 29 |  | export | Adds an onSend hook that sets a SHA-1 ETag and answers 304 on If-None-Match. |
| `isTaggable` | 57 |  | local | True for 200 GET JSON responses under /api/v2 without an ETag. |
| `matches` | 81 |  | local | True when If-None-Match is * or lists the ETag (weak prefix ignored). |

#### `src/core/interceptors/envelope.interceptor.ts`

File role: Core global interceptor: wraps every successful response as success + data.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `EnvelopeInterceptor.intercept` | 30 |  |  | Maps the handler result to success true plus data. |

#### `src/core/throttle/throttle.config.ts`

File role: Core throttling: rate-limit config keyed by verified user or IP.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `throttleTracker` | 14 |  | export | Throttle key: user:<sub or email> when verified, else ip:<ip>. |
| `verifiedSubject` | 25 |  | local | Returns user sub or email from request.user, or null. |

### database

#### `src/database/index-sync.service.ts`

File role: Database: builds indexes for vistaar_v2_* models at boot outside production.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `IndexSyncService.onApplicationBootstrap` | 64 |  | async | Outside production, builds only missing indexes on every vistaar_v2_* model concurrently, each under a deadline; logs failures and cancels the stuck build. |
| `IndexSyncService.killBuild` | 117 |  | private async | Best-effort kills our own timed-out index build by its comment tag, so the next restart does not queue behind it. |
| `IndexSyncService.withTimeout` | 140 |  | private async | Races an index diff or build against a 15 s deadline without leaving an unhandled rejection or holding boot open. |

### main.ts

#### `src/main.ts`

File role: Entry point: bootstraps Fastify Nest app with plugins, CORS, /api/v2, validation and Swagger.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `bootstrap` | 28 |  | local | Creates the Fastify app, registers helmet, ETag, compress, multipart, CORS, /api/v2, ValidationPipe, Swagger, then listens. |

### modules/access

#### `src/modules/access/access.domain.ts`

File role: Domain: HO roles, capability map and role-code rules for admin access checks

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `can` | 112 |  | export | True if the role holds the capability; admin also gets every head capability |
| `capabilitiesOf` | 117 |  | export | Lists every capability the role holds |
| `capabilitiesFor` | 131 |  | export | Capabilities of the role minus ones withheld from this email (payments.credentials) |
| `roleOf` | 137 |  | export | Maps an active staff user_role code to admin or head, else null |

#### `src/modules/access/controllers/admin-me.controller.ts`

File role: Access controller: HO caller's own role and capabilities.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `AdminMeController.me` | 15 | `GET /admin/me` · `@Can()` |  | Returns the caller's AdminAccess; delegates to AccessService.accessFor. |

#### `src/modules/access/guards/capability.guard.ts`

File role: Access guard + @Can decorator: checks the HO caller has a Vistaar role and the route capability.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `CapabilityGuard.canActivate` | 35 |  | async | Admin only; throws NO_ADMIN_ACCESS without a role, ROLE_NOT_ALLOWED without the capability. |
| `Can` | 68 |  | export | Decorator bundle: AdminApi, Swagger auth, optional required capability, CapabilityGuard. |

#### `src/modules/access/repositories/staff-account.repository.ts`

File role: Repository: read-only lookups of HO staff on shared agents_v2

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `toRecord` | 27 |  | local | Maps a raw agents_v2 doc to a StaffRecord (ref, email, agent_id, name, user_role, is_active, phone). |
| `StaffAccountRepository.findByEmail` | 48 |  | async | Finds one agents_v2 staff row by email, or null |
| `StaffAccountRepository.findActiveByRole` | 58 |  | async | Lists up to limit active agents_v2 staff with the given user_role |
| `StaffAccountRepository.findByAgentIds` | 68 |  | async | Lists agents_v2 staff whose agent_id is in the given ids; empty input returns [] |

#### `src/modules/access/services/access.service.ts`

File role: Access service: resolves HO caller access (cached per token) and staff lookups.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `AccessService.accessFor` | 43 |  |  | Returns the caller's access, cached per email and token iat until token expiry. |
| `AccessService.offlineHead` | 62 |  | async | Returns the one active USR-1037 Offline Head, or null if none or more than one. |
| `AccessService.staffByIds` | 68 |  | async | Returns staff records keyed by agent_id. |
| `AccessService.read` | 75 |  | private async | Loads the staff account and builds role, role_code and capabilities. |
| `AccessService.sweep` | 88 |  | private | Drops expired cache entries; clears all if still full. |

### modules/catalog

#### `src/modules/catalog/catalog.domain.ts`

File role: Catalog domain: pure mapping of B2B marketplace items to sellable variants.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `variantsFromMarketplaceItem` | 36 |  | export | Maps a B2B item to priced variants with label, pack weight, price, MRP, GST, stock. |
| `packWeight` | 95 |  | local | Converts grams/ml totals to kg/l, otherwise keeps the unit. |
| `round3` | 107 |  | local | Rounds to 3 decimals. |
| `money` | 112 |  | export | Rounds to 2 decimals. |
| `isRecord` | 116 |  | local | True for a non-array object. |
| `str` | 120 |  | local | Trimmed string or empty. |
| `num` | 124 |  | local | Finite number or 0. |

#### `src/modules/catalog/providers/b2b-catalog.client.ts`

File role: Catalog provider: HTTP client for the B2B marketplace products API with paging and retry.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `isTransient` | 37 |  | local | True for timeouts, aborts, network TypeErrors and 5xx errors. |
| `sleep` | 45 |  | local | Promise that resolves after ms. |
| `B2bCatalogClient.fetchAll` | 68 |  | async | Fetches page 1 then all remaining pages in parallel; returns every variant. |
| `B2bCatalogClient.pageWithRetry` | 83 |  | private async | Fetches a page, retrying once after 300 ms on a transient error. |
| `B2bCatalogClient.page` | 97 |  | private async | GETs one marketplace products page with the bearer token; 401 throws B2bUnauthorizedError. |

#### `src/modules/catalog/services/catalog.service.ts`

File role: Catalog service: in-memory, stale-while-revalidate catalogue snapshot keyed by SKU.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `CatalogService.variants` | 61 |  | async | Returns catalogue variants for the given SKUs from the snapshot. |
| `CatalogService.variant` | 77 |  | async | Returns one variant by SKU, or null. |
| `CatalogService.current` | 82 |  | private async | Fresh snapshot, or stale (under 15 min) with background refresh; else refresh; errors become 401 or CATALOG_UNAVAILABLE. |
| `CatalogService.refresh` | 110 |  | private | Single in-flight B2B fetch that replaces the snapshot. |

### modules/counters

#### `src/modules/counters/repositories/counter.repository.ts`

File role: Counters repository: atomic sequence increments on vistaar_v2_counters.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `CounterRepository.next` | 14 |  | async | Atomic upsert $inc of seq on vistaar_v2_counters; returns the new number. |

#### `src/modules/counters/services/counters.service.ts`

File role: Counters service: formats VST-, WD-, GIG- ids and suggestion numbers from counters.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `formatAgentId` | 11 |  | export | Formats n as VST- plus 6 digits. |
| `CountersService.nextAgentId` | 18 |  | async | Next VST- partner id. |
| `CountersService.nextSuggestionNumber` | 23 |  |  | Next product_suggestion counter number. |
| `CountersService.nextWithdrawalId` | 28 |  | async | Next WD- withdrawal id. |
| `CountersService.nextGigId` | 34 |  | async | Next GIG- gig id. |

### modules/health

#### `src/modules/health/controllers/health.controller.ts`

File role: Health controller: public liveness and readiness probes.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `HealthController.live` | 13 | `GET /health` · `@Public` |  | Returns status ok and process uptime. |
| `HealthController.ready` | 20 | `GET /health/ready` · `@Public` | async | Throws 503 unless Mongo is connected; pings and returns ready. |

### modules/settings

#### `src/modules/settings/controllers/admin-settings.controller.ts`

File role: Settings controller: HO read and update of Vistaar settings.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `AdminSettingsController.get` | 17 | `GET /admin/settings` · `@Can(agents.read)` |  | Returns settings; delegates to SettingsService.get. |
| `AdminSettingsController.update` | 24 | `PUT /admin/settings` · `@Can(settings.write)` |  | Updates settings as the HO email; delegates to SettingsService.update. |

#### `src/modules/settings/dto/settings.dto.ts`

File role: Settings DTO: validated fields HO may change in settings.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `blankToNull` | 32 |  | local | Turns a blank string into null for clearable owner ids. |

#### `src/modules/settings/repositories/settings.repository.ts`

File role: Settings repository: single settings row on vistaar_v2_settings.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `SettingsRepository.read` | 45 |  | async | Reads the single settings row on vistaar_v2_settings. |
| `SettingsRepository.write` | 53 |  | async | Upserts $set fields on the settings row in vistaar_v2_settings; returns it. |

#### `src/modules/settings/services/settings.service.ts`

File role: Settings service: defaults, 60 s cache, owner checks and versioned consent wording.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `SettingsService.get` | 67 |  | async | Returns stored settings over defaults, cached 60 s. |
| `SettingsService.update` | 82 |  | async | Checks owner ids are active staff (OWNER_NOT_FOUND), versions changed consent text, stamps gig_pay_enabled_at, saves. |
| `SettingsService.setFeedbackReasons` | 116 |  | async | Saves feedback_reasons and clears the cache. |
| `nextConsent` | 130 |  | local | Returns the next consent version when the wording changed, else null. |

### modules/spine

#### `src/modules/spine/repositories/address.repository.ts`

File role: Spine repository: Vistaar-sourced rows on shared addresses.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `AddressRepository.ownRow` | 31 |  |  | Finds the addresses row for a pii_id and source. |
| `AddressRepository.setGeo` | 40 |  | async | Sets geo lat/lng on the addresses row for a pii_id and source. |
| `AddressRepository.insert` | 54 |  | async | Inserts an addresses row; false on duplicate key. |
| `AddressRepository.update` | 68 |  | async | $set address fields on an addresses row by address_id. |

#### `src/modules/spine/repositories/org-counter.repository.ts`

File role: Spine repository: atomic $inc on shared app_counters rows for leads, contacts, addresses.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `OrgCounterRepository.next` | 26 |  | async | Atomic $inc on an existing app_counters row; throws if the row is missing. |
| `OrgCounterRepository.tryNext` | 33 |  | async | Atomically increments an existing app_counters row, never upserting, and returns null when the row is missing. |

#### `src/modules/spine/repositories/pii.repository.ts`

File role: Spine repository: reads and Vistaar-limited writes on shared piis plus the app_counters piis row.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `PiiRepository.findIdByPhone` | 27 |  | async | Oldest piis row with this phone; returns its pii_id or null. |
| `PiiRepository.hasAddresses` | 37 |  | async | True when the piis row already has an address. |
| `PiiRepository.addAddressRef` | 46 |  | async | $addToSet an address id on piis.addresses. |
| `PiiRepository.nextPiiNumber` | 58 |  | async | Atomic upsert $inc of the piis row in app_counters. |
| `PiiRepository.insert` | 71 |  | async | Inserts a new piis row with phone; false on duplicate key. |
| `PiiRepository.setOwnDocument` | 98 |  | async | Sets piis.documents.<type> only if empty or Vistaar-sourced; returns whether matched. |
| `PiiRepository.unverifyOwnDocument` | 120 |  | async | Sets is_verified false on a Vistaar-sourced piis.documents.<type>. |

#### `src/modules/spine/repositories/pincode.repository.ts`

File role: Spine repository: read-only pincode_map_v2 lookups.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `PincodeRepository.all` | 30 |  | async | Reads every pincode_map_v2 row with state, district, taluk and lat/lng. |
| `PincodeRepository.find` | 51 |  | async | Reads one pincode_map_v2 row by pincode. |

#### `src/modules/spine/repositories/product-facts.repository.ts`

File role: Spine repository: read-only join of products_v2, bulk_v2, categories_v2 into per-SKU facts.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `ProductFactsRepository.all` | 49 |  | async | Reads products_v2, bulk_v2, categories_v2; returns name, image, pack, GST, category per SKU. |
| `gstOf` | 111 |  | local | Parses a GST rate to a non-negative number, or null. |

#### `src/modules/spine/services/pii.service.ts`

File role: Spine service: finds or creates the person on piis, saves addresses and copies verified KYC docs.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `PiiService.nextOrgNumber` | 48 |  |  | Next app_counters number for a key; delegates to OrgCounterRepository. |
| `PiiService.tryNextOrgNumber` | 53 |  |  | Hands out the next app_counters number, null when the row is missing so callers can answer 503. |
| `PiiService.saveAddress` | 63 |  | async | Updates the source's own address row, or inserts ADDR-n (3 tries) and links it on piis; else IDENTITY_UNAVAILABLE. |
| `PiiService.setAddressGeo` | 109 |  |  | Delegates to AddressRepository.setGeo. |
| `PiiService.findIdByPhone` | 118 |  |  | Delegates to PiiRepository.findIdByPhone. |
| `PiiService.resolve` | 128 |  | async | Finds the pii_id by phone or inserts PII-n, retrying on collision; else IDENTITY_UNAVAILABLE. |
| `PiiService.recordVerifiedDocument` | 152 |  | async | Copies a verified document to piis with source vistaar unless another portal owns it; logs failures. |
| `PiiService.unverifyDocument` | 174 |  | async | Marks Vistaar's copy on piis unverified; logs failures. |

#### `src/modules/spine/services/pincode.service.ts`

File role: Spine service: in-memory pincode book (daily refresh) with corrected district centres.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `median` | 28 |  | local | Middle value of a sorted copy. |
| `withTrustedCentres` | 38 |  | export | Replaces pincode points over 60 km from their district median (or missing) with the district centre. |
| `PincodeService.onApplicationBootstrap` | 87 |  |  | Starts loading the pincode book. |
| `PincodeService.lookup` | 91 |  | async | Returns state/district/taluk for a 6-digit pincode from memory, or DB if the book is not loaded. |
| `PincodeService.centre` | 102 |  | async | Returns lat/lng for a pincode from the book, or null. |
| `PincodeService.current` | 112 |  | private async | Returns the book, refreshing daily in the background; retries a failed load after 60 s. |
| `PincodeService.refresh` | 123 |  | private | Single in-flight load. |
| `PincodeService.load` | 130 |  | private async | Loads all pincodes, fixes centres, stores the map; records failure time. |

#### `src/modules/spine/services/product-facts.service.ts`

File role: Spine service: in-memory product facts map refreshed hourly.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `ProductFactsService.onApplicationBootstrap` | 35 |  |  | Starts loading product facts. |
| `ProductFactsService.facts` | 39 |  | async | Returns the facts map, refreshing hourly in the background; empty map if never loaded. |
| `ProductFactsService.refresh` | 49 |  | private | Single in-flight load. |
| `ProductFactsService.load` | 56 |  | private async | Loads product facts from the repository; records failure time. |

### modules/uploads

#### `src/modules/uploads/controllers/uploads.controller.ts`

File role: Uploads controller: partner KYC/onboarding file upload.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `UploadsController.upload` | 29 | `POST /uploads` | async | Checks storage, multipart, mime, 10 MB size; saves under the partner pii_id; returns path and signed URL. |

#### `src/modules/uploads/services/storage.service.ts`

File role: Uploads service: Firebase Storage wrapper for private/public files, signed URLs and metadata.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `StorageService.configured` | 74 |  | get | True when Firebase credentials and bucket are set. |
| `StorageService.save` | 79 |  | async | Saves a private file under KO-documents/<pii_id>/<purpose>/; returns its path. |
| `StorageService.savePublic` | 103 |  | async | Saves a file with a download token; returns path and public URL. |
| `StorageService.publicFile` | 129 |  | async | Reads a file's token URL and custom metadata, or null if missing. |
| `StorageService.savePrivate` | 152 |  | async | Saves a private file under a folder with metadata; returns its path. |
| `StorageService.privateFile` | 172 |  | async | Returns a file's custom metadata, or null if missing. |
| `StorageService.signedUpload` | 192 |  | async | Returns a v4 signed write URL with content type and size-range headers. |
| `StorageService.stat` | 218 |  | async | Returns size and content type of a file, or null if missing. |
| `StorageService.publish` | 238 |  | async | Returns a token download URL, adding a token if none exists. |
| `StorageService.unpublish` | 253 |  | async | Removes the download token from a file; logs failures. |
| `StorageService.remove` | 265 |  | async | Deletes a file and its cached signed URL; logs failures. |
| `StorageService.downloadUrl` | 274 |  | private | Builds the Firebase token download URL. |
| `StorageService.urlOf` | 282 |  |  | Builds the storage.googleapis.com URL for a path, or null. |
| `StorageService.pathOf` | 294 |  |  | Extracts a bucket path from a Firebase or GCS URL of this bucket, or null. |
| `StorageService.read` | 322 |  | async | Downloads a file, or null if missing. |
| `StorageService.sign` | 333 |  | async | Returns 1-hour signed read URLs per path, reusing cached ones with 15+ min left. |
| `StorageService.remember` | 359 |  | private | Caches a signed URL, evicting the oldest past 50,000. |
| `StorageService.bucket` | 368 |  | private | Returns the Firebase bucket, initialising the app; throws UPLOADS_NOT_CONFIGURED. |

### modules/agents

#### `src/modules/agents/agents.domain.ts`

File role: Domain - pure partner stage pipeline rules (transitions, labels, refusal wording).

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `canMove` | 69 |  | export | True when the action is allowed from the given stage per TRANSITIONS. |
| `stageRefusal` | 101 |  | export | Builds the HO-facing sentence explaining why an action is refused at a stage. |
| `later` | 134 |  | local | Returns the later of two dates, used to keep partner timeline steps in order. |
| `partnerTimeline` | 148 |  | export | Builds the partner's timeline (applied, call, review, approved, active) from stage history and verified calls, marking skipped earlier steps done. |

#### `src/modules/agents/controllers/admin-agent-profile.controller.ts`

File role: Agents controller: HO logs verification calls and approves or rejects a partner's pending name change.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `AdminAgentProfileController.verificationCall` | 20 | `POST /admin/agents/:agentId/verification-call` · `@Can(kyc.review)` |  | HO logs a verification call outcome on a partner before a decision; the stage does not move. |
| `AdminAgentProfileController.approveName` | 41 | `POST /admin/agents/:agentId/name-change/approve` · `@Can(agents.edit)` |  | HO approves the partner's pending name change so it becomes the profile name. |
| `AdminAgentProfileController.rejectName` | 56 | `POST /admin/agents/:agentId/name-change/reject` · `@Can(agents.edit)` |  | HO refuses the partner's pending name change with a reason shown on the partner's /me. |

#### `src/modules/agents/dto/agent-profile.dto.ts`

File role: Agents DTOs: validate HO's verification call outcome and name-change rejection reason.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `trim` | 13 |  | local | Trims string input before validation so stray spaces do not reach the stored note or reason. |

#### `src/modules/agents/repositories/agent.repository.ts`

File role: Repository - Mongo reads and writes on vistaar_v2_agents (partner records).

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `isDuplicateKey` | 56 |  | local | True when the error is a Mongo duplicate-key (11000) error. |
| `escapeRegex` | 59 |  | local | Escapes regex special characters in a string for safe RegExp use. |
| `AgentRepository.findByAgentIds` | 69 |  |  | Reads agent_id, profile, preview of partners by VST- ids from vistaar_v2_agents. |
| `AgentRepository.verifiedAgentIds` | 80 |  | async | Returns every OTP-verified partner VST- id from vistaar_v2_agents. |
| `AgentRepository.approvedBrief` | 90 |  |  | Reads approved verified partners with board fields only, newest decision first, from vistaar_v2_agents. |
| `AgentRepository.earningPartner` | 106 |  |  | Reads one verified partner earning fields by VST- id from vistaar_v2_agents. |
| `AgentRepository.earningPartners` | 115 |  |  | Reads earning fields of every approved verified partner from vistaar_v2_agents. |
| `AgentRepository.setEarningCohorts` | 128 |  | async | Bulk-sets earning_cohort per VST- id on vistaar_v2_agents without touching timestamps. |
| `AgentRepository.countByEarningCohort` | 145 |  | async | Aggregates approved partner counts per earning cohort id on vistaar_v2_agents. |
| `AgentRepository.upsertForOtp` | 162 |  | async | Finds or inserts the partner row by phone on vistaar_v2_agents; on duplicate-key race returns existing. |
| `AgentRepository.findByPhone` | 188 |  |  | Reads one partner by phone and country code from vistaar_v2_agents. |
| `AgentRepository.findById` | 195 |  |  | Reads one partner by _id from vistaar_v2_agents. |
| `AgentRepository.findByAgentId` | 199 |  |  | Reads one partner by VST- id from vistaar_v2_agents. |
| `AgentRepository.completeVerification` | 207 |  |  | Sets verified flag, VST-/PII ids, owner and pushes signed_up history, only if still unverified. |
| `AgentRepository.touchLogin` | 243 |  | async | Sets last_login_at to now on vistaar_v2_agents without timestamps. |
| `AgentRepository.transition` | 257 |  |  | Moves stage and pushes history only if current stage is in from; null otherwise. |
| `AgentRepository.linkOnboarding` | 275 |  | async | Sets onboarding_id on the partner only when not yet linked, vistaar_v2_agents. |
| `AgentRepository.setPreview` | 284 |  | async | Sets cohort and preview on the partner row in vistaar_v2_agents. |
| `AgentRepository.setPlace` | 295 |  | async | Sets preview (and profile when approved) state/district on vistaar_v2_agents. |
| `AgentRepository.setOwner` | 310 |  |  | Sets owner_agent_id and updated_by on a partner, returns updated row. |
| `AgentRepository.addVerificationCall` | 326 |  |  | Pushes a verification call onto the partner only while their stage is still callable, returning the updated row. |
| `AgentRepository.editProfile` | 346 |  |  | Sets the partner's own profile edits only while approved, stamping updated_by as self. |
| `AgentRepository.decideNameChange` | 364 |  |  | Applies the name decision only if the same pending name is still waiting, so a stale decision misses. |
| `AgentRepository.setMonthlyTarget` | 380 |  |  | Sets monthly_target on a verified partner by VST- id, returns updated row. |
| `AgentRepository.list` | 395 |  | async | Paged filtered find plus count on vistaar_v2_agents, excluding stage_history. |
| `AgentRepository.summaryCounts` | 419 |  | async | One facet aggregation: counts per stage and verified, top cohorts and states. |
| `AgentRepository.near` | 465 |  |  | Finds partners within a radius via geoWithin centerSphere, excluding one id. |
| `AgentRepository.toQuery` | 486 |  | private | Builds the Mongo filter from list filters; q matches VST-, PII-, phone prefix or name. |

#### `src/modules/agents/services/agents.service.ts`

File role: Service - partner record business rules: verification, stage moves, lookups, earning cohort facts.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `AgentsService.registerOtpRequest` | 93 |  |  | Delegates to repository upsertForOtp. |
| `AgentsService.findByPhone` | 97 |  |  | Delegates to repository findByPhone. |
| `AgentsService.completeVerification` | 106 |  | async | First verify assigns VST- id, pii_id, default owner; repeat verify only stamps login. |
| `AgentsService.touchLogin` | 132 |  |  | Delegates to repository touchLogin. |
| `AgentsService.require` | 136 |  | async | Partner by _id or 404 not found. |
| `AgentsService.cohortById` | 143 |  | async | Partner cohort by _id, cached up to 60 s; 404 if missing. |
| `AgentsService.cohortByAgentId` | 148 |  | async | Partner cohort by VST- id, cached up to 60 s; 404 if unverified. |
| `AgentsService.cachedCohort` | 154 |  | private async | In-memory TTL cache of cohort per key with size cap eviction. |
| `AgentsService.requireByAgentId` | 170 |  | async | Verified partner by VST- id or 404 not found. |
| `AgentsService.requireWorkingPartner` | 182 |  | async | Verified partner must be active and approved; else ACCOUNT_BLOCKED or PARTNER_NOT_APPROVED 403. |
| `AgentsService.isOutOfWork` | 203 |  | async | True when the partner is missing, blocked or inactive. |
| `AgentsService.approvedBrief` | 209 |  |  | Delegates to repository approvedBrief. |
| `AgentsService.earningPartner` | 216 |  |  | Delegates to repository earningPartner with upper-cased VST- id. |
| `AgentsService.earningPartners` | 221 |  |  | Delegates to repository earningPartners. |
| `AgentsService.setEarningCohorts` | 225 |  |  | Delegates to repository setEarningCohorts. |
| `AgentsService.earningCohortCounts` | 232 |  | async | Map of earning cohort id to approved partner count. |
| `AgentsService.verifiedAgentIds` | 238 |  |  | Delegates to repository verifiedAgentIds. |
| `AgentsService.partnersByAgentIds` | 243 |  | async | Map of VST- id to partner card (id, name) for lead lists. |
| `AgentsService.move` | 264 |  | async | Applies a stage action conditionally; 409 STAGE_NOT_ALLOWED when stage disallows or lost race. |
| `AgentsService.unblock` | 297 |  | async | Returns a blocked partner to blocked_from stage; 409 STAGE_NOT_ALLOWED otherwise. |
| `AgentsService.approve` | 322 |  |  | Moves to approved, setting decision fields, profile and optional location. |
| `AgentsService.reject` | 341 |  |  | Moves to rejected with reason and decision fields. |
| `AgentsService.linkOnboarding` | 353 |  |  | Delegates to repository linkOnboarding. |
| `AgentsService.setPreview` | 357 |  |  | Clears cohort cache entry, then delegates to repository setPreview. |
| `AgentsService.setPlace` | 363 |  |  | Delegates to repository setPlace, profile too when partner has a profile. |
| `AgentsService.setOwner` | 370 |  | async | Sets partner owner; 404 when the partner is gone. |
| `AgentsService.logVerificationCall` | 381 |  | async | Checks the stage allows a call, records the outcome with note and HO email, else STAGE_NOT_ALLOWED. |
| `AgentsService.setProfileBankAccount` | 412 |  | async | Copies an approved bank change into the partner's profile details, skipped when no profile was mapped. |
| `AgentsService.editProfile` | 422 |  | async | Applies the partner's PATCH /me edits to profile fields and language, holding a new name in pending_name for HO. |
| `AgentsService.decideNameChange` | 468 |  | async | Approves or rejects the pending name, keeping the result and reason; NAME_CHANGE_NOT_PENDING when none waits. |
| `AgentsService.noPendingName` | 494 |  | private | Builds the NAME_CHANGE_NOT_PENDING conflict asking HO to refresh the page. |
| `AgentsService.setMonthlyTarget` | 502 |  | async | Sets or clears a partner monthly target by VST- id; 404 if not found. |
| `AgentsService.list` | 516 |  |  | Delegates to repository list. |
| `AgentsService.stageCounts` | 523 |  | async | Shapes summary counts into per-stage totals, unverified count, total, top cohorts and states. |
| `AgentsService.near` | 548 |  |  | Delegates to repository near. |
| `AgentsService.stageError` | 557 |  | private | Builds 409 STAGE_NOT_ALLOWED error with stageRefusal wording. |

### modules/auth

#### `src/modules/auth/auth.domain.ts`

File role: Domain — login vs signup OTP intent rules for account existence.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `checkBeforeSend` | 13 |  | export | Login needs a verified account (else not_found); signup must not have one (else exists). |
| `checkBeforeVerify` | 27 |  | export | Returns not_found only for login on an unverified number; otherwise ok. |

#### `src/modules/auth/controllers/auth.controller.ts`

File role: Controller — public partner OTP send/resend/verify, token refresh, and logout routes.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `AuthController.send` | 31 | `POST /auth/otp/send` · `@Public` |  | Delegates to AuthService.sendOtp with resend false and the intent. |
| `AuthController.resend` | 44 | `POST /auth/otp/resend` · `@Public` |  | Delegates to AuthService.sendOtp with resend true. |
| `AuthController.verify` | 54 | `POST /auth/otp/verify` · `@Public` |  | Delegates to AuthService.verifyOtp with phone, otp, user agent and intent; returns a session. |
| `AuthController.refresh` | 76 | `POST /auth/refresh` · `@Public` |  | Delegates to AuthService.refresh with the refresh token and user agent. |
| `AuthController.logout` | 89 | `POST /auth/logout` |  | Delegates to AuthService.logout for the token's partner and given refresh token. |

#### `src/modules/auth/dto/auth.dto.ts`

File role: DTO — validation for OTP request, verify, refresh bodies and session response shapes.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `trim` | 14 |  | local | Transform helper: trims string values, passes other values through. |

#### `src/modules/auth/repositories/otp-attempt.repository.ts`

File role: Repository — sliding-window OTP rate-limit counters on `vistaar_v2_otp_attempts`.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `OtpAttemptRepository.take` | 23 |  | async | One atomic pipeline upsert: drops old hits, adds this one if under limit; returns 0 or seconds to wait. |
| `OtpAttemptRepository.reset` | 68 |  | async | Deletes the attempt row by _id. |

#### `src/modules/auth/repositories/session.repository.ts`

File role: Repository — refresh-token sessions (hashed) on `vistaar_v2_sessions`.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `SessionRepository.create` | 13 |  | async | Inserts a session row. |
| `SessionRepository.consume` | 21 |  |  | findOneAndDelete of an unexpired session by hash, so a token is spent once. |
| `SessionRepository.remove` | 28 |  | async | Deletes the session matching hash and agent_ref. |

#### `src/modules/auth/services/auth.service.ts`

File role: Service - phone OTP login, partner session issue, refresh and logout.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `hashToken` | 29 |  | local | SHA-256 hex digest of a refresh token. |
| `AuthService.sendOtp` | 53 |  | async | Checks account per intent, creates record on signup, refuses blocked, sends OTP. |
| `AuthService.verifyOtp` | 70 |  | async | Verifies OTP, resolves pii on first verify, completes verification, opens session; OTP_NOT_REQUESTED if no record. |
| `AuthService.refresh` | 100 |  | async | Consumes refresh token session, checks partner active and not blocked, issues new session; SESSION_INVALID. |
| `AuthService.logout` | 126 |  | async | Removes the refresh token session of the partner. |
| `AuthService.openSession` | 134 |  | private async | Stores hashed refresh token in vistaar_v2_sessions and returns access token, refresh token, agent brief. |
| `AuthService.phone` | 174 |  | private | Normalises the mobile number or throws INVALID_PHONE. |
| `AuthService.refuseAccount` | 185 |  | private | Throws ACCOUNT_NOT_FOUND 404 or ACCOUNT_EXISTS 409 per account check. |
| `AuthService.refuseBlocked` | 202 |  | private | Throws ACCOUNT_BLOCKED 403 when partner blocked or inactive. |

#### `src/modules/auth/services/otp.service.ts`

File role: Service - OTP send/verify via the company utilities service with shared rate limits.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `attemptKey` | 24 |  | export | Builds OTP attempt key send:/verify:<phone>, or lead- prefixed for lead scope. |
| `OtpService.send` | 65 |  | async | Rate-limits sends (OTP_LIMIT), skips test numbers, calls provider send/resend; OTP_UNAVAILABLE on failure. |
| `OtpService.verify` | 102 |  | async | Rate-limits tries, checks test code or provider verdict; OTP_INVALID or OTP_UNAVAILABLE; resets attempts on pass. |
| `OtpService.isTestNumber` | 161 |  | private | True when the phone is in configured test numbers. |
| `OtpService.post` | 166 |  | private async | POSTs JSON to the OTP service with timeout; null on transport failure. |
| `verdictOf` | 193 |  | export | Classifies provider reply as verified, status_only or refused. |
| `asRecord` | 209 |  | local | Returns the value as a plain object or null. |
| `shapeOf` | 216 |  | local | Redacted JSON shape of a body for logging. |
| `providerMessage` | 232 |  | local | Extracts short data.message from provider body, or null. |

### modules/partner-desk

#### `src/modules/partner-desk/controllers/admin-agents.controller.ts`

File role: Controller — HO partner desk routes: summary, list, detail, form edits, KYC review and stage decisions, owner change.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `AdminAgentsController.summary` | 35 | `GET /admin/agents/summary` · `@Can(agents.read)` |  | Delegates to DeskService.summary. |
| `AdminAgentsController.list` | 45 | `GET /admin/agents` · `@Can(agents.read)` |  | Delegates to DeskService.list with the query. |
| `AdminAgentsController.detail` | 55 | `GET /admin/agents/:agentId` · `@Can(agents.read)` |  | Delegates to DeskService.detail with optional radius_km. |
| `AdminAgentsController.edit` | 65 | `PATCH /admin/agents/:agentId/onboarding` · `@Can(agents.edit)` |  | Delegates to DeskService.editOnboarding with data and admin email. |
| `AdminAgentsController.review` | 78 | `POST /admin/agents/:agentId/documents/:fieldKey/review` · `@Can(kyc.review)` |  | Delegates to DeskService.reviewDocument for one KYC field. |
| `AdminAgentsController.requestChanges` | 99 | `POST /admin/agents/:agentId/request-changes` · `@Can(agents.decide)` |  | Delegates to DeskService.requestChanges with per-field remarks. |
| `AdminAgentsController.approve` | 114 | `POST /admin/agents/:agentId/approve` · `@Can(agents.decide)` |  | Delegates to DeskService.approve. |
| `AdminAgentsController.reject` | 128 | `POST /admin/agents/:agentId/reject` · `@Can(agents.decide)` |  | Delegates to DeskService.reject with the reason. |
| `AdminAgentsController.reopen` | 140 | `POST /admin/agents/:agentId/reopen` · `@Can(agents.decide)` |  | Delegates to DeskService.reopen with optional reason. |
| `AdminAgentsController.block` | 154 | `POST /admin/agents/:agentId/block` · `@Can(agents.decide)` |  | Delegates to DeskService.block with the reason. |
| `AdminAgentsController.unblock` | 169 | `POST /admin/agents/:agentId/unblock` · `@Can(agents.decide)` |  | Delegates to DeskService.unblock with optional reason. |
| `AdminAgentsController.owner` | 183 | `PUT /admin/agents/:agentId/owner` · `@Can(agents.assign)` |  | Delegates to DeskService.setOwner with owner_agent_id. |

#### `src/modules/partner-desk/dto/desk.dto.ts`

File role: DTO — HO desk list/nearby queries, sorts and decision bodies.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `toBool` | 16 |  | local | Transform helper: true only for boolean true or string 'true'. |

#### `src/modules/partner-desk/repositories/network.repository.ts`

File role: Repository — read-only nearby-network lookup on `franchises`, `prasar_v2_retailers` and `vistaaragents`.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `NetworkRepository.near` | 27 |  | async | Runs the three lookups in parallel and returns hits sorted by distance. |
| `NetworkRepository.franchises` | 44 |  | private async | Reads `franchises` within radius via $geoWithin; maps to hits with haversine distance. |
| `NetworkRepository.prasarRetailers` | 80 |  | private async | Bounding-box read of `prasar_v2_retailers` lat/lng, then distance filter and limit. |
| `NetworkRepository.oldVistaarAgents` | 128 |  | private async | Bounding-box read of `vistaaragents` matching both coordinate orders, then distance filter and limit. |
| `bbox` | 200 |  | local | Computes a lat/lng bounding box around a point for a km radius. |
| `round` | 211 |  | local | Rounds km to two decimals. |

#### `src/modules/partner-desk/services/desk.service.ts`

File role: Service - HO partner desk: list, detail, nearby conflicts and stage decisions.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `DeskService.summary` | 96 |  |  | Delegates to agents stageCounts. |
| `DeskService.list` | 100 |  | async | Validates sort (VALIDATION_FAILED), lists partners, adds onboarding progress and owner names as desk rows. |
| `DeskService.detail` | 168 |  | async | Partner by VST- id with owner, onboarding data (incl. duplicate IDs), verification calls and nearby conflicts. |
| `DeskService.nearby` | 196 |  | async | Nearby Vistaar partners, applicants and network stores within clamped radius, sorted by distance. |
| `DeskService.editOnboarding` | 266 |  |  | Delegates to onboarding deskEdit for the partner. |
| `DeskService.reviewDocument` | 272 |  |  | Delegates to onboarding reviewDocument for the partner. |
| `DeskService.requestChanges` | 284 |  |  | Delegates to onboarding requestChanges for the partner. |
| `DeskService.approve` | 291 |  | async | Approves via onboarding, places the partner in an earning cohort, then works out the one-time welcome reward. |
| `DeskService.reject` | 307 |  |  | Delegates to agents reject with trimmed reason. |
| `DeskService.block` | 313 |  |  | Moves partner to blocked with trimmed reason. |
| `DeskService.unblock` | 319 |  | async | Unblocks partner, then recomputes earning cohort. |
| `DeskService.reopen` | 327 |  |  | Moves partner via reopen action, clearing approval and rejection reason. |
| `DeskService.setOwner` | 336 |  | async | Checks owner is active staff (OWNER_NOT_FOUND), then sets partner owner. |
| `DeskService.placeInCohort` | 354 |  | private async | Recomputes earning cohort; failure only logged, never undoes the decision. |
| `DeskService.withAgent` | 368 |  | private async | Loads verified partner by VST- id and runs the callback. |
| `clampRadius` | 376 |  | local | Clamps radius km to 0.5-50, default 5 when not finite. |

### modules/onboarding

#### `src/modules/onboarding/bank-change.domain.ts`

File role: Onboarding domain: bank-change shape and pure helpers to find bank fields, build new values, mask the account.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `bankFields` | 45 |  | export | Finds the form's payout-account field and bank-proof document by maps_to and org_document, the same way payouts find them. |
| `bankValues` | 60 |  | export | Builds the new account and proof form values, keeping sub-fields the request does not name (like a UPI ID). |
| `last4` | 79 |  | export | Returns the account number's last four digits, so the partner never sees the full number. |

#### `src/modules/onboarding/controllers/admin-bank-change.controller.ts`

File role: Onboarding controller: HO's view, approve and reject of a partner's bank-account change.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `AdminBankChangeController.get` | 20 | `GET /admin/agents/:agentId/bank-change` · `@Can(kyc.review)` |  | Answers HO the partner's pending or last bank change with full number, signed proof and current account; null when none. |
| `AdminBankChangeController.approve` | 30 | `POST /admin/agents/:agentId/bank-change/approve` · `@Can(kyc.review)` |  | HO approves the pending bank change: new account and proof go into the form, proof verified and copied to piis. |
| `AdminBankChangeController.reject` | 44 | `POST /admin/agents/:agentId/bank-change/reject` · `@Can(kyc.review)` |  | HO rejects the pending bank change with a reason the partner sees; the current account stays. |

#### `src/modules/onboarding/controllers/admin-cohorts.controller.ts`

File role: Controller — HO CRUD routes for partner types (cohorts).

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `AdminCohortsController.list` | 25 | `GET /admin/cohorts` · `@Can(config.read)` |  | Delegates to CohortsService.list(false); returns all cohorts including inactive. |
| `AdminCohortsController.create` | 32 | `POST /admin/cohorts` · `@Can(config.write)` |  | Delegates to CohortsService.create with the DTO and HO email. |
| `AdminCohortsController.update` | 44 | `PATCH /admin/cohorts/:key` · `@Can(config.write)` |  | Delegates to CohortsService.update for the cohort key. |
| `AdminCohortsController.remove` | 55 | `DELETE /admin/cohorts/:key` · `@Can(config.write)` |  | Delegates to CohortsService.remove; 409 COHORT_IN_USE when it has a form or applicants. |

#### `src/modules/onboarding/controllers/admin-configs.controller.ts`

File role: Controller — HO routes to edit, version, clone, publish and discard onboarding form configs.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `AdminConfigsController.meta` | 28 | `GET /admin/onboarding-configs/meta` · `@Can(config.read)` |  | Returns the allowed field types, maps_to targets and the details. prefix for the editor. |
| `AdminConfigsController.versions` | 45 | `GET /admin/onboarding-configs/:cohort/versions` · `@Can(config.read)` |  | Delegates to ConfigsService.versions; all versions of a cohort without steps. |
| `AdminConfigsController.version` | 54 | `GET /admin/onboarding-configs/:cohort/versions/:version` · `@Can(config.read)` |  | Delegates to ConfigsService.version; one full config version. |
| `AdminConfigsController.draft` | 64 | `GET /admin/onboarding-configs/:cohort/draft` · `@Can(config.read)` |  | Delegates to ConfigsService.draft; draft plus publish blockers, or null. |
| `AdminConfigsController.saveDraft` | 74 | `PUT /admin/onboarding-configs/:cohort/draft` · `@Can(config.write)` |  | Delegates to ConfigsService.saveDraft with steps, notes and HO email. |
| `AdminConfigsController.clone` | 93 | `POST /admin/onboarding-configs/:cohort/draft/clone-from/:source` · `@Can(config.write)` |  | Delegates to ConfigsService.cloneFrom to start the draft from another cohort's form. |
| `AdminConfigsController.publish` | 107 | `POST /admin/onboarding-configs/:cohort/publish` · `@Can(config.publish)` |  | Delegates to ConfigsService.publish for the cohort's draft. |
| `AdminConfigsController.discard` | 121 | `DELETE /admin/onboarding-configs/:cohort/draft` · `@Can(config.write)` |  | Delegates to ConfigsService.discardDraft. |

#### `src/modules/onboarding/controllers/bank-change.controller.ts`

File role: Onboarding controller: partner's bank-account change — request, status, withdraw.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `BankChangeController.mine` | 19 | `GET /me/bank-change` |  | Answers the partner's pending or last bank account change with the account masked; null when none. |
| `BankChangeController.request` | 30 | `POST /me/bank-change` |  | Partner asks to be paid into another account; approved partners only, one pending at a time, HO verifies the proof. |
| `BankChangeController.withdraw` | 42 | `DELETE /me/bank-change` |  | Partner withdraws their pending bank account change before HO decides it. |

#### `src/modules/onboarding/controllers/me.controller.ts`

File role: Controller - Vistaar app GET /me route returning the partner's identity and application status.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `MeController.get` | 22 | `GET /me` |  | Delegates to MeService.get with the token's partner sub. |
| `MeController.update` | 31 | `PATCH /me` |  | Approved partner edits email, language, place or photo; a new name waits for HO approval. |

#### `src/modules/onboarding/controllers/onboarding.controller.ts`

File role: Controller — public cohort/form/pincode reads and the partner's onboarding read, save and submit.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `OnboardingController.cohortsList` | 62 | `GET /onboarding/cohorts` · `@Public` | async | Returns active cohorts (cached list) trimmed to id, label, description, icon, sub_types, order. |
| `OnboardingController.config` | 85 | `GET /onboarding/config` · `@Public` | async | Requires cohort query (COHORT_REQUIRED); returns published form's active steps sorted, location fields optional. |
| `OnboardingController.pincode` | 112 | `GET /onboarding/pincode/:pincode` · `@Public` | async | Delegates to PincodeService.lookup; state, district, taluk or null. |
| `OnboardingController.mine` | 125 | `GET /onboarding` |  | Delegates to OnboardingService.mine for the token's partner. |
| `OnboardingController.save` | 136 | `PATCH /onboarding` |  | Delegates to OnboardingService.save with the token's partner and DTO. |
| `OnboardingController.submit` | 148 | `POST /onboarding/submit` |  | Delegates to OnboardingService.submit for the token's partner. |

#### `src/modules/onboarding/dto/me.dto.ts`

File role: Onboarding DTO: the Vistaar app's Edit Profile body for PATCH /me; only sent keys change.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `trim` | 12 |  | local | Trims string inputs before validation so stray spaces never fail or get stored. |

#### `src/modules/onboarding/form.domain.ts`

File role: Domain — pure onboarding form rules: config validation, value checks, progress, profile mapping, file URL dressing.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `configErrors` | 134 |  | export | Validates a form config's steps (unique ids, keys, maps_to, org documents) and returns publish-blocking error sentences. |
| `fieldErrors` | 192 |  | local | Returns error sentences for one field definition, starting with the key format rule. |
| `titled` | 255 |  | local | Formats a label as a bracketed suffix, or empty when blank. |
| `isMapsTo` | 258 |  | local | True when the value is a known MAPS_TO target or a valid details.<key> path. |
| `fail` | 273 |  | local | Builds a failed Checked result with the error sentence. |
| `nameOf` | 276 |  | local | Field's English label, or its key with underscores as spaces. |
| `ok` | 278 |  | local | Builds a successful Checked result with the cleaned value. |
| `checkValue` | 280 |  | export | Validates and cleans one value against its field type and validation rules; returns ok value or error sentence. |
| `checkGroup` | 456 |  | local | Checks an object field's sub-values, rejecting unknown keys and missing required sub-fields. |
| `filePath` | 479 |  | local | Extracts a file path from a string or an object with path. |
| `ownPath` | 491 |  | local | True when the path is under the person's KO-documents/<pii_id>/ folder, no .., under 300 chars. |
| `isEmpty` | 496 |  | export | True for undefined, null, blank string or empty array. |
| `isRequired` | 508 |  | export | Field is required unless it is a location field. |
| `withOptionalLocation` | 512 |  | export | Returns steps with every location field marked not required. |
| `activeSteps` | 521 |  | export | Active steps sorted by order. |
| `fieldIndex` | 524 |  | export | Map of top-level field key to definition across active steps. |
| `isVisible` | 530 |  | export | Evaluates a field's visible_if rule (eq, ne, in, filled) against raw data. |
| `missingRequired` | 547 |  | export | Keys of required, visible, active fields with no value. |
| `progress` | 554 |  | export | Computes completion percentage of required visible fields and the list of completed step ids. |
| `requiredDocuments` | 580 |  | export | Keys of required, visible document fields. |
| `documentKeys` | 587 |  | export | Keys of all document fields in active steps. |
| `locationOf` | 595 |  | export | First location field value with numeric lat/lng as a GeoJSON point, else null. |
| `mapProfile` | 612 |  | export | Maps raw_data to a partner profile via each visible field's maps_to (details.*, location, state uppercased). |
| `withPlace` | 642 |  | export | Overrides state and district with the pincode book's values when known. |
| `previewOf` | 655 |  | export | Picks name, district, state, pincode strings from the mapped profile for desk lists. |
| `filePaths` | 671 |  | export | Collects every stored file path in file, document, object and object_list fields. |
| `withUrls` | 700 |  | export | Copy of raw_data with signed url/urls added next to each file path. |

#### `src/modules/onboarding/id-keys.domain.ts`

File role: Onboarding domain: Aadhaar hash and PAN keys and the cross-partner duplicate check.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `normaliseAadhaar` | 31 |  | export | Strips spaces and dashes from an Aadhaar; returns the 12 digits, or null when not a valid number. |
| `normalisePan` | 36 |  | export | Strips spaces and upper-cases a PAN so the same card always compares equal; null when empty. |
| `idFieldKeys` | 41 |  | export | Finds the form's Aadhaar and PAN field keys by org_document, not by key name. |
| `idKeysOf` | 48 |  | export | Works out a partner's id_keys from the form: Aadhaar as a SHA-256 hash only, PAN normalised. |
| `duplicatesOf` | 68 |  | export | Lists other partners holding the same Aadhaar hash or PAN, per kind; the caller is never included. |
| `idInUseMessage` | 90 |  | export | Builds the partner-facing sentence saying this Aadhaar and/or PAN is already used by another Vistaar account. |

#### `src/modules/onboarding/repositories/cohort.repository.ts`

File role: Repository — Mongo access for cohorts in vistaar_v2_cohorts.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `CohortRepository.list` | 13 |  |  | Reads vistaar_v2_cohorts (optionally active only), sorted by order then _id. |
| `CohortRepository.find` | 21 |  |  | Reads one cohort by _id from vistaar_v2_cohorts. |
| `CohortRepository.create` | 25 |  | async | Inserts a cohort into vistaar_v2_cohorts. |
| `CohortRepository.update` | 32 |  |  | $set fields on a cohort by _id; returns the updated row. |
| `CohortRepository.remove` | 43 |  | async | Deletes a cohort by _id; true when one was deleted. |

#### `src/modules/onboarding/repositories/config.repository.ts`

File role: Repository — Mongo access for form configs in vistaar_v2_onboarding_configs.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `ConfigRepository.latestPublished` | 18 |  |  | Reads the highest-version published config for a cohort. |
| `ConfigRepository.version` | 26 |  |  | Reads config by _id <cohort>@<version>. |
| `ConfigRepository.draft` | 33 |  |  | Reads the cohort's draft config. |
| `ConfigRepository.versions` | 41 |  |  | Lists a cohort's configs without steps, newest version first. |
| `ConfigRepository.maxVersion` | 50 |  | async | Returns the cohort's highest version number, or 0. |
| `ConfigRepository.createDraft` | 60 |  | async | Inserts a draft config with _id <cohort>@<version>. |
| `ConfigRepository.updateDraft` | 80 |  |  | $set steps, notes, updated_by on the cohort's draft; returns it or null. |
| `ConfigRepository.publish` | 97 |  |  | Flips a draft to published with published_at/by; null if not a draft. |
| `ConfigRepository.archiveOlder` | 115 |  | async | Marks the cohort's older published versions archived. |
| `ConfigRepository.deleteDraft` | 128 |  | async | Deletes the cohort's draft; true when deleted. |
| `ConfigRepository.existsForCohort` | 135 |  | async | True when any config exists for the cohort. |

#### `src/modules/onboarding/repositories/onboarding.repository.ts`

File role: Repository - Mongo reads and writes on vistaar_v2_onboarding_data (partner onboarding form records).

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `OnboardingRepository.findByAgent` | 24 |  |  | Agent ref to that partner's onboarding row from vistaar_v2_onboarding_data, or null. |
| `OnboardingRepository.create` | 32 |  | async | Inserts the partner's onboarding row with empty raw_data; on duplicate-key race returns the existing row. |
| `OnboardingRepository.updateIfVersion` | 60 |  |  | Optimistic update on vistaar_v2_onboarding_data matching _id and version, bumps version; null if version moved. |
| `OnboardingRepository.near` | 80 |  |  | Finds other partners' onboarding rows whose location lies within a radius of a point, limited. |
| `OnboardingRepository.progressFor` | 102 |  |  | Agent refs to completion_pct, submitted_at and cohort per partner in one query. |
| `OnboardingRepository.forPayout` | 124 |  |  | Agent refs to cohort, config version, raw_data, documents_review and bank-change status needed for payouts, in one read. |
| `OnboardingRepository.startBankChange` | 157 |  |  | Atomically starts a bank change and bumps version unless one is already pending; null when one is. |
| `OnboardingRepository.closeBankChange` | 178 |  |  | Decides a bank change only while that same request is still pending and the version unchanged, pushing capped audit entries. |
| `OnboardingRepository.idHolders` | 208 |  |  | Finds other partners' rows holding the same Aadhaar hash or PAN, for the duplicate check. |
| `OnboardingRepository.pageAfter` | 227 |  |  | Returns a page of onboarding rows ordered by _id after a cursor, for one-off backfills. |
| `OnboardingRepository.countForCohort` | 266 |  | async | Counts vistaar_v2_onboarding_data rows in a cohort. |

#### `src/modules/onboarding/services/bank-change.service.ts`

File role: Onboarding service: approved partner's bank-account change lifecycle, with HO approval re-verifying the proof.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `BankChangeService.mine` | 68 |  | async | Returns the partner's pending or last bank change in the masked partner view, or null. |
| `BankChangeService.request` | 73 |  | async | Checks approved, unblocked, nothing pending, form rules and a different account, then stores the pending bank change. |
| `BankChangeService.withdraw` | 120 |  | async | Marks the partner's pending bank change withdrawn, decided by self. |
| `BankChangeService.forDesk` | 130 |  | async | HO view of a partner's bank change by VST- id, or null when none. |
| `BankChangeService.approve` | 140 |  | async | Writes new account and verified proof into the form with audit, mirrors proof to piis, updates the profile bank copy. |
| `BankChangeService.reject` | 189 |  | async | HO rejects the pending bank change; a reason is required (VALIDATION_FAILED) and stored for the partner. |
| `BankChangeService.requireDoc` | 210 |  | private async | Loads the partner's onboarding row, else BANK_CHANGE_NOT_PENDING. |
| `BankChangeService.fieldsOf` | 216 |  | private async | Finds the payout-account and bank-proof fields on the partner's pinned form, else CONFIG_INVALID. |
| `BankChangeService.close` | 233 |  | private async | Closes the pending change with decided_at/by; refused (BANK_CHANGE_NOT_PENDING) if decided, replaced or edited meanwhile. |
| `BankChangeService.adminView` | 257 |  | private async | Builds HO's view: full account, signed proof URL and the account currently paid into. |
| `partnerView` | 280 |  | local | Builds the partner's view of a bank change with only the account's last four digits. |
| `passes` | 293 |  | local | Checks a value against the form field's own rules; returns the cleaned value or a 400 with the form's sentence. |
| `pendingOf` | 304 |  | local | Returns the pending bank change, else BANK_CHANGE_NOT_PENDING. |
| `changePending` | 309 |  | local | Builds the BANK_CHANGE_PENDING conflict: a change is already waiting for review, withdraw it first. |
| `notPending` | 316 |  | local | Builds the BANK_CHANGE_NOT_PENDING conflict: no bank change waiting, reload. |

#### `src/modules/onboarding/services/cohorts.service.ts`

File role: Service — cohort business rules with a 60 s in-memory cache of active cohorts.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `CohortsService.list` | 24 |  | async | Returns all cohorts, or active ones cached for 60 s. |
| `CohortsService.require` | 34 |  | async | Returns the cohort or throws COHORT_NOT_FOUND (also when inactive and activeOnly). |
| `CohortsService.create` | 47 |  | async | Requires English label (VALIDATION_FAILED), unique key (COHORT_EXISTS); inserts and clears cache. |
| `CohortsService.update` | 73 |  | async | Requires English label if given; updates, clears cache; 404 when not found. |
| `CohortsService.remove` | 87 |  | async | Deletes a cohort only with no config or onboarding rows, else COHORT_IN_USE. |

#### `src/modules/onboarding/services/configs.service.ts`

File role: Service — onboarding form config drafts, publishing and cached published/version reads.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `ConfigsService.published` | 38 |  | async | Latest published config for a cohort, cached 30 s. |
| `ConfigsService.requirePublished` | 47 |  | async | Published config or 409 CONFIG_NOT_PUBLISHED. |
| `ConfigsService.version` | 60 |  | async | One config version (cached unless draft) or 404. |
| `ConfigsService.versions` | 70 |  |  | Delegates to ConfigRepository.versions. |
| `ConfigsService.draft` | 74 |  | async | Returns the draft with its configErrors, or null. |
| `ConfigsService.saveDraft` | 84 |  | async | Checks cohort exists, updates the draft or creates one at max version + 1; returns errors. |
| `ConfigsService.cloneFrom` | 106 |  | async | Copies source cohort's published or draft steps into this cohort's draft; 404 if none. |
| `ConfigsService.publish` | 118 |  | async | Publishes the draft if no configErrors (NO_DRAFT, CONFIG_INVALID); archives older, refreshes cache. |
| `ConfigsService.discardDraft` | 147 |  | async | Deletes the draft or throws NO_DRAFT. |
| `ConfigsService.remember` | 156 |  | private | Caches a config by _id, clearing the cache at 200 entries. |
| `asSteps` | 167 |  | local | Checks each step has a fields array and the form is under 512 KB, else CONFIG_INVALID. |

#### `src/modules/onboarding/services/me.service.ts`

File role: Service - builds the partner's /me view: stage, next action, onboarding progress, profile, earning cohort.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `ownPath` | 98 |  | local | True only for a path inside the partner's own KO-documents/<pii_id>/ folder with no '..' tricks. |
| `MeService.get` | 119 |  | async | Agent ref to me view: stage, onboarding summary, unlock flags, rejection reason, masked profile, photo URL, name change, reporting officer, earning cohort. |
| `MeService.earningOf` | 177 |  | private async | Reads the partner's app earning cohort; logs and returns null on any failure so /me never fails. |
| `MeService.update` | 193 |  | async | Approved partner edits profile; pincode book overrides state/district, new name waits as pending_name, place change recomputes earning cohort. |
| `MeService.officer` | 234 |  | private async | Looks up the partner's HO owner as reporting officer: name, phone and role name. |
| `MeService.requirePhoto` | 251 |  | private async | Checks the photo is an uploaded image in the partner's own folder (IMAGE_NOT_FOUND, FILE_TYPE_NOT_ALLOWED). |
| `maskedProfile` | 270 |  | local | Replaces the profile bank account number with its last four digits for the partner. |

#### `src/modules/onboarding/services/onboarding.service.ts`

File role: Service - onboarding form lifecycle: partner saves and submit, HO desk edit, KYC review, request changes, approve, payout facts.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `labelsOf` | 59 |  | local | Field keys to a comma-joined list of their English form labels, falling back to the key. |
| `text` | 80 |  | local | Returns a trimmed non-empty string, else null. |
| `OnboardingService.mine` | 132 |  | async | Agent ref to the partner's onboarding view on its pinned config version, or null if not started. |
| `OnboardingService.save` | 150 |  | async | Validates and writes answers per key; first save needs cohort (COHORT_REQUIRED), creates record, moves stage to onboarding, rejects duplicate Aadhaar/PAN. |
| `OnboardingService.submit` | 211 |  | async | Checks stage, required fields (REQUIRED_FIELDS_MISSING) and duplicate IDs, sets reviews pending and id_keys, moves stage to kyc_review. |
| `OnboardingService.forDesk` | 257 |  | async | HO view of a partner's onboarding: full view plus steps, edit audit, location and duplicate Aadhaar/PAN holders; null if none. |
| `OnboardingService.deskEdit` | 276 |  | async | HO edits answers in allowed stages (STAGE_NOT_ALLOWED), checks duplicate IDs, audits each change, reopens changed document reviews. |
| `OnboardingService.reviewDocument` | 329 |  | async | HO verifies or rejects one KYC document during kyc_review; rejection needs a reason; mirrors result to piis. |
| `OnboardingService.reviewEntry` | 379 |  |  | Builds HO's documents_review entry for one document, shared by the review desk and the bank-change approval. |
| `OnboardingService.mirrorReviewed` | 399 |  |  | Copies a verified org_document to piis.documents in ko-sales shape, or un-verifies it on rejection; nothing for other fields. |
| `OnboardingService.requestChanges` | 421 |  | async | In kyc_review, saves per-field notes plus rejected documents as remarks and moves stage to changes_requested. |
| `OnboardingService.approve` | 469 |  | async | In kyc_review, requires all required documents verified (DOCUMENTS_NOT_VERIFIED), maps profile with place, approves partner. |
| `OnboardingService.progressFor` | 498 |  | async | Agent refs to a map of completion_pct and submitted_at per partner. |
| `OnboardingService.payoutFacts` | 518 |  | async | Per partner: PAN number, bank account, whether PAN and bank proof are verified, and bank change pending, found by field meaning. |
| `OnboardingService.nearby` | 559 |  |  | Delegates to OnboardingRepository.near. |
| `OnboardingService.backfillIdKeys` | 573 |  | async | One-off script: fills missing id_keys on old rows and reports Aadhaar/PAN held by several partners, agent ids only. |
| `OnboardingService.assertPartnerCanEdit` | 629 |  | private | Throws ACCOUNT_BLOCKED if blocked or inactive, ONBOARDING_LOCKED if stage not partner-editable. |
| `OnboardingService.requireDoc` | 646 |  | private async | Returns the partner's onboarding row or throws COHORT_REQUIRED. |
| `OnboardingService.editableKeys` | 657 |  | private | While changes_requested, the remarked fields plus rejected documents; otherwise null (all editable). |
| `OnboardingService.repinIfAllowed` | 675 |  | private async | Before submit moves the form to the latest or switched cohort config, dropping unknown answers; after submit blocks cohort switch. |
| `OnboardingService.check` | 721 |  | private | Validates incoming answers against form fields; throws UNKNOWN_FIELD, FIELD_NOT_EDITABLE or VALIDATION_FAILED; returns sets and unsets. |
| `OnboardingService.apply` | 776 |  | private | One atomic write of changed raw_data keys, progress, location, reopened reviews and capped audit trail. |
| `OnboardingService.assertIdsFree` | 822 |  | private async | Throws ID_IN_USE naming the Aadhaar/PAN fields when another partner already holds the same ID. |
| `OnboardingService.withRetry` | 843 |  | private async | Version-checked write retried on fresh reads up to 3 times, then VERSION_CONFLICT. |
| `OnboardingService.locationUpdate` | 865 |  | private | Returns the form's location as an update fragment, or empty. |
| `OnboardingService.reviewForSubmit` | 877 |  | private | Builds document review states: unchanged verified documents stay verified, others pending, removed ones dropped. |
| `OnboardingService.refreshPreview` | 895 |  | private async | Recomputes the partner preview with pincode place and saves it on the agent only if changed. |
| `OnboardingService.placeOf` | 911 |  | private | Pincode to its state and district via PincodeService, or null. |
| `OnboardingService.view` | 918 |  | private async | Builds the onboarding view: signed file URLs, reviews without sig, editable fields, missing required list. |

### modules/leads

#### `src/modules/leads/controllers/admin-customers.controller.ts`

File role: Controller — HO read-only Customers screen (won leads with business), capability leads.read.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `AdminCustomersController.list` | 25 | `GET /admin/customers` · `@Can(leads.read)` |  | Delegates to CustomersService.adminList: paged won leads with orders, spend, last order. |
| `AdminCustomersController.summary` | 37 | `GET /admin/customers/summary` · `@Can(leads.read)` |  | Delegates to CustomersService.adminSummary: customer cards (total, active 30 days, won this month, top states). |
| `AdminCustomersController.get` | 47 | `GET /admin/customers/:piiId` · `@Can(leads.read)` |  | Delegates to CustomersService.adminGet: one customer's lead detail plus business. |

#### `src/modules/leads/controllers/admin-leads.controller.ts`

File role: Controller — HO farmer-lead list, summary, map dots, detail and partner transfer.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `AdminLeadsController.list` | 35 | `GET /admin/leads` · `@Can(leads.read)` |  | Delegates to LeadsService.list: filtered, sorted, paged leads of all or one partner. |
| `AdminLeadsController.summary` | 47 | `GET /admin/leads/summary` · `@Can(leads.read)` |  | Delegates to LeadsService.summary: totals, today, 7 days, due/overdue, by stage, top partners. |
| `AdminLeadsController.places` | 57 | `GET /admin/leads/places` · `@Can(leads.read)` |  | Delegates to LeadsService.places: map dots for farmers with a place, max 5,000. |
| `AdminLeadsController.get` | 67 | `GET /admin/leads/:piiId` · `@Can(leads.read)` |  | Delegates to LeadsService.get: one farmer with history, activity, partner and previous holders. |
| `AdminLeadsController.transfer` | 77 | `POST /admin/leads/:piiId/transfer` · `@Can(leads.transfer)` |  | Delegates to LeadsService.transfer with the HO email: moves the farmer to another approved partner. |

#### `src/modules/leads/controllers/customers.controller.ts`

File role: Controller — the partner's own Customers screen (list, tiles, detail), partner from token.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `CustomersController.list` | 26 | `GET /customers` |  | Delegates to CustomersService.list: partner's customers with search, crop filter and sorts. |
| `CustomersController.summary` | 38 | `GET /customers/summary` |  | Delegates to CustomersService.summary: total, active 30 days, business, crop chips. |
| `CustomersController.get` | 47 | `GET /customers/:piiId` |  | Delegates to CustomersService.get: one own customer with business, stage history, activity. |

#### `src/modules/leads/controllers/leads.controller.ts`

File role: Controller: partner-facing /leads routes (phone check, consent, farmer OTP, add/list/edit/remove leads, activities).

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `LeadsController.check` | 60 | `GET /leads/check` |  | Phone query, returns whether adding it is new, yours, other partner, katyayani, not farmer or self; delegates to LeadsService.check. |
| `LeadsController.consent` | 72 | `GET /leads/consent` |  | Returns current farmer consent wording and version; delegates to LeadsService.consent. |
| `LeadsController.summary` | 80 | `GET /leads/summary` |  | Returns caller's lead cards and stage counts; delegates to LeadsService.summaryMine. |
| `LeadsController.sendOtp` | 89 | `POST /leads/otp/send` |  | Sends OTP to the farmer's mobile before adding; delegates to LeadsService.sendFarmerOtp. |
| `LeadsController.verifyOtp` | 103 | `POST /leads/otp/verify` |  | Checks farmer OTP and returns a 15-minute otp_token; delegates to LeadsService.verifyFarmerOtp. |
| `LeadsController.upsert` | 117 | `POST /leads` |  | Adds a farmer or updates one the caller holds; delegates to LeadsService.upsert. |
| `LeadsController.list` | 134 | `GET /leads` |  | Caller's leads paged, most urgent first, filtered by stage, due, q; delegates to LeadsService.listMine. |
| `LeadsController.get` | 146 | `GET /leads/:piiId` |  | One of the caller's leads by pii id; delegates to LeadsService.getMine. |
| `LeadsController.update` | 155 | `PATCH /leads/:piiId` |  | Edits stage, follow-up, value or farmer details of caller's lead; delegates to LeadsService.update. |
| `LeadsController.remove` | 168 | `DELETE /leads/:piiId` |  | Removes caller's non-customer lead; delegates to LeadsService.remove. |
| `LeadsController.addActivity` | 180 | `POST /leads/:piiId/activities` |  | Logs call, visit, WhatsApp or note on caller's lead; delegates to LeadsService.addActivity. |

#### `src/modules/leads/controllers/order-events.controller.ts`

File role: Controller — server-to-server webhook from the order service, guarded by a shared secret.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `OrderEventsController.confirmed` | 29 | `POST /hooks/orders/confirmed` · `@Public` |  | Behind OrderEventsGuard, delegates to CustomersService.recordOrder: confirmed order makes the farmer a customer. |

#### `src/modules/leads/controllers/radar.controller.ts`

File role: Controller — the partner's radar of own customers and leads nearby.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `RadarController.around` | 19 | `GET /radar` |  | Delegates to RadarService.around: own farmers and KKD stores within km, nearest first. |

#### `src/modules/leads/dto/customer.dto.ts`

File role: DTO — query DTOs for partner and HO customer lists, and the order-confirmed webhook body.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `trim` | 16 |  | local | Transform: trims a string value, leaves others unchanged. |
| `upper` | 70 |  | local | Transform: trims and upper-cases a string value, leaves others unchanged. |

#### `src/modules/leads/dto/lead.dto.ts`

File role: DTO: validated request shapes for partner and HO lead routes, with trim/boolean transforms.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `trim` | 36 |  | local | Transform: trims a string value, other values pass through. |
| `trimEach` | 39 |  | local | Transform: trims each string in an array, other values pass through. |
| `toBool` | 44 |  | local | Transform: true only for boolean true or the string true. |

#### `src/modules/leads/guards/order-events.guard.ts`

File role: Guard — checks the order service's shared secret header on the order webhook.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `OrderEventsGuard.canActivate` | 25 |  |  | No ORDER_EVENTS_SECRET throws ORDER_EVENTS_NOT_CONFIGURED (503); timing-safe compare of x-webhook-secret, mismatch throws 401. |

#### `src/modules/leads/lead-otp.domain.ts`

File role: Domain: pure HMAC signing and checking of the short-lived farmer OTP token used by POST /leads.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `leadOtpKey` | 38 |  | export | Derives the lead OTP signing key as HMAC-SHA256 of the service secret with a fixed label. |
| `sign` | 41 |  | local | HMAC-SHA256 of a token body, base64url. |
| `signLeadOtp` | 44 |  | export | Builds a signed token for partner and phone, expiring after the lead OTP TTL; returns token and expiry. |
| `readLeadOtp` | 68 |  | export | Verifies token signature, payload, expiry and partner/phone match; returns ok with verified time or a failure reason. |

#### `src/modules/leads/lead-views.ts`

File role: Pure view mappers — turn vistaar_v2_leads rows into the app/HO lead view and detail shapes.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `placeOf` | 40 |  | export | GeoJSON location plus source to a lat/lng place; exact unless source is pincode; null when missing. |
| `viewOf` | 63 |  | export | Row to list view: strips internal fields, adds consent_version, releases_at and place. |
| `detailOf` | 86 |  | export | Row to detail: list view plus stage_history and activities newest first. |

#### `src/modules/leads/leads.domain.ts`

File role: Domain: pure lead rules (holder, release window, location sources, stage moves) and builders for org lead/contact docs.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `holderOf` | 113 |  | export | From partner link, org lead and contact, decides holder: mine, other_partner, released, not_farmer, katyayani or none. |
| `releaseAtOf` | 145 |  | export | Computes when a partner's hold lapses: last work or order (or hold start) plus lead or customer days. |
| `fixFits` | 183 |  | export | True when a GPS fix is inside India and accuracy is unknown or at most 500 m. |
| `replaceableBy` | 193 |  | export | Returns location sources a new fix may overwrite: the same source and weaker ones. |
| `searchOf` | 200 |  | export | Splits a search string into a phone filter (digits, last ten) or a text filter. |
| `isFarmerProfile` | 213 |  | export | True when the contact profile is empty or one of the farmer profiles. |
| `stageMoveError` | 219 |  | export | Refusal message when moving to won or out of won, else null. |
| `isOpenStage` | 226 |  | export | True when the stage is not a closed stage. |
| `followUpMoved` | 230 |  | export | True when the follow-up was set, changed or cleared, compared by timestamp. |
| `farmerBand` | 236 |  | export | Maps acres to ko-sales band: small (5 or less), medium (30 or less), super. |
| `tidy` | 242 |  | local | Trims and collapses whitespace. |
| `titleCase` | 244 |  | export | Tidies text and capitalises each word. |
| `cropsOf` | 253 |  | export | Title-cases crops and drops case-insensitive duplicates, keeping the first spelling. |
| `splitName` | 266 |  | export | Lower-cased first word as first_name, the rest as last_name. |
| `farmDetailsOf` | 274 |  | export | Builds farm details: area, unit, acreage band and crop list. |
| `zeroCalls` | 289 |  | local | Returns a zeroed call-count object. |
| `leadDocOf` | 303 |  | export | Builds a new leads_v2 document with ko-sales defaults, owner, source vistaar, created_by partner, no profiled_at. |
| `contactDocOf` | 360 |  | export | Builds a new contacts_v2 document with farmer profile, farm details and source vistaar. |
| `leadUpdateOf` | 399 |  | export | Builds the $set for a re-submit on a Vistaar-created lead: name, state, pincode, updater, time. |
| `contactUpdateOf` | 414 |  | export | Builds the $set for a re-submit on a Vistaar contact: name, band, farm details, updater, time. |
| `farmerCopyOf` | 429 |  | export | Builds the farmer basics copied onto the vistaar_v2_leads row (name, phone, village, place, crops, acreage). |
| `inviteOrder` | 446 |  | export | Sorts rows with the meeting's village first, then by name. |

#### `src/modules/leads/repositories/kkd-store.repository.ts`

File role: Repository — read-only access to the franchise app's `franchises` collection for radar stores.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `KkdStoreRepository.all` | 28 |  | async | Reads up to 5,000 `franchises` with coordinates, mapped to id, city, address, phone, lat, lng. |

#### `src/modules/leads/repositories/org-leads.repository.ts`

File role: Repository: driver-level reads and writes on shared leads_v2 and contacts_v2, updates filtered on source vistaar.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `insertResultOf` | 28 |  | local | Maps a duplicate-key error to taken_person (pii_id) or taken_id; rethrows anything else. |
| `OrgLeadsRepository.leadOf` | 50 |  |  | Reads lead_id, source, created_by of the leads_v2 row for a pii id. |
| `OrgLeadsRepository.contactOf` | 58 |  |  | Reads profile and source of the contacts_v2 row for a pii id. |
| `OrgLeadsRepository.insertLead` | 67 |  | async | Inserts a leads_v2 document as built, owner ref as ObjectId; returns ok or taken result. |
| `OrgLeadsRepository.insertContact` | 89 |  | async | Inserts a contacts_v2 document as built; returns ok or taken result. |
| `OrgLeadsRepository.updateLead` | 98 |  | async | $set on the leads_v2 row by lead_id, only when source is vistaar. |
| `OrgLeadsRepository.setFollowUp` | 112 |  | async | Sets only follow_up_date on the leads_v2 row by lead_id, source vistaar only. |
| `OrgLeadsRepository.updateContact` | 119 |  | async | $set on the contacts_v2 row by pii_id, only when source is vistaar. |

#### `src/modules/leads/repositories/vistaar-leads.repository.ts`

File role: Repository: queries, updates and aggregations on vistaar_v2_leads (partner farmer rows).

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `escapeRegex` | 98 |  | local | Escapes regex special characters in a string. |
| `isDuplicateKey` | 101 |  | local | True for a Mongo E11000 duplicate-key error. |
| `VistaarLeadsRepository.findByPiis` | 112 |  |  | Reads name, phone, village, district of vistaar_v2_leads rows for many pii ids. |
| `VistaarLeadsRepository.findByPii` | 132 |  |  | Reads the vistaar_v2_leads row for one pii id. |
| `VistaarLeadsRepository.findMineByPhones` | 140 |  |  | Reads pii id, phone, stage of a partner's vistaar_v2_leads rows among given mobiles. |
| `VistaarLeadsRepository.isHeldBy` | 152 |  | async | True when a vistaar_v2_leads row exists for this pii id and partner. |
| `VistaarLeadsRepository.insert` | 160 |  | async | Inserts a vistaar_v2_leads row; false on duplicate pii id. |
| `VistaarLeadsRepository.update` | 177 |  |  | findOneAndUpdate on partner's vistaar_v2_leads row, guarded by expected stage/customer_at; returns new row or null. |
| `VistaarLeadsRepository.setLocation` | 198 |  | async | Sets location on partner's vistaar_v2_leads row only if current source is replaceable; true if changed. |
| `VistaarLeadsRepository.nearby` | 226 |  |  | Partner's non-lost vistaar_v2_leads rows within km of a point, capped, radar fields. |
| `VistaarLeadsRepository.countUnplaced` | 249 |  |  | Counts partner's non-lost vistaar_v2_leads rows with no location. |
| `VistaarLeadsRepository.placedByPincodeOrNot` | 260 |  |  | Reads rows with a pincode and no place or a pincode-only place, for the backfill. |
| `VistaarLeadsRepository.remove` | 279 |  | async | Deletes partner's vistaar_v2_leads row unless won; true if deleted. |
| `VistaarLeadsRepository.all` | 290 |  |  | All matching vistaar_v2_leads briefs, newest first, capped at 5000. |
| `VistaarLeadsRepository.takeOver` | 305 |  |  | findOneAndUpdate guarded on holder and updated_at, moving the farmer to another partner; null if changed. |
| `VistaarLeadsRepository.listByUrgency` | 329 |  | async | Aggregates vistaar_v2_leads: open overdue, with follow-up, without, closed last; paged with total. |
| `VistaarLeadsRepository.listRecent` | 380 |  | async | Paged vistaar_v2_leads briefs with total, sorted (default newest first), for HO. |
| `VistaarLeadsRepository.partnerSummary` | 401 |  | async | Aggregates one partner's vistaar_v2_leads: totals, open, pipeline value, won, lost, due, stage counts. |
| `VistaarLeadsRepository.performance` | 486 |  | async | Aggregates leads added in a range by outcome plus overdue open follow-ups for one partner. |
| `VistaarLeadsRepository.holdings` | 541 |  |  | Aggregates open leads and customers per partner, for given partners or all. |
| `VistaarLeadsRepository.countsByPartner` | 565 |  | async | Aggregates farmers and customers count per partner on vistaar_v2_leads. |
| `VistaarLeadsRepository.customerSummary` | 584 |  | async | Aggregates won rows: total, active, new this month, top states, partners, crops. |
| `VistaarLeadsRepository.places` | 648 |  |  | Reads matching vistaar_v2_leads rows with a location, map-dot fields only, capped. |
| `VistaarLeadsRepository.adminSummary` | 671 |  | async | Aggregates HO cards: totals, today, last 7 days, partners, due today, overdue, by stage and partner. |
| `VistaarLeadsRepository.toQuery` | 757 |  | private | Builds the Mongo filter from a lead list filter (partner, stage, place, dates, phone, text). |

#### `src/modules/leads/services/customers.service.ts`

File role: Service: customers (won leads) for app and HO, plus the confirmed-order hook that marks a lead won.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `byLatestOrder` | 105 |  | local | Sort comparator: latest last order first. |
| `CustomersService.adminList` | 133 |  | async | HO paged list of won leads with their confirmed business from orders. |
| `CustomersService.adminSummary` | 153 |  | async | HO customer cards from repository summary, with partner names attached. |
| `CustomersService.adminGet` | 172 |  | async | HO one customer with business and average order; NOT_FOUND unless the lead is won. |
| `CustomersService.recordOrder` | 192 |  | async | Order-confirmed hook: first order sets lead won, later ones move last order; ignores unheld; retries, else LEADS_UNAVAILABLE. |
| `CustomersService.list` | 267 |  | async | Partner's customers filtered by search, crop and ordered-in month, sorted and paged in memory. |
| `CustomersService.summary` | 292 |  | async | Partner's customer tiles: total, active 30 days, total business, crop chips. |
| `CustomersService.get` | 321 |  | async | One of the partner's won customers with business; NOT_FOUND otherwise. |
| `CustomersService.customersOf` | 341 |  | private async | Partner's won rows joined with their order business and release window. |
| `CustomersService.window` | 357 |  | private async | Reads lead and customer release days from settings. |
| `businessOf` | 366 |  | local | Orders, spend and last order stage, zero/null defaults. |
| `customerOf` | 374 |  | local | Builds a customer view from a row, its business and release window. |
| `activity` | 386 |  | local | Builds a system stage_change activity entry. |

#### `src/modules/leads/services/lead-otp.service.ts`

File role: Service: sends and verifies the farmer OTP and issues/checks the lead OTP token.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `LeadOtpService.send` | 29 |  |  | Sends the farmer OTP via OtpService with the lead purpose; delegates. |
| `LeadOtpService.verify` | 34 |  | async | Verifies the farmer OTP, then signs a lead OTP token for partner and phone. |
| `LeadOtpService.check` | 49 |  |  | Validates the otp_token; returns verified time or throws LEAD_OTP_REQUIRED / LEAD_OTP_INVALID. |

#### `src/modules/leads/services/leads.service.ts`

File role: Service: farmer-lead business rules for partners and HO: add/claim, edit, remove, transfer, location, org record writes.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `taken` | 166 |  | local | Builds FARMER_TAKEN conflict error. |
| `selfLead` | 172 |  | local | Builds SELF_LEAD bad-request error. |
| `notFarmer` | 175 |  | local | Builds NOT_A_FARMER conflict error. |
| `LeadsService.onModuleInit` | 213 |  |  | Registers holdings as the earning-cohorts holdings source. |
| `LeadsService.holdings` | 218 |  | async | Map of partner to open leads and customers counts. |
| `LeadsService.check` | 231 |  | async | Classifies a phone (new, self, or holder status) without writing. |
| `LeadsService.consent` | 243 |  | async | Returns the farmer consent wording from settings. |
| `LeadsService.sendFarmerOtp` | 248 |  | async | Approved partner only: sends farmer OTP, returns resend wait. |
| `LeadsService.verifyFarmerOtp` | 259 |  | async | Approved partner only: verifies farmer OTP, returns otp_token. |
| `LeadsService.upsert` | 273 |  | async | Adds or takes over a farmer after consent, OTP and holder checks (FARMER_TAKEN, NOT_A_FARMER, CONSENT_OUTDATED); writes org records, rewards. |
| `LeadsService.claimOrUpdate` | 424 |  | private async | Inserts the partner's vistaar_v2_leads row or refreshes their own; FARMER_TAKEN if another claimed first. |
| `LeadsService.listMine` | 492 |  | async | Partner's leads paged by urgency with search, stage and due-today filters. |
| `LeadsService.summaryMine` | 517 |  | async | Partner's lead cards plus conversion percent. |
| `LeadsService.performance` | 534 |  | async | Leads added in a range, won, lost, conversion and overdue follow-ups. |
| `LeadsService.farmersByPii` | 567 |  | async | Map of pii id to farmer card for HO cart lists. |
| `LeadsService.invitees` | 590 |  | async | Partner's non-lost leads and customers for meeting invites, village first. |
| `LeadsService.mineByPhones` | 612 |  | async | Map of mobile to partner's own lead pii id and stage. |
| `LeadsService.heldFarmers` | 626 |  | async | Lists the farmers a partner holds (capped) with basics and hold start, for the KKD activity reads. |
| `LeadsService.holds` | 641 |  | async | True when the partner holds this farmer; delegates to repository. |
| `LeadsService.getMine` | 645 |  | async | Partner's own lead detail; NOT_FOUND otherwise. |
| `LeadsService.update` | 653 |  | async | Applies stage, lost reason, follow-up, value and detail edits; STAGE_NOT_ALLOWED, STAGE_CHANGED; syncs org records and location. |
| `LeadsService.remove` | 783 |  | async | Deletes partner's non-won lead, clears mirrored follow-up, removes rewards; STAGE_NOT_ALLOWED for customers. |
| `LeadsService.mirrorFollowUp` | 812 |  | async | Copies a changed follow-up to the leads_v2 follow_up_date; logs failures. |
| `LeadsService.editOf` | 828 |  | private async | Builds the edited farmer and place from sent details, null if none sent. |
| `LeadsService.addActivity` | 867 |  | async | Appends an activity, renews hold, credits follow-up reward, sets visit location; NOT_FOUND if not held. |
| `LeadsService.recordLocation` | 915 |  | async | Stores an order-time GPS fix for a farmer the partner holds. |
| `LeadsService.placeByPincode` | 931 |  | async | Backfill: gives unplaced or pincode-placed farmers their pincode centre; returns change count. |
| `LeadsService.list` | 952 |  | async | HO paged lead list with filters and sort, partner info attached. |
| `LeadsService.places` | 991 |  | async | HO map dots for farmers with a place, up to 5000, with capped flag. |
| `LeadsService.countsByPartner` | 1045 |  | async | Map of partner to farmers and customers counts. |
| `LeadsService.partnerNames` | 1058 |  |  | Partner id and name by VST id; delegates to agents service. |
| `LeadsService.summary` | 1063 |  | async | HO lead cards for the IST day, with partner names. |
| `LeadsService.get` | 1082 |  | async | HO lead detail by pii id; NOT_FOUND if missing. |
| `LeadsService.transfer` | 1093 |  | async | HO moves a farmer to another approved partner; VALIDATION_FAILED, PARTNER_NOT_APPROVED, STAGE_CHANGED. |
| `LeadsService.adminDetailOf` | 1154 |  | private async | Builds HO lead detail with partner and holder history. |
| `LeadsService.mine` | 1168 |  | private async | Reads the partner's own row; NOT_FOUND otherwise. |
| `LeadsService.found` | 1178 |  | private async | Reads partner link, org lead and org contact for a pii id. |
| `LeadsService.holder` | 1187 |  | private async | Works out the holder status for a pii id and partner. |
| `LeadsService.lapseOf` | 1198 |  | private async | Returns released or partner_blocked when another partner's hold ended, else null. |
| `LeadsService.window` | 1210 |  | private async | Reads lead and customer release days from settings. |
| `LeadsService.spotFrom` | 1223 |  | private async | Picks location from a fitting GPS fix, else pincode centre, else none. |
| `LeadsService.applySpot` | 1253 |  | private async | Stores the spot if not weaker than current; real fixes also set geo on the address row. |
| `LeadsService.freshHold` | 1279 |  | private | Fields for a new holder: prospect (won stays won), fresh history, hold times. |
| `LeadsService.holdEnd` | 1297 |  | private | Builds a holder-history entry for the ending hold. |
| `LeadsService.writeOrgRecords` | 1319 |  | private async | Creates or refreshes Vistaar's leads_v2, contacts_v2 and address row; returns lead id. |
| `LeadsService.createLead` | 1370 |  | private async | Inserts leads_v2 with L- id from app_counters, retrying; links on taken person; LEADS_UNAVAILABLE. |
| `LeadsService.createContact` | 1392 |  | private async | Inserts contacts_v2 with C0- id from app_counters, retrying; LEADS_UNAVAILABLE. |
| `LeadsService.leadOwner` | 1415 |  | private async | Named owner or the single active Offline Head; LEADS_NOT_CONFIGURED otherwise. |
| `LeadsService.requireWorkingPartner` | 1430 |  | private async | Returns partner if approved and active; ACCOUNT_BLOCKED or PARTNER_NOT_APPROVED. |
| `LeadsService.placeOf` | 1448 |  | private async | State and district from pincode, else partner's state. |
| `LeadsService.phoneOf` | 1461 |  | private | Normalises a mobile; INVALID_PHONE if not valid. |
| `LeadsService.futureOf` | 1472 |  | private | Parses a follow-up date; VALIDATION_FAILED unless in the future. |
| `LeadsService.activity` | 1483 |  | private | Builds an activity entry with a new UUID. |
| `LeadsService.unavailable` | 1492 |  | private | Builds LEADS_UNAVAILABLE service-unavailable error. |
| `endOfToday` | 1503 |  | local | Last millisecond of today in IST. |
| `adminSort` | 1507 |  | local | Parses HO sort key to a Mongo sort; VALIDATION_FAILED for unknown keys. |

#### `src/modules/leads/services/radar.service.ts`

File role: Service — radar: the partner's own farmers and KKD stores around a centre, with customer business.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `RadarService.around` | 96 |  | async | Nearby own farmers sorted by distance with business for customers, unplaced count, nearby stores. |
| `RadarService.storesAround` | 174 |  | private async | KKD stores within km from an in-memory cached book; read failure returns none. |
| `RadarService.centreOf` | 210 |  | private async | Centre from GPS (both or none, India only), else signup point, else pincode; else VALIDATION_FAILED. |

### modules/today

#### `src/modules/today/controllers/today.controller.ts`

File role: Controller — the partner's Home "Today's tasks", partner from token.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `TodayController.get` | 19 | `GET /today` |  | Delegates to TodayService.get: the partner's tasks for today. |

#### `src/modules/today/services/today.service.ts`

File role: Service — gathers six task sources in parallel and builds Today's tasks; stores nothing.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `TodayService.get` | 38 |  | async | Reads due leads, saved carts, events, meetings, gigs, placed orders in parallel; failed sources skipped; builds view. |
| `TodayService.settled` | 70 |  | private | Returns a fulfilled value, or logs a warning and returns null. |

#### `src/modules/today/today.domain.ts`

File role: Domain — pure builders turning each source into dated, urgency-flagged tasks and the Today view.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `byAt` | 187 |  | local | Sorter: earliest task at first. |
| `followUpTasks` | 189 |  | export | Due leads with a follow-up to tasks; urgent when overdue by IST days. |
| `savedCartTasks` | 212 |  | export | Un-reminded carts for a farmer to tasks; urgent after CART_URGENT_DAYS idle. |
| `eventTasks` | 234 |  | export | Registered events today or tomorrow (IST) to tasks; urgent when today. |
| `meetingTasks` | 255 |  | export | Meetings today or tomorrow (IST) to tasks with invited count; urgent when today. |
| `gigTasks` | 281 |  | export | Gigs today or tomorrow (IST) to tasks with payout and status; urgent when today. |
| `orderTasks` | 304 |  | export | Placed orders, excluding NOT_AN_ORDER statuses, to non-urgent tasks oldest first. |
| `todayOf` | 320 |  | export | Builds all task groups, concatenates in TASK_TYPES order, returns items with counts. |

### modules/kkd-activity

#### `src/modules/kkd-activity/controllers/kkd-activity.controller.ts`

File role: KKD activity controller: the partner's farmers' KKD and app activity feed, month tiles and nearby stores, identity from the token.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `KkdActivityController.feed` | 27 | `GET /kkd-activity` |  | Answers the partner's farmers' KKD store and app activity, newest first, paged and filterable by farmer, channel and IST dates. |
| `KkdActivityController.summary` | 39 | `GET /kkd-activity/summary` |  | Answers the KKD screen tiles for an IST month: walk-ins, store orders, app orders and open app carts. |
| `KkdActivityController.stores` | 51 | `GET /kkd-activity/stores` |  | Answers KKD stores within 50 km of where the partner registered, nearest first. |

#### `src/modules/kkd-activity/dto/kkd-activity.dto.ts`

File role: KKD activity DTOs: validate the feed's farmer, channel and IST date filters and the summary's month.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `upper` | 14 |  | local | Trims and upper-cases a farmer id query value before validation. |

#### `src/modules/kkd-activity/kkd-activity.domain.ts`

File role: KKD activity domain: pure rules that match records to held farmers, merge sources, label lines, compute tiles and nearby stores.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `text` | 204 |  | local | Turns a stored string or number into trimmed text, or null when empty. |
| `cityName` | 210 |  | local | Names a store 'Katyayani Krishi Kendra · <city>' as the Nearby radar does, since warehouse names are internal. |
| `storeBookOf` | 213 |  | export | Builds the store book from franchise rows: stores by id, plus lookups by warehouse and POS login email; StockShip's row wins. |
| `indexFarmers` | 255 |  | export | Indexes the partner's held farmers by pii_id and normalised mobile for record matching. |
| `ownerOf` | 267 |  | export | Finds which held farmer a record is about: by pii_id first, else by mobile (TL allowed phone match). |
| `storeOfOrder` | 283 |  | export | Finds the store an MKTP-4 order was sold at, by POS login then warehouse; company (founder_office) orders get none. |
| `isSale` | 299 |  | export | Says whether an order status is a real sale: counted, and not cancelled or returned. |
| `lineLabel` | 305 |  | export | Labels an item line as its name, with '×qty' when more than one. |
| `catalogueLine` | 309 |  | local | Labels an order line by SKU from the catalogue, with name and pack size, falling back to the SKU. |
| `rupees` | 321 |  | local | Rounds an amount to whole rupees, or null when not a finite number. |
| `storeName` | 324 |  | local | Gives a store's display name from the book, else the generic KKD name, or null without an id. |
| `after` | 327 |  | local | Says whether a record date falls on or after the farmer's hold began. |
| `activitiesOf` | 335 |  | export | Merges orders, POS archive, walk-ins, advice and app events into one newest-first list for held farmers after the hold, deduplicating. |
| `filterActivities` | 508 |  | export | Filters activities by farmer, channel and an IST date range. |
| `add` | 535 |  | local | Adds one activity's count and amount to a money tile. |
| `summaryOf` | 541 |  | export | Computes the month's walk-in, store-order and app-order tiles, plus app carts not followed by an app order, any month. |
| `storesWithin` | 585 |  | export | Lists stores with a map point within the given km of a centre, with rounded distance, nearest first. |

#### `src/modules/kkd-activity/repositories/farmer-orders.repository.ts`

File role: KKD activity repository: reads held farmers' app, website and store orders from orders_v2 (read-only).

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `FarmerOrdersRepository.since` | 37 |  | async | Reads held farmers' MKTP-2/3/4 orders from orders_v2 since a date, newest first and capped, riding {pii_id, date} (read-only). |

#### `src/modules/kkd-activity/repositories/kkd-events.repository.ts`

File role: KKD activity repository: reads the Katyayani app's app opens and abandoned carts from kkd_events (read-only).

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `KkdEventsRepository.since` | 30 |  | async | Reads app-open and abandoned-cart events from kkd_events by farmer mobile since a date, newest first, capped (read-only). |

#### `src/modules/kkd-activity/repositories/store-activity.repository.ts`

File role: KKD activity repository: reads the franchise backend's walk-ins, prescriptions and POS archive (read-only).

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `anyOf` | 12 |  | local | Builds a match on pii_id or phone, since many franchise rows carry only the phone. |
| `StoreActivityRepository.walkins` | 28 |  | async | Reads franchise_v2_walkins for the farmers by pii_id or phone since a date, newest first, capped (read-only). |
| `StoreActivityRepository.prescriptions` | 57 |  | async | Reads franchise_v2_prescriptions (crop advice) for the farmers by pii_id or phone since a date, newest first, capped (read-only). |
| `StoreActivityRepository.posOrders` | 89 |  | async | Reads the old POS archive franchise_v2_pos_orders for the farmers by pii_id or phone since a date, newest first, capped. |

#### `src/modules/kkd-activity/repositories/store-directory.repository.ts`

File role: KKD activity repository: reads every franchise / KKD store and its POS logins from three collections (read-only).

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `StoreDirectoryRepository.load` | 38 |  | async | Reads every store from franchises and franchise_v2_franchises plus POS logins (employees email + franchiseId only), read-only. |

#### `src/modules/kkd-activity/repositories/stored-id.ts`

File role: KKD activity helper: normalises a warehouse id stored as a string or an ObjectId.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `idString` | 4 |  | export | Turns a stored warehouse id, a WH- string or an ObjectId, into a string, or null. |

#### `src/modules/kkd-activity/services/kkd-activity.service.ts`

File role: KKD activity service: loads, caches and filters the partner's farmers' activity, month tiles and stores within 50 km.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `KkdActivityService.feed` | 77 |  | async | Checks a named farmer is held, then pages the partner's cached activity filtered by farmer, channel and IST days. |
| `KkdActivityService.summary` | 97 |  | async | Checks a named farmer is held, then computes the month's tiles from the partner's cached activity, default this month. |
| `KkdActivityService.stores` | 109 |  | async | Finds stores within 50 km of the partner's signup point, else their pincode centre; empty when neither is known. |
| `KkdActivityService.requireHeld` | 131 |  | private async | Rejects with not found when the farmer is not held by the partner. |
| `KkdActivityService.activities` | 137 |  | private | Returns the partner's activity list from the per-process cache, loading it on a miss. |
| `KkdActivityService.storeBook` | 141 |  | private | Returns the store book from the per-process cache, building it from the directory on a miss. |
| `KkdActivityService.load` | 147 |  | private async | Reads held farmers and every source in parallel since the oldest hold; a failed source is logged and left out, not fatal. |
| `KkdActivityService.settled` | 182 |  | private | Unwraps a settled read, or logs a warning naming the missing source and returns null. |

### modules/attendance

#### `src/modules/attendance/attendance.domain.ts`

File role: Domain — pure attendance rules: IST dates, day status, punch-location checks, month/board/range roll-ups.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `istDate` | 43 |  | export | Converts a Date to its IST calendar day as YYYY-MM-DD. |
| `istMonth` | 48 |  | export | Returns the IST month YYYY-MM of a Date. |
| `monthBounds` | 53 |  | export | Returns from = month-01 and to = month-31 string bounds for a month key. |
| `dayStatus` | 71 |  | export | Classifies a day as not_started, day_closed, on_duty (today, open) or missed_punch_out (past, open). |
| `locationError` | 82 |  | export | Validates a punch location: label required; registered must have no coords, GPS must have valid coords; returns message or null. |
| `sessionMs` | 99 |  | export | Returns non-negative milliseconds between punch-in and punch-out. |
| `summarize` | 114 |  | export | Month summary from days: present days, closed days, worked ms and average per closed day. |
| `shiftDate` | 130 |  | export | Moves a YYYY-MM-DD date back by n days (forward if n negative). |
| `boardSummary` | 149 |  | export | Counts board rows per status and totals/averages worked ms over present partners. |
| `daysInRange` | 187 |  | export | Inclusive number of days between two YYYY-MM-DD dates. |
| `istMinutes` | 195 |  | export | Minutes since IST midnight for a Date. |
| `rangeError` | 201 |  | export | Returns an error if from is after to or the range exceeds RANGE_MAX_DAYS (366); else null. |
| `rollup` | 240 |  | export | Per-partner range roll-up: present/closed/missed/late/full/no-GPS/break days, averages, day mark string and per-day minutes. |

#### `src/modules/attendance/controllers/admin-attendance.controller.ts`

File role: Controller — HO attendance reads (day board, date range, one partner's month) under /admin/attendance.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `AdminAttendanceController.board` | 25 | `GET /admin/attendance` · `@Can(attendance.read)` |  | Delegates to AdminAttendanceService.board with the optional date. |
| `AdminAttendanceController.range` | 35 | `GET /admin/attendance/range` · `@Can(attendance.read)` |  | Delegates to AdminAttendanceService.range with from and to. |
| `AdminAttendanceController.partner` | 45 | `GET /admin/attendance/partners/:agentId` · `@Can(attendance.read)` |  | Delegates to AdminAttendanceService.partner for the agent and optional month. |

#### `src/modules/attendance/controllers/attendance.controller.ts`

File role: Controller — partner attendance: today, punch in/out (throttled 10/min), month view.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `AttendanceController.today` | 39 | `GET /attendance/today` |  | Delegates to AttendanceService.today for the token's partner. |
| `AttendanceController.punchIn` | 46 | `POST /attendance/punch-in` |  | Delegates to AttendanceService.punchIn with the location DTO. |
| `AttendanceController.punchOut` | 64 | `POST /attendance/punch-out` |  | Delegates to AttendanceService.punchOut with the location DTO. |
| `AttendanceController.month` | 81 | `GET /attendance` |  | Delegates to AttendanceService.month for the optional month. |

#### `src/modules/attendance/repositories/attendance.repository.ts`

File role: Repository — reads and atomic session writes on `vistaar_v2_attendance` (one row per partner per IST day).

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `AttendanceRepository.find` | 41 |  |  | Reads one partner-day row by `_id` agent:date from `vistaar_v2_attendance`. |
| `AttendanceRepository.countDays` | 50 |  |  | Counts a partner's day rows between two dates by `_id` range. |
| `AttendanceRepository.range` | 61 |  |  | Lists a partner's day rows in a date range, newest first, capped at 31. |
| `AttendanceRepository.onDate` | 77 |  |  | Lists every partner's row for one date (cap 5000). |
| `AttendanceRepository.inRange` | 86 |  |  | Lists all partners' rows in a date range with a slim projection (cap 400k). |
| `AttendanceRepository.perDay` | 95 |  |  | Aggregates per date: rows present and summed worked_ms. |
| `AttendanceRepository.openSession` | 119 |  | async | Upserts the day row pushing a new session if not punched in and under 10 sessions; null on duplicate-key. |
| `AttendanceRepository.closeSession` | 164 |  |  | Conditionally sets the open session's out time/location, clears punched_in, adds worked ms; null if changed. |

#### `src/modules/attendance/schemas/attendance-day.schema.ts`

File role: Schema — `vistaar_v2_attendance` day row with embedded punch sessions and locations; index on date.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `attendanceDayId` | 64 |  | export | Builds the row `_id` as agentId:date. |

#### `src/modules/attendance/services/admin-attendance.service.ts`

File role: Service — HO attendance views: day board with 14-day trend, multi-day range roll-up, one partner's month.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `AdminAttendanceService.board` | 110 |  | async | Builds one day's board for all approved partners plus unknown punchers, summary and 14-day trend. |
| `AdminAttendanceService.range` | 158 |  | async | Validates range (VALIDATION_FAILED), rolls up each partner over it, per-day trend and totals. |
| `AdminAttendanceService.partner` | 236 |  | async | Requires the agent, returns AttendanceService.month for them plus a partner reference. |
| `refOf` | 247 |  | local | Maps an agent record to PartnerRef (name, phone, cohort, district, state from profile or preview). |
| `bareRef` | 258 |  | local | PartnerRef with only agent_id, other fields null. |
| `toRow` | 267 |  | local | Builds a board row: status, punch times, worked ms, last location, sessions. |

#### `src/modules/attendance/services/attendance.service.ts`

File role: Service — partner punch-in/out rules and day/month views at server IST time.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `AttendanceService.today` | 41 |  | async | Reads today's IST row and returns its day view. |
| `AttendanceService.punchIn` | 46 |  | async | Validates location, opens a session; else throws ALREADY_PUNCHED_IN, PUNCH_LIMIT_REACHED or ATTENDANCE_CHANGED. |
| `AttendanceService.punchOut` | 73 |  | async | Closes today's open session with location; NOT_PUNCHED_IN if none today, ATTENDANCE_CHANGED on race. |
| `AttendanceService.recordStreak` | 108 |  | private async | Counts consecutive attended IST days back from today within the lookback window and stores the streak. |
| `AttendanceService.fieldDays` | 129 |  |  | Counts a partner's attendance days in a month. |
| `AttendanceService.month` | 134 |  | async | Returns a month's day views (default current IST month) and summary. |
| `checkedLocation` | 148 |  | local | Builds a trimmed location from the DTO; throws VALIDATION_FAILED if locationError fails. |
| `changed` | 162 |  | local | Returns the ATTENDANCE_CHANGED conflict error. |
| `toDayView` | 169 |  | local | Maps a day row (or null) to the app day view with status and last location. |

### modules/cart

#### `src/modules/cart/cart.domain.ts`

File role: Domain — pure cart-line rules: build lines, stock/line caps, quantity changes, restore, totals, re-pricing.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `lineFrom` | 44 |  | export | Builds a B2B-shape cart line from a catalog variant and quantity. |
| `cap` | 68 |  | local | Caps quantity at available stock and MAX_QUANTITY (9999). |
| `addItem` | 76 |  | export | Adds or increases a SKU line, capped; fails OUT_OF_STOCK or CART_LIMIT_REACHED (100 lines). |
| `setQuantity` | 103 |  | export | Sets a line's quantity (0 removes); fails NOT_IN_CART or OUT_OF_STOCK. |
| `removeItem` | 123 |  | export | Drops the line with the SKU. |
| `restoreLines` | 135 |  | export | Rebuilds lines from saved SKU/quantity pairs, skipping unknown or failing SKUs. |
| `totalsOf` | 157 |  | export | Returns total quantity and money-rounded subtotal. |
| `priceLines` | 181 |  | export | Re-prices lines from the catalog with mrp, size, stock, availability and price-changed flags. |

#### `src/modules/cart/controllers/admin-cart.controller.ts`

File role: Controller — HO list of partners' non-empty carts.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `AdminCartController.list` | 17 | `GET /admin/carts` · `@Can(orders.read)` |  | Delegates to AdminCartService.list with the query. |

#### `src/modules/cart/controllers/cart.controller.ts`

File role: Controller — partner's active cart: read, add/update/remove item, set customer, clear (uses B2B token for catalog).

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `CartController.get` | 48 | `GET /cart` |  | Delegates to CartService.get. |
| `CartController.addItem` | 58 | `POST /cart/items` |  | Delegates to CartService.addItem. |
| `CartController.updateItem` | 72 | `PATCH /cart/items/:sku` |  | Delegates to CartService.updateItem with SKU and quantity. |
| `CartController.removeItem` | 86 | `DELETE /cart/items/:sku` |  | Delegates to CartService.removeItem. |
| `CartController.setCustomer` | 97 | `PUT /cart/customer` |  | Delegates to CartService.setCustomer. |
| `CartController.clear` | 110 | `DELETE /cart` |  | Delegates to CartService.clear. |

#### `src/modules/cart/repositories/cart.repository.ts`

File role: Repository — reads/writes the partner's active row in shared `carts` (source vistaar, `_id` derived from partner).

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `activeCartId` | 31 |  | export | Derives a deterministic ObjectId from a SHA-256 of source and partner id. |
| `CartRepository.findActive` | 42 |  |  | Reads the partner's active cart from `carts` by `_id` + source. |
| `CartRepository.insertActive` | 50 |  | async | Inserts the active cart in `carts`; false on duplicate key. |
| `CartRepository.updateActive` | 67 |  | async | Updates `carts` row if `__v` matches, unsets user_id, bumps `__v`; returns matched. |
| `CartRepository.adminList` | 92 |  | async | Pages non-empty vistaar `carts` by ids, last updated first, with total count. |
| `CartRepository.activeFilter` | 116 |  | private | Returns filter `_id` = activeCartId + source vistaar. |

#### `src/modules/cart/services/admin-cart.service.ts`

File role: Service — HO cart list joined with partner and farmer details.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `AdminCartService.list` | 36 |  | async | Pages carts of one or all verified partners, joins partners and farmers into views. |
| `viewOf` | 71 |  | local | Builds an HO cart view; customer only when pii_id is not the partner's own. |
| `lineOf` | 91 |  | local | Maps a stored cart line to an HO line with size label and line total. |

#### `src/modules/cart/services/cart.service.ts`

File role: Service - partner's active cart on shared carts: add, update, remove, customer, clear, replace, priced view, retry-safe writes.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `CartService.canOrder` | 66 |  | private | Requires the partner to be a working (approved) partner to place orders. |
| `CartService.canOrderFor` | 74 |  | private async | Runs the partner check and the customer check together; partner refusal reported first. |
| `CartService.get` | 84 |  | async | Reads the partner's active cart and returns the priced cart view. |
| `CartService.addItem` | 92 |  | async | Checks partner can order and sku is sellable, adds the line; OUT_OF_STOCK or CART_LIMIT_REACHED on failure. |
| `CartService.updateItem` | 108 |  | async | Checks partner can order, sets a line's quantity against current stock and price. |
| `CartService.removeItem` | 126 |  |  | Removes a sku line from the cart; NOT_IN_CART answered as 404. |
| `CartService.setCustomer` | 136 |  | async | Checks partner and customer, sets the cart's farmer; records the farmer's location when given. |
| `CartService.noteWhere` | 153 |  | private async | Saves the farmer's location via LeadsService; logs and never fails the cart. |
| `CartService.clear` | 168 |  |  | Empties the cart lines and clears the customer. |
| `CartService.replace` | 177 |  | async | Checks partner and customer, replaces cart lines re-priced at today's catalogue (draft resume), unsold left out. |
| `CartService.requireCustomer` | 201 |  | async | Allows own stock or a farmer the partner holds in Leads, else 404. |
| `CartService.mutate` | 219 |  | private | Queues a cart change per partner on this instance, then writes it. |
| `CartService.writeActive` | 229 |  | private async | Read, change, version-checked insert or update on carts with jittered retries; CART_BUSY after max attempts. |
| `CartService.sellable` | 261 |  | private async | Sku to its catalogue variant, or 404 if no longer sold. |
| `CartService.view` | 267 |  | private async | Builds the cart view: lines priced from catalogue, totals, availability flags, customer. |
| `pause` | 321 |  | local | Promise that resolves after the given milliseconds. |
| `applied` | 326 |  | local | Domain cart change to lines, or throws OUT_OF_STOCK, CART_LIMIT_REACHED or not-found. |
| `customerOf` | 348 |  | local | Cart pii_id to the app's customer, null when it is the partner's own stock. |
| `writeOf` | 355 |  | local | Lines and pii_id to a cart write with subtotal and total. |

### modules/draft-order

#### `src/modules/draft-order/controllers/admin-draft-order.controller.ts`

File role: Controller — HO list of partners' open draft orders.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `AdminDraftOrderController.list` | 17 | `GET /admin/draft-orders` · `@Can(orders.read)` |  | Delegates to AdminDraftOrderService.list. |

#### `src/modules/draft-order/controllers/draft-order.controller.ts`

File role: Controller — partner draft orders: save cart as draft, list, get, restore to cart, mark reminder, delete.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `DraftOrderController.save` | 49 | `POST /draft-orders` |  | Delegates to DraftOrderService.save. |
| `DraftOrderController.list` | 63 | `GET /draft-orders` |  | Delegates to DraftOrderService.list. |
| `DraftOrderController.get` | 72 | `GET /draft-orders/:id` |  | Delegates to DraftOrderService.get. |
| `DraftOrderController.restore` | 82 | `POST /draft-orders/:id/restore` |  | Delegates to DraftOrderService.restore. |
| `DraftOrderController.markReminderSent` | 97 | `POST /draft-orders/:id/reminder` |  | Delegates to DraftOrderService.markReminderSent. |
| `DraftOrderController.delete` | 108 | `DELETE /draft-orders/:id` |  | Delegates to DraftOrderService.delete. |

#### `src/modules/draft-order/draft-order.domain.ts`

File role: Domain — pure mapping of cart lines into the shared `draft_orders` form_data shape, ids and totals.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `draftOrderId` | 120 |  | export | Formats a counter value as DFT-n. |
| `productsFrom` | 124 |  | export | Maps cart lines to draft product entries (B2B portal shape). |
| `grandTotalOf` | 145 |  | export | Money-rounded sum of product totals. |
| `itemCountOf` | 149 |  | export | Sum of product quantities. |
| `restorableLines` | 154 |  | export | Keeps products with a SKU and positive quantity as SKU/quantity pairs. |
| `emptyAddress` | 162 |  | local | Blank address with the given label, country India. |
| `formDataFor` | 179 |  | export | Builds the full default form_data with customer name/phone/lead and products. |

#### `src/modules/draft-order/repositories/customer-lookup.repository.ts`

File role: Repository - read-only customer lookups on shared piis, leads_v2 and contacts_v2 for draft orders.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `isString` | 23 |  | local | Type guard: true for a non-empty string. |
| `draftKey` | 26 |  | export | Draft contact_id and phone to the key used by piiIdsFor. |
| `CustomerLookupRepository.byPiiId` | 41 |  | async | PII id to draft customer (contact, lead, name, phone) from piis, leads_v2, contacts_v2; null if no pii. |
| `CustomerLookupRepository.piiIdsFor` | 84 |  | async | Page of drafts to pii ids via contacts_v2 by contact_id, else piis by phone oldest first. |
| `CustomerLookupRepository.piiIdFor` | 143 |  | async | One draft's contact or phone to its pii id via contacts_v2 then piis; null if none. |

#### `src/modules/draft-order/repositories/draft-order.repository.ts`

File role: Repository — vistaar rows in shared `draft_orders` (entry_path vistaar) and the `app_counters` DFT counter.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `DraftOrderRepository.nextCount` | 52 |  | async | Atomically `$inc`s `app_counters` draft_orders (no upsert); null if missing. |
| `DraftOrderRepository.findOpen` | 63 |  |  | Finds the partner's newest open draft for a customer phone + name. |
| `DraftOrderRepository.findOne` | 74 |  |  | Finds the partner's open draft by draft_order_id. |
| `DraftOrderRepository.insert` | 81 |  | async | Inserts a new draft in `draft_orders` with status draft, entry_path vistaar, reminder_sent false. |
| `DraftOrderRepository.replace` | 100 |  |  | Overwrites an open draft's data, resets reminder_sent, bumps `__v`. |
| `DraftOrderRepository.list` | 119 |  | async | Pages the partner's open drafts, latest first, with count. |
| `DraftOrderRepository.adminList` | 139 |  | async | Pages all vistaar open drafts, optionally one partner, with count. |
| `DraftOrderRepository.markReminderSent` | 161 |  |  | Sets reminder_sent true on an open draft. |
| `DraftOrderRepository.delete` | 175 |  | async | Deletes an open draft; returns whether one was deleted. |
| `DraftOrderRepository.openFilter` | 184 |  | private | Filter agent_id + entry_path vistaar + status draft. |

#### `src/modules/draft-order/services/admin-draft-order.service.ts`

File role: Service — HO draft-order list joined with customer pii_id and partner details.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `AdminDraftOrderService.list` | 29 |  | async | Pages drafts, resolves pii_ids and partners, returns views with partner info. |

#### `src/modules/draft-order/services/draft-order.service.ts`

File role: Service — draft-order rules: one draft per customer, save from cart, restore to cart, reminders, delete.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `DraftOrderService.save` | 59 |  | async | Requires a working partner, then runs writeDraft serialized per partner. |
| `DraftOrderService.list` | 66 |  | async | Pages the partner's drafts with resolved customer pii_ids. |
| `DraftOrderService.get` | 83 |  | async | Returns one draft view or throws not found. |
| `DraftOrderService.restore` | 92 |  | async | Replaces the active cart with the draft's lines and customer via CartService.replace. |
| `DraftOrderService.markReminderSent` | 111 |  | async | Requires a working partner, flags reminder_sent; not found if missing. |
| `DraftOrderService.delete` | 121 |  | async | Deletes the draft; throws not found if none. |
| `DraftOrderService.writeDraft` | 130 |  | private async | Saves cart as draft: DRAFT_CART_EMPTY check, replaces customer's open draft or inserts DFT-n; DRAFT_ID_UNAVAILABLE. |
| `DraftOrderService.customerFor` | 200 |  | private async | Looks up the draft customer by pii_id; throws not found if missing. |
| `DraftOrderService.viewOf` | 211 |  | private async | Resolves the draft's pii_id and builds its view. |
| `DraftOrderService.found` | 219 |  | private async | Awaits a draft or throws not found. |
| `keyOf` | 228 |  | local | Extracts contact_id and contact_number from a draft. |
| `draftView` | 233 |  | export | Maps a draft row to the app view: items, count, subtotal, reminder flag. |

### modules/orders

#### `src/modules/orders/controllers/admin-order.controller.ts`

File role: Controller — HO order reads: list, summary cards, breakdown, one order.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `AdminOrderController.list` | 22 | `GET /admin/orders` · `@Can(orders.read)` |  | Delegates to AdminOrderService.list. |
| `AdminOrderController.summary` | 34 | `GET /admin/orders/summary` · `@Can(orders.read)` |  | Delegates to AdminOrderService.summary. |
| `AdminOrderController.breakdown` | 44 | `GET /admin/orders/breakdown` · `@Can(orders.read)` |  | Delegates to AdminOrderService.breakdown. |
| `AdminOrderController.get` | 54 | `GET /admin/orders/:id` · `@Can(orders.read)` |  | Delegates to AdminOrderService.get. |

#### `src/modules/orders/controllers/order.controller.ts`

File role: Controller — partner's own orders: list and detail.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `OrderController.list` | 50 | `GET /orders` |  | Delegates to OrderService.list for the token's partner. |
| `OrderController.issueId` | 59 | `POST /orders/id` |  | Hands the partner a KSV- order number for one checkout attempt; the same request_id always returns the same number, throttled. |
| `OrderController.get` | 75 | `GET /orders/:id` |  | Delegates to OrderService.get for the token's partner. |

#### `src/modules/orders/orders.domain.ts`

File role: Domain - pure order rules: raw status to app stage, counted statuses, tracking steps, display formatting.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `vistaarOrderId` | 19 |  | export | Formats a counter number as a Vistaar order id with the KSV- prefix. |
| `normalise` | 129 |  | local | Trims and lowercases a status, empty when missing. |
| `isCounted` | 162 |  | export | True unless the status is failed, pseudo, split or merged. |
| `stageOf` | 166 |  | export | Raw order_status to the app's stage, default placed. |
| `statusesFor` | 171 |  | export | Stage to every raw status that maps to it. |
| `trackingSteps` | 202 |  | export | Status and history to the app tracking line with first-reached times; cancelled or returned ends the line. |
| `addressLine` | 252 |  | export | Order address to one comma-joined line with state and pincode. |
| `personName` | 268 |  | export | First and last name joined, or first only when the same or last missing. |
| `sizeLabel` | 278 |  | export | Variant value and unit, with a pack count suffix for multi-packs. |
| `firstUrl` | 293 |  | export | First URL in a possibly run-together image string, or null. |
| `markTimes` | 303 |  | export | Status history to delivered and cancelled-or-returned times, falling back to last status time. |
| `lastStatusAt` | 325 |  | export | Latest timestamp in a status history, or null. |
| `orderSearch` | 365 |  | export | Reads a search text as phone ending (4+ digits), order id, or customer name, so one box searches all three. |

#### `src/modules/orders/repositories/order-id.repository.ts`

File role: Order-id repository: keeps each issued KSV- number in vistaar_v2_order_ids per partner and request_id.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `isDuplicateKey` | 13 |  | local | Tells whether a Mongo error is a duplicate-key error, meaning a concurrent attempt already saved its number. |
| `attemptId` | 18 |  | local | Builds the <agent_id>:<request_id> row id so one checkout attempt maps to one number. |
| `OrderIdRepository.findByRequest` | 28 |  |  | Reads the number already issued for this attempt from the primary, so a racing insert's winner is seen at once. |
| `OrderIdRepository.insert` | 40 |  | async | Saves the issued KSV- number for this attempt; returns null when a concurrent copy already holds one. |

#### `src/modules/orders/repositories/order.repository.ts`

File role: Repository - read-only queries and aggregations on shared orders_v2 for Vistaar partner and HO order screens.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `searchFilter` | 83 |  | local | Turns an order search into a Mongo filter: exact order id, phone ending, or every name word in first or last name. |
| `OrderRepository.list` | 109 |  | async | Partner's Vistaar orders from orders_v2 by status, customer, dates and search; paged, newest first, with total. |
| `OrderRepository.findOne` | 144 |  |  | One of the partner's own Vistaar orders from orders_v2 by order_id. |
| `OrderRepository.takenNumbers` | 156 |  | async | Lists the numbers of orders_v2 orders already using a prefix, so old KSV- numbers are never issued again. |
| `OrderRepository.customerStats` | 172 |  |  | Aggregates orders_v2 per farmer: order count, spend, latest order date and status; any partner's Vistaar orders when none given. |
| `OrderRepository.buyersBetween` | 214 |  | async | Distinct pii_ids of the partner's orders in a date range, excluding given statuses. |
| `OrderRepository.adminList` | 235 |  | async | All Vistaar orders from orders_v2 by HO filter, paged newest first, with count. |
| `OrderRepository.adminSummary` | 258 |  | async | Aggregates orders_v2 by HO filter: count and value per status, distinct partners and buyers. |
| `OrderRepository.adminBreakdown` | 304 |  | async | Aggregates non-cancelled orders_v2 by day, partner, state, city, sku and repeat buyers. |
| `OrderRepository.adminFindOne` | 397 |  |  | One Vistaar-marketplace order from orders_v2 by order_id for HO. |
| `OrderRepository.adminFilter` | 407 |  | private | HO filter to a Mongo query: Vistaar marketplace plus partner, status, dates, customer, payment, state, order id, phone end. |
| `OrderRepository.ownFilter` | 436 |  | private | Partner id to a filter on agent and the Vistaar marketplace. |

#### `src/modules/orders/repositories/product-lookup.repository.ts`

File role: Repository — read-only product facts from shared `products_v2`.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `ProductLookupRepository.bySku` | 26 |  | async | Reads name, image, variant, item_qty for SKUs from `products_v2` into a map. |

#### `src/modules/orders/services/admin-order.service.ts`

File role: Service - HO Orders screen: order list, summary cards, sales breakdown panels and order detail.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `AdminOrderService.list` | 48 |  | async | HO query to a page of order views with partner and ship-to. |
| `AdminOrderService.summary` | 63 |  | async | Rolls status counts into stage counts and value (excluding cancelled and returned) for the window. |
| `AdminOrderService.breakdown` | 94 |  | async | Sales panels by day, partner, state, city, top products and category share, repeat buyers. |
| `AdminOrderService.get` | 165 |  | async | One order with its commission; 404 if not found. |
| `AdminOrderService.views` | 177 |  | private async | Orders to HO views with product facts and partner details in one lookup each. |
| `partnerOf` | 220 |  | export | Agent record to the partner summary (name, phone, cohort, district, state) HO lists show. |
| `filterOf` | 237 |  | local | HO query to order filter; search must be an order id or 4+ phone digits, else VALIDATION_FAILED, so a name never means every order. |
| `windowOf` | 268 |  | local | Filter defaulting to this IST month, range capped at 366 days, else VALIDATION_FAILED. |

#### `src/modules/orders/services/order-id.service.ts`

File role: Order-id service: hands out KSV- order numbers once per request_id, skipping the old Vistaar's numbers.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `view` | 28 |  | local | Maps an issued-number row to the app view: order id, request id, issue time. |
| `OrderIdService.onApplicationBootstrap` | 59 |  |  | Starts loading the old KSV- numbers at boot so the first checkout does not wait on it. |
| `OrderIdService.issueForPartner` | 68 |  | async | Checks the partner is approved and active to place orders, then issues the attempt's order number. |
| `OrderIdService.issue` | 76 |  | async | Returns the attempt's held number, or takes the next app_counters vistaar_orders number, skipping old KSV- ones, and saves it. |
| `OrderIdService.taken` | 114 |  | private | Reads the old Vistaar's KSV- numbers once per process and caches them; retries next time if the read fails. |
| `unavailable` | 134 |  | local | Builds the 503 ORDER_ID_UNAVAILABLE error used when no order number can be issued. |

#### `src/modules/orders/services/order.service.ts`

File role: Service - partner's orders from orders_v2: list, detail, per-customer business, buyers, product facts, commission per order.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `OrderService.list` | 61 |  | async | Partner's paged orders, filtered by status, customer, dates and search, as app views with product facts and per-order commission. |
| `OrderService.businessByCustomer` | 89 |  | async | Partner's confirmed business per customer: orders, spend, last order and stage. |
| `OrderService.businessOfBuyers` | 116 |  | async | These buyers' confirmed Vistaar business with any partner, for HO customer lists. |
| `OrderService.buyersIn` | 137 |  | async | Set of pii_ids the partner ordered for in an IST month, non-orders and cancelled excluded. |
| `OrderService.get` | 147 |  | async | One of the partner's orders as app view with commission; 404 if not found. |
| `OrderService.productsFor` | 167 |  | async | Skus to name, image, pack from in-memory catalogue, missing ones read from products lookup. |
| `OrderService.commissionOf` | 196 |  | async | Partner's commission per order from CommissionService; empty map if not wanted or on error. |
| `checkedRange` | 213 |  | export | IST from and to days to instants; VALIDATION_FAILED when start is after end. |
| `orderView` | 227 |  | export | One orders_v2 row to the app order view: stage, customer or Self label, items, totals, commission. |

### modules/performance

#### `src/modules/performance/controllers/admin-performance.controller.ts`

File role: Controller — HO partner performance: paged list, cached board, one partner, set monthly target.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `AdminPerformanceController.list` | 30 | `GET /admin/performance` · `@Can(commission.read)` |  | Delegates to PerformanceService.adminList. |
| `AdminPerformanceController.board` | 42 | `GET /admin/performance/board` · `@Can(commission.read)` |  | Delegates to PerformanceService.board for the month. |
| `AdminPerformanceController.get` | 52 | `GET /admin/performance/:agentId` · `@Can(commission.read)` |  | Delegates to PerformanceService.performance for the agent and period. |
| `AdminPerformanceController.setTarget` | 62 | `PUT /admin/performance/:agentId/target` · `@Can(agents.edit)` |  | Delegates to PerformanceService.setTarget with the admin email. |

#### `src/modules/performance/controllers/performance.controller.ts`

File role: Controller — partner's My Performance and standing.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `PerformanceController.get` | 22 | `GET /performance` |  | Delegates to PerformanceService.performance for the token's partner. |
| `PerformanceController.standing` | 34 | `GET /performance/standing` |  | Delegates to PerformanceService.standing. |

#### `src/modules/performance/performance.domain.ts`

File role: Domain — pure performance rules: period months, tiers, lifecycle stage, health score, shares.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `periodMonths` | 12 |  | export | Month keys for month, last 3 months, or financial year to date. |
| `previousMonths` | 25 |  | export | Equal-length preceding months for comparison; null for fy. |
| `tierOf` | 56 |  | export | Tier from average sales (bronze/silver 50k/gold 100k/platinum 250k) with progress to next. |
| `lifecycleOf` | 90 |  | export | onboarded if no order, lost at 90+ days, at_risk at 30+, else active. |
| `healthOf` | 118 |  | export | Five good/bad factors, 20 points each, into a health score. |
| `shares` | 155 |  | export | Rounded values with percent of total, sorted by value then name. |

#### `src/modules/performance/services/performance.service.ts`

File role: Service - partner performance and standing plus HO partner table, commission board and target setting, computed on read.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `PerformanceService.performance` | 188 |  | async | Partner and period to My Performance: sales vs target, orders, customers, leads, commission, categories, products, standing. |
| `PerformanceService.standing` | 323 |  |  | Partner's tier, lifecycle stage, health score and target, cached 5 minutes. |
| `PerformanceService.adminList` | 352 |  | async | Approved partners page with each one's month numbers from their commission book. |
| `PerformanceService.board` | 383 |  |  | HO commission board for a month, cached ten minutes; delegates to sweep. |
| `PerformanceService.sweep` | 388 |  | private async | Builds every approved partner's month row in batches with lead counts, totals and failure count. |
| `PerformanceService.monthRow` | 434 |  | private async | Partner and month to sales, rate, commission, orders, target pct, wallet totals, lifecycle and tier. |
| `PerformanceService.setTarget` | 481 |  | async | HO sets or clears a partner's monthly target and drops their cached book and standing. |
| `PerformanceService.standingFrom` | 493 |  | private | Book and facts to tier from 3-month average, lifecycle from days since last order, health score. |

### modules/commission

#### `src/modules/commission/commission.domain.ts`

File role: Domain — pure commission rules: slabs, default plans, plan choice per order and month, the commission book, TDS and quarters.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `bands` | 86 |  | local | Builds three sales slabs (0–50k, 50k–1L, 1L+) from three rates. |
| `defaultPlan` | 111 |  | export | Returns the PRD's draft slab plan for a cohort (fallback cohort's if unknown). |
| `isEarningCohort` | 128 |  | export | True when the cohort id starts with `ec_` (earning cohort). |
| `planSlabs` | 135 |  | export | Turns a fixed `rate` or slab list into stored slabs, or returns why the input is invalid. |
| `slabsProblem` | 170 |  | export | Validates slabs (count, start at 0, rates 0–100, contiguous ranges); returns problem text or null. |
| `slabFor` | 192 |  | export | Returns the slab a sales amount falls in (else the top slab). |
| `nextSlab` | 200 |  | export | Returns the next slab's rate and sales still needed, or null on the top slab. |
| `commissionOf` | 209 |  | export | Rounds base × rate percent to whole rupees. |
| `lineBases` | 239 |  | export | Splits an order's discount and coins across paid lines by value, then removes each line's GST. |
| `earningPlanIn` | 361 |  | export | Returns an earning cohort's saved plan for a month, else the default cohort's, else null. |
| `orderPlan` | 384 |  | export | Picks an order's plan: earning cohort at placing (default below min order), else partner-type plan. |
| `monthPlan` | 418 |  | export | Returns the plan new orders in a month earn on: month-end earning cohort's, else partner type's. |
| `buildBook` | 437 |  | export | Builds the partner's commission book from order facts: per-order status, rate, amount, totals, withdrawable. |
| `tdsOf` | 618 |  | export | Returns TDS and net for an amount at a rate, to the paisa. |
| `quarterMonths` | 629 |  | export | Returns the three `YYYY-MM` months of an `FYyyyy-Qn` quarter. |
| `quarterOf` | 636 |  | export | Returns the financial-year quarter key for a `YYYY-MM` month. |

#### `src/modules/commission/controllers/admin-commission-plans.controller.ts`

File role: Controller — HO CRUD routes for commission plans per cohort and month, plus the rates-in-effect table.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `AdminCommissionPlansController.list` | 42 | `GET /admin/commission-plans` · `@Can(commission.read)` |  | Delegates to `CommissionPlansService.list` for saved plans, paged. |
| `AdminCommissionPlansController.inEffect` | 52 | `GET /admin/commission-plans/in-effect` · `@Can(commission.read)` |  | Delegates to `CommissionPlansService.inEffect` for the month (default this IST month) and scope. |
| `AdminCommissionPlansController.get` | 65 | `GET /admin/commission-plans/:id` · `@Can(commission.read)` |  | Delegates to `CommissionPlansService.get` for one plan with history. |
| `AdminCommissionPlansController.create` | 72 | `POST /admin/commission-plans` · `@Can(commission.plans)` |  | Delegates to `CommissionPlansService.create` with the admin's email. |
| `AdminCommissionPlansController.update` | 85 | `PATCH /admin/commission-plans/:id` · `@Can(commission.plans)` |  | Delegates to `CommissionPlansService.update` with the admin's email. |
| `AdminCommissionPlansController.remove` | 99 | `DELETE /admin/commission-plans/:id` · `@Can(commission.plans)` |  | Delegates to `CommissionPlansService.remove`. |

#### `src/modules/commission/controllers/admin-payouts.controller.ts`

File role: Controller — HO routes for withdrawals (approve, reject, pay, bank file), partner commission view, TDS listing and Form 16A uploads.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `AdminPayoutsController.list` | 55 | `GET /admin/withdrawals` · `@Can(commission.read)` |  | Delegates to `WalletService.list` for a paged withdrawal list. |
| `AdminPayoutsController.totals` | 67 | `GET /admin/withdrawals/totals` · `@Can(commission.read)` |  | Delegates to `WalletService.totals` for the payout cards. |
| `AdminPayoutsController.payoutFile` | 77 | `GET /admin/withdrawals/payout-file` · `@Can(payouts.manage)` |  | Delegates to `WalletService.payoutFile` for the approved-withdrawals bank CSV. |
| `AdminPayoutsController.payBatch` | 87 | `POST /admin/withdrawals/paid` · `@Can(payouts.manage)` |  | Delegates to `WalletService.payBatch` to mark many withdrawals paid with UTRs. |
| `AdminPayoutsController.get` | 103 | `GET /admin/withdrawals/:id` · `@Can(commission.read)` |  | Delegates to `WalletService.get` for one withdrawal. |
| `AdminPayoutsController.approve` | 110 | `POST /admin/withdrawals/:id/approve` · `@Can(payouts.manage)` |  | Delegates to `WalletService.approve` with the admin's email. |
| `AdminPayoutsController.reject` | 123 | `POST /admin/withdrawals/:id/reject` · `@Can(payouts.manage)` |  | Delegates to `WalletService.reject` with the reason and admin's email. |
| `AdminPayoutsController.pay` | 137 | `POST /admin/withdrawals/:id/paid` · `@Can(payouts.manage)` |  | Delegates to `WalletService.pay` with the UTR body and admin's email. |
| `AdminPayoutsController.partner` | 148 | `GET /admin/commission/partners/:agentId` · `@Can(commission.read)` |  | Delegates to `WalletService.partnerCommission` for one partner's summary, wallet and ledger. |
| `AdminPayoutsController.tds` | 161 | `GET /admin/tds` · `@Can(payouts.manage)` |  | Delegates to `WalletService.tdsListing` for per-partner TDS in a quarter. |
| `AdminPayoutsController.certificates` | 177 | `GET /admin/tds/certificates` · `@Can(payouts.manage)` |  | Delegates to `WalletService.listCertificates` for a quarter's Form 16A list. |
| `AdminPayoutsController.putCertificate` | 186 | `PUT /admin/tds/certificates/:agentId/:quarter` · `@Can(payouts.manage)` | async | Reads one multipart PDF ≤ 5 MB (FILE_REQUIRED, FILE_TYPE_NOT_ALLOWED, FILE_TOO_LARGE) and passes it to `WalletService.putCertificate`. |
| `AdminPayoutsController.removeCertificate` | 231 | `DELETE /admin/tds/certificates/:agentId/:quarter` · `@Can(payouts.manage)` |  | Delegates to `WalletService.removeCertificate`. |

#### `src/modules/commission/controllers/commission.controller.ts`

File role: Controller — partner read-only commission routes (summary, ledger, plans) and reports (statement, TDS), identity from the token.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `CommissionController.summary` | 33 | `GET /commission/summary` |  | Delegates to `CommissionService.summary` for the calling partner. |
| `CommissionController.ledger` | 42 | `GET /commission/ledger` |  | Delegates to `CommissionService.ledger` for the calling partner with the query filters. |
| `CommissionController.plans` | 54 | `GET /commission/plans` |  | Delegates to `CommissionService.plansFor` for the calling partner. |
| `CommissionController.statement` | 63 | `GET /reports/commission-statement` |  | Delegates to `CommissionService.statement` for the partner and month. |
| `CommissionController.tds` | 75 | `GET /reports/tds` |  | Delegates to `CommissionService.tds` for the partner and quarter. |

#### `src/modules/commission/controllers/wallet.controller.ts`

File role: Controller — partner wallet routes: balance and withdrawal request, list, read and cancel.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `WalletController.get` | 40 | `GET /wallet` |  | Delegates to `WalletService.wallet` for the calling partner. |
| `WalletController.request` | 49 | `POST /wallet/withdrawals` |  | Delegates to `WalletService.request` to ask for a withdrawal. |
| `WalletController.list` | 61 | `GET /wallet/withdrawals` |  | Delegates to `WalletService.mine` for the partner's withdrawals. |
| `WalletController.getOne` | 70 | `GET /wallet/withdrawals/:id` |  | Delegates to `WalletService.mineOne` for one of the partner's withdrawals. |
| `WalletController.cancel` | 79 | `DELETE /wallet/withdrawals/:id` |  | Delegates to `WalletService.cancel` for the partner's withdrawal. |

#### `src/modules/commission/dto/commission.dto.ts`

File role: DTO — request validation for commission, wallet, withdrawal, TDS and certificate routes.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `trim` | 32 |  | local | Transform helper: trims string values, leaves others unchanged. |
| `upper` | 34 |  | local | Transform helper: trims and upper-cases string values, leaves others unchanged. |

#### `src/modules/commission/repositories/commission-order.repository.ts`

File role: Repository — read-only aggregation of the partner's Vistaar orders from shared `orders_v2` into commission facts.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `CommissionOrderRepository.factsFor` | 42 |  | async | Aggregates the partner's counted Vistaar-marketplace orders in orders_v2 into OrderFacts: lines, discount and coin deduction, delivery and cancel times. |
| `num` | 120 |  | local | Returns the value if a finite number, else 0. |

#### `src/modules/commission/repositories/commission-plan.repository.ts`

File role: Repository — Mongo access for `vistaar_v2_commission_plans`: reads, insert, optimistic update with history, delete.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `CommissionPlanRepository.all` | 21 |  |  | Reads every plan from `vistaar_v2_commission_plans`, sorted by cohort and effective month. |
| `CommissionPlanRepository.findById` | 29 |  |  | Reads one plan by `_id`. |
| `CommissionPlanRepository.insert` | 34 |  | async | Inserts a plan with empty history; returns false on duplicate key (cohort+month exists). |
| `CommissionPlanRepository.update` | 51 |  |  | Updates a plan only if `updated_at` unchanged, pushing the prior state to `history`; returns row or null. |
| `CommissionPlanRepository.remove` | 71 |  | async | Deletes a plan only if `updated_at` unchanged; returns whether one was deleted. |

#### `src/modules/commission/repositories/tds-certificate.repository.ts`

File role: Repository — Mongo access for `vistaar_v2_tds_certificates` (one Form 16A per partner and quarter).

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `certificateId` | 12 |  | export | Builds the certificate `_id` as `<agentId>:<quarter>`. |
| `TdsCertificateRepository.find` | 22 |  |  | Reads one certificate from `vistaar_v2_tds_certificates` by partner and quarter. |
| `TdsCertificateRepository.put` | 30 |  | async | Upserts the certificate path and uploader; returns the previous file path or null. |
| `TdsCertificateRepository.forAgents` | 50 |  |  | Reads a quarter's certificates for the given partner ids. |
| `TdsCertificateRepository.list` | 60 |  | async | Pages a quarter's certificates (optional partner filter) sorted by agent_id, with total count. |
| `TdsCertificateRepository.remove` | 80 |  |  | Deletes one certificate and returns the deleted row. |

#### `src/modules/commission/repositories/withdrawal.repository.ts`

File role: Repository — Mongo access for `vistaar_v2_withdrawals`: insert, reads, guarded status moves and sums.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `WithdrawalRepository.insert` | 38 |  | async | Inserts a withdrawal into `vistaar_v2_withdrawals`; returns false on duplicate key (an open one exists). |
| `WithdrawalRepository.findById` | 51 |  |  | Reads one withdrawal by `_id`. |
| `WithdrawalRepository.forAgent` | 56 |  |  | Reads all of a partner's withdrawals, newest request first. |
| `WithdrawalRepository.list` | 64 |  | async | Pages withdrawals by filter and sort, with total count. |
| `WithdrawalRepository.all` | 84 |  |  | Reads withdrawals by filter, oldest request first, up to a cap. |
| `WithdrawalRepository.transition` | 98 |  |  | Conditionally moves a withdrawal from given statuses to a new one, unsetting `open` when closed; returns row or null. |
| `WithdrawalRepository.sums` | 124 |  |  | Aggregates count, amount, TDS and net per status for a filter. |
| `WithdrawalRepository.paidByAgent` | 152 |  | async | Aggregates paid withdrawals per partner (count, amount, TDS, net), paged, with total. |
| `WithdrawalRepository.toQuery` | 211 |  | private | Turns a filter (statuses, agent, paid date range) into a Mongo query. |

#### `src/modules/commission/services/commission-plans.service.ts`

File role: Service — commission plan rules: cached plan lookup per cohort and month, rates in effect, HO create/update/delete with month locking.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `planId` | 35 |  | export | Builds a plan id as `<cohort>@<month>`. |
| `CommissionPlansService.saved` | 62 |  | async | Returns a memoised lookup (cohort, month) to the latest saved plan from that month, from the cached rows. |
| `CommissionPlansService.termsFor` | 87 |  | async | Returns a per-month lookup of a partner type's saved plan, else the PRD default. |
| `CommissionPlansService.inEffect` | 102 |  | async | Lists each active partner type's terms in a month with label; earning scope delegates to `earningInEffect`. |
| `CommissionPlansService.list` | 119 |  | async | Pages all plans, optional cohort filter, by cohort then latest month first. |
| `CommissionPlansService.get` | 134 |  | async | Returns one plan view; 404 when missing. |
| `CommissionPlansService.create` | 139 |  | async | Checks cohort, month not past, slabs and min order; inserts plan; PLAN_EXISTS on duplicate. |
| `CommissionPlansService.update` | 173 |  | async | Changes terms (PLAN_LOCKED if past) or draft flag with optimistic check; VERSION_CONFLICT if changed. |
| `CommissionPlansService.remove` | 211 |  | async | Deletes a current or future plan (PLAN_LOCKED if past); VERSION_CONFLICT if changed. |
| `CommissionPlansService.earningInEffect` | 219 |  | private async | Lists active earning cohorts with own plan, default cohort's, or a partner_type inheritance row. |
| `CommissionPlansService.requireCohort` | 255 |  | private async | Ensures a partner type exists or earning cohort exists (COHORT_NOT_FOUND) and is not archived (EARNING_ARCHIVED). |
| `CommissionPlansService.require` | 275 |  | private async | Reads a plan by id or throws 404. |
| `CommissionPlansService.rows` | 281 |  | private async | Returns all plan rows from a 60 s per-process cache, sharing one in-flight load. |
| `inEffectOf` | 298 |  | local | Maps a saved row to its in-effect terms, defaulting old rows to slabs with no minimum. |
| `kindOf` | 311 |  | local | Returns the row's plan kind, default `slabs`. |
| `viewOf` | 313 |  | local | Maps a plan row to its API view with `id` and defaulted kind, minimum and history. |
| `lockedIfPast` | 324 |  | local | Throws PLAN_LOCKED when the month is before this IST month. |
| `checked` | 334 |  | local | Returns slabs from `planSlabs` output or throws VALIDATION_FAILED. |
| `minOrderValue` | 344 |  | local | Allows a minimum order value only on non-default earning cohorts, else VALIDATION_FAILED. |
| `changed` | 354 |  | local | Builds the VERSION_CONFLICT error for a plan changed by someone else. |

#### `src/modules/commission/services/commission.service.ts`

File role: Service — works out a partner's commission book from orders, plans, settings, withdrawals and gig credits on read; summary, ledger, plans, statement and TDS reports.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `round2` | 209 |  | local | Rounds a number to two decimals. |
| `CommissionService.bookOf` | 268 |  | async | Loads orders, withdrawals, plans, settings, GST, gig credits (if gig pay on) and cohorts, then builds the book. |
| `CommissionService.forOrders` | 370 |  | async | Returns the partner's per-order commission keyed by order id. |
| `CommissionService.forget` | 376 |  |  | Clears all of a partner's cached facts, terms, withdrawals, gig credits and cohort stretches. |
| `CommissionService.forgetWithdrawals` | 386 |  |  | Clears the partner's cached withdrawals. |
| `CommissionService.summary` | 390 |  | async | Returns this month's sales, target, rate, next slab, estimate and book totals. |
| `CommissionService.ledger` | 409 |  | async | Pages ledger rows, optional status filter, with book totals. |
| `CommissionService.plansFor` | 426 |  | async | Returns the partner's current plan (earning cohort or partner type, below-min fallback), all cohort plans, TDS and limits. |
| `CommissionService.statement` | 493 |  | async | Lists a month's orders with commission, plus earned, pending, reversed, TDS at PAN rate and net. |
| `CommissionService.tds` | 539 |  | async | Sums paid withdrawals' gross, TDS and net per quarter month, with PAN and signed Form 16A URL. |
| `CommissionService.partner` | 592 |  | async | Returns the partner's commission terms, cached a minute; 404 when unknown. |
| `termsOf` | 601 |  | local | Maps an agent record to commission terms (ids, name, cohort, stage, target). |
| `commissionOf` | 614 |  | local | Maps a ledger row to an order's commission view. |
| `itemOf` | 628 |  | local | Maps a ledger row to a ledger list item with order and commission fields. |

#### `src/modules/commission/services/wallet.service.ts`

File role: Service — wallet and withdrawals: partner request/cancel, HO approve/reject/pay, bank file, payout totals, TDS listing and Form 16A files.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `last4` | 153 |  | local | Returns the last four characters of an account number, or null. |
| `WalletService.wallet` | 178 |  | async | Returns balances, TDS rate, masked bank, open withdrawal and why withdrawing is blocked (not approved, bank unverified or changing, open, below minimum). |
| `WalletService.request` | 225 |  |  | Serially per partner checks approval, minimum, open request, balance and bank (error codes), fixes TDS and inserts a WD- request. |
| `WalletService.mine` | 294 |  | async | Pages the partner's own withdrawals, optional status filter. |
| `WalletService.mineOne` | 308 |  | async | Returns one of the partner's withdrawals; 404 if missing or not theirs. |
| `WalletService.cancel` | 316 |  | async | Cancels the partner's withdrawal only while requested; else WITHDRAWAL_CHANGED. |
| `WalletService.list` | 334 |  | async | Pages withdrawals for HO by status and partner; open queues oldest first. |
| `WalletService.get` | 351 |  | async | Returns one withdrawal's admin view; 404 when missing. |
| `WalletService.viewOf` | 356 |  | private async | Builds the admin view of one withdrawal. |
| `WalletService.approve` | 365 |  | async | Rechecks bank and balance (BANK_NOT_VERIFIED, NOT_ENOUGH_BALANCE), fixes TDS, moves requested to approved. |
| `WalletService.reject` | 405 |  | async | Moves an open withdrawal to rejected with reason and admin; else WITHDRAWAL_CHANGED. |
| `WalletService.pay` | 424 |  | async | Moves an approved withdrawal to paid with UTR, date and admin; else WITHDRAWAL_CHANGED. |
| `WalletService.payBatch` | 444 |  | async | Marks each approved withdrawal paid with its UTR independently; returns per-line results and paid count. |
| `WalletService.payoutFile` | 476 |  | async | Builds a bank CSV of approved withdrawals with full account details, skipping rows lacking account or IFSC. |
| `WalletService.totals` | 541 |  | async | Returns counts and sums of requested, approved, paid this month and paid this FY. |
| `WalletService.partnerCommission` | 575 |  | async | Returns one partner's basics, commission summary, wallet and ledger for HO. |
| `WalletService.tdsListing` | 604 |  | async | Pages per-partner paid TDS in a quarter with name, PAN and signed Form 16A link. |
| `WalletService.putCertificate` | 654 |  | async | Saves a Form 16A PDF privately, upserts the certificate row, removes any replaced file. |
| `WalletService.listCertificates` | 685 |  | async | Pages a quarter's certificates with signed URLs. |
| `WalletService.removeCertificate` | 707 |  | async | Deletes a certificate row and its file; 404 when none. |
| `WalletService.moved` | 720 |  | private | Clears the partner's cached withdrawals and returns the row. |
| `WalletService.require` | 725 |  | private async | Reads a withdrawal by id or throws 404. |
| `WalletService.payoutFactsOf` | 731 |  | private async | Returns the partner's bank and PAN facts from onboarding. |
| `WalletService.partnersOf` | 740 |  | private async | Maps `VST-` ids to form key, name, phone and cohort in one agents read. |
| `WalletService.adminViews` | 770 |  | private async | Builds admin withdrawal views with partner name, phone, cohort and actors. |
| `viewOf` | 792 |  | local | Maps a withdrawal row to the partner's withdrawal view. |
| `csvCell` | 812 |  | export | Escapes a CSV cell against formula injection and quotes it when needed. |
| `paidAtOf` | 817 |  | local | Parses the payment date (default now); VALIDATION_FAILED if in the future. |
| `stillOpen` | 830 |  | local | Builds the WITHDRAWAL_OPEN conflict error. |
| `bankNotVerified` | 837 |  | local | Builds the BANK_NOT_VERIFIED conflict error. |
| `changed` | 844 |  | local | Builds the WITHDRAWAL_CHANGED error for a concurrent change. |
| `notInStatus` | 857 |  | local | Builds a WITHDRAWAL_CHANGED error naming the required and current status. |

### scripts

#### `src/scripts/backfill-id-keys.ts`

File role: One-off script: backfills onboarding id_keys for the Aadhaar / PAN duplicate check and reports duplicates.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `main` | 16 |  | local | Fills missing Aadhaar-hash / PAN id_keys on onboarding rows (dry run unless --apply) and prints duplicate holders by agent id. |

#### `src/scripts/backfill-lead-location.ts`

File role: Script — one-off placement of farmers in `vistaar_v2_leads` at their pincode centre; dry run by default.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `main` | 17 |  | local | Boots the app, calls `LeadsService.placeByPincode` (writes only with --apply) and logs how many were placed. |

#### `src/scripts/backfill-partner-place.ts`

File role: Script — one-off fix of partners' state and district in `vistaar_v2_agents` from `pincode_map_v2`; dry run by default.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `main` | 24 |  | local | Pages all partners, logs fixes, with --apply sets place and recomputes earning cohorts. |
| `placeFix` | 66 |  | local | Returns the state and district differing from the pincode's place in preview or profile, or null. |

#### `src/scripts/default-forms.ts`

File role: Script data — default cohorts and onboarding form steps from the PRD, used by `seed-onboarding.ts`.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `l` | 10 |  | local | Builds a label object with `en` and optional `hi`. |
| `opt` | 12 |  | local | Builds a select option with a value and localised label. |
| `defaultSteps` | 231 |  | export | Returns the form steps for a cohort: shared steps around the cohort's own step. |

#### `src/scripts/seed-banners.ts`

File role: Script — seeds or removes five test banners in `vistaar_v2_banners` (with generated images) via `BannersService`; beta/local only.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `seedBanners` | 36 |  | local | Returns the five test banner definitions with dates relative to now. |
| `gradientPng` | 110 |  | local | Generates a 1200×500 left-to-right gradient PNG buffer. |
| `main` | 141 |  | local | Removes seed banners with --remove, else creates missing ones (uploading images) with --apply; skips if already seeded. |

#### `src/scripts/seed-faqs.ts`

File role: Script — seeds the app's built-in FAQ sections and FAQs into `vistaar_v2_faq_sections` and `vistaar_v2_faqs`; dry run by default.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `main` | 92 |  | local | Creates missing sections and FAQs (by key / normalised question) through the services with --apply, skipping existing ones. |

#### `src/scripts/seed-feedback.ts`

File role: Script — seeds or removes tagged test NPS answers and product suggestions in `vistaar_v2_feedback` and `vistaar_v2_product_suggestions`; beta only.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `rng` | 149 |  | local | Returns a seeded deterministic pseudo-random generator. |
| `snapshot` | 166 |  | local | Builds a partner snapshot (name, phone, cohort, place, owner) from an agent row. |
| `main` | 177 |  | local | Refuses production; --remove deletes tagged rows; else reads verified partners from `vistaar_v2_agents` and inserts tagged test rows once. |

#### `src/scripts/seed-info-pages.ts`

File role: Script — seeds About Vistaar, About Katyayani and Contact Us as version 1 in `vistaar_v2_info_pages`; dry run by default.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `main` | 44 |  | local | Validates each page's content by its DTO and creates pages that do not exist via `InfoPagesService` with --apply. |

#### `src/scripts/seed-onboarding.ts`

File role: Script — seeds the five PRD cohorts and published forms into `vistaar_v2_cohorts` and `vistaar_v2_onboarding_configs`; dry run by default.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `main` | 23 |  | local | Creates missing cohorts and publishes a first form (or re-publishes seed-made forms with --republish) through the services. |

#### `src/scripts/seed-story-content.ts`

File role: Script — seeds or removes My Story festivals, samples, events, designs and template cards via their services; dry run by default.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `designArt` | 349 |  | local | Generates a 1080×1920 top-to-bottom fade PNG with warm glows for a test design. |
| `main` | 662 |  | local | Adds missing designs, festivals, samples, events and template cards by key, or deletes seed-made ones with --remove. |

#### `src/scripts/seed-terms.ts`

File role: Script — adds Vistaar's Privacy and Terms as the next `TOC-n` row in shared `terms_and_conditions` via `TermsService`; dry run by default.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `arg` | 33 |  | local | Returns the command-line value after a flag name, or null. |
| `main` | 38 |  | local | Skips if an active Vistaar row exists (unless --replace); composes from `terms-content` or uploads --file, with --apply. |

#### `src/scripts/seed-test-kkd-activity.ts`

File role: Test seed script: writes, refreshes or removes tagged KKD activity test rows in other apps' collections, beta and local only.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `istAt` | 36 |  | local | Gives the instant for an IST hour and minute a number of days before today. |
| `oid` | 66 |  | local | Makes a fixed, recognisable ObjectId for a seed row number. |
| `split` | 69 |  | local | Splits a full name into first and last name. |
| `walkin` | 74 |  | local | Builds a tagged test franchise_v2_walkins row for a farmer at a store. |
| `prescription` | 108 |  | local | Builds a tagged test franchise_v2_prescriptions crop-advice row for a farmer at a store. |
| `posOrder` | 151 |  | local | Builds a tagged test franchise_v2_pos_orders archive order for a farmer at a store. |
| `stockshipOrder` | 198 |  | local | Builds a tagged test orders_v2 app (MKTP-3) or website (MKTP-2) order, delivered or cancelled only. |
| `appEvent` | 264 |  | local | Builds a tagged test kkd_events app launch or abandoned-cart event keyed by the farmer's mobile. |
| `rows` | 292 |  | local | Lists every test row per collection with what it tests, for VST-000006's farmers. |
| `main` | 412 |  | local | Outside production, dry-runs, upserts or removes only the tagged test rows in the five other-app collections, building no index. |

#### `src/scripts/seed-test-leads.ts`

File role: Script — adds test farmers for VST-000006/007 via `LeadsService`, then sets test times on `vistaar_v2_leads`; beta/local only, dry run by default.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `ist` | 62 |  | local | Returns an IST ISO timestamp at a given hour, days from today. |
| `main` | 325 |  | local | Refuses production; for new farmers with --apply adds lead (signed OTP), moves, activities, past times, transfers. |

#### `src/scripts/seed-test-meetings-gigs.ts`

File role: Script — upserts or removes five test meetings and five test gigs for VST-000006 directly in `vistaar_v2_meetings` and `vistaar_v2_gigs`; beta/local only.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `meetingId` | 25 |  | local | Builds the fixed test meeting UUID for n. |
| `gigId` | 26 |  | local | Builds the fixed test gig id `GIG-90000n`. |
| `istTen` | 29 |  | local | Returns 10:00 IST on the day a given number of days from today. |
| `testPhone` | 47 |  | local | Builds a test mobile in the `60000002nn` series. |
| `walkIns` | 48 |  | local | Builds a list of test walk-in farmers with phones, names and villages. |
| `counts` | 55 |  | local | Counts invited, present and lead-captured attendees. |
| `meetings` | 65 |  | local | Builds the five test meeting rows (with purpose) from three farmers. |
| `gigs` | 164 |  | local | Builds the five test gig rows (with purpose) in various states. |
| `main` | 289 |  | local | Refuses production; --remove deletes fixed ids; else reads 3 farmers from `vistaar_v2_leads` and upserts meetings and gigs with --apply. |

#### `src/scripts/seed-test-payment-keys.ts`

File role: Script — submits and approves dummy test merchant keys for payment options without keys via `PaymentCredentialsService`; refused in production.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `main` | 40 |  | local | For each provider without keys, with --apply submits dummy test keys, marks the gateway check passed and approves with a second identity. |

#### `src/scripts/terms-content.ts`

File role: Script data — the Vistaar Privacy and Terms text (`VISTAAR_TERMS`) composed from the app's built-in texts, used by `seed-terms.ts`.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `s` | 12 |  | local | Builds a terms section from a heading and optional body, points and items. |

### modules/gigs

#### `src/modules/gigs/controllers/admin-gigs.controller.ts`

File role: Controller: HO gig desk routes under /admin/gigs, capability-guarded, delegating to AdminGigsService.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `AdminGigsController.list` | 41 | `GET /admin/gigs` · `@Can(gigs.read)` |  | Delegates to AdminGigsService.list: paged gigs filtered by status, partner, state, district, IST days. |
| `AdminGigsController.summary` | 51 | `GET /admin/gigs/summary` · `@Can(gigs.read)` |  | Delegates to AdminGigsService.summary: status counts, partners, approved payout, farmers for the date range. |
| `AdminGigsController.get` | 61 | `GET /admin/gigs/:id` · `@Can(gigs.read)` |  | Delegates to AdminGigsService.get: one gig with partner, flags, farmers, signed photo links, repeat phones. |
| `AdminGigsController.create` | 71 | `POST /admin/gigs` · `@Can(gigs.write)` |  | Delegates to AdminGigsService.create with the DTO and admin email. |
| `AdminGigsController.update` | 83 | `PATCH /admin/gigs/:id` · `@Can(gigs.write)` |  | Delegates to AdminGigsService.update; GIG_CLOSED if held or closed. |
| `AdminGigsController.remove` | 97 | `DELETE /admin/gigs/:id` · `@Can(gigs.write)` |  | Delegates to AdminGigsService.remove; deletes only a gig nobody ever took. |
| `AdminGigsController.assign` | 107 | `POST /admin/gigs/:id/assign` · `@Can(gigs.write)` |  | Delegates to AdminGigsService.assign: give an open gig to an approved partner. |
| `AdminGigsController.reopen` | 120 | `POST /admin/gigs/:id/reopen` · `@Can(gigs.write)` |  | Delegates to AdminGigsService.reopen: take a held gig back to open, clearing proof. |
| `AdminGigsController.cancel` | 135 | `POST /admin/gigs/:id/cancel` · `@Can(gigs.write)` |  | Delegates to AdminGigsService.cancel with reason and admin email. |
| `AdminGigsController.approve` | 152 | `POST /admin/gigs/:id/approve` · `@Can(gigs.review)` |  | Delegates to AdminGigsService.approve: submitted proof approved, payout earned. |
| `AdminGigsController.reject` | 164 | `POST /admin/gigs/:id/reject` · `@Can(gigs.review)` |  | Delegates to AdminGigsService.reject with the reason shown to the partner. |

#### `src/modules/gigs/controllers/gigs.controller.ts`

File role: Controller: partner gig routes (list, accept, check-in, proof, submit), identity from token, delegating to GigsService.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `GigsController.list` | 55 | `GET /gigs` |  | Delegates to GigsService.list for the token partner: available, mine or history tab. |
| `GigsController.summary` | 67 | `GET /gigs/summary` |  | Delegates to GigsService.summary: tab counts, month gig pay, pay-enabled flag. |
| `GigsController.get` | 76 | `GET /gigs/:id` |  | Delegates to GigsService.get: one open gig for the cohort or the partner own gig. |
| `GigsController.accept` | 88 | `POST /gigs/:id/accept` |  | Delegates to GigsService.accept; returns the gig plus a same-day warning. |
| `GigsController.release` | 103 | `POST /gigs/:id/release` |  | Delegates to GigsService.release: give a gig back before its IST day. |
| `GigsController.checkIn` | 117 | `POST /gigs/:id/check-in` |  | Delegates to GigsService.checkIn with location; flags recorded, never refused. |
| `GigsController.setAttendees` | 133 | `PUT /gigs/:id/attendees` |  | Delegates to GigsService.setAttendees: replaces the full farmer list. |
| `GigsController.photoTicket` | 147 | `POST /gigs/:id/photos/upload-url` |  | Delegates to GigsService.photoTicket: signed PUT URL for one photo. |
| `GigsController.addPhoto` | 165 | `POST /gigs/:id/photos` |  | Delegates to GigsService.addPhoto: links an uploaded photo to the gig. |
| `GigsController.removePhoto` | 183 | `DELETE /gigs/:id/photos/:photoId` |  | Delegates to GigsService.removePhoto: unlinks and deletes one photo. |
| `GigsController.submit` | 194 | `POST /gigs/:id/submit` |  | Delegates to GigsService.submit: sends proof for HO review. |

#### `src/modules/gigs/dto/gig.dto.ts`

File role: DTO: gig request/query validation classes for partner and HO gig routes.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `trim` | 34 |  | local | Transform: trims a string value, passes non-strings through. |
| `upper` | 36 |  | local | Transform: trims and uppercases a string value, passes non-strings through. |

#### `src/modules/gigs/gigs.domain.ts`

File role: Domain: pure gig rules (payout source, missed, release window, check-in flags, submit proof, distance, IST day).

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `payoutSourceOf` | 57 |  | export | Returns the gig payout source, defaulting old gigs without one to gig. |
| `cohortPayout` | 62 |  | export | Returns the cohort meeting-gig rate, else the settings rate. |
| `payoutOnTake` | 68 |  | export | Cohort-paid gig: sets payout to the taker rate on accept/assign; otherwise no change. |
| `payoutOnRelease` | 76 |  | export | Cohort-paid gig: clears payout to null on release/reopen; otherwise no change. |
| `isMissed` | 91 |  | export | True when a held (accepted/checked-in) gig IST day has already passed. |
| `releaseError` | 99 |  | export | Returns an error message unless the gig is at least one IST day ahead, else null. |
| `checkinFlags` | 105 |  | export | Computes check-in flags early, late, no_gps, far (beyond radius) and distance in metres. |
| `submitProblems` | 132 |  | export | Lists missing farmers and photos versus the gig minimums; empty when submit is allowed. |
| `distanceKm` | 152 |  | export | Haversine distance partner to venue in km, one decimal; null if either point unknown. |
| `istDayOf` | 163 |  | export | Returns the IST day start and end bounds containing a date. |

#### `src/modules/gigs/repositories/gig.repository.ts`

File role: Repository: Mongo reads, aggregations and conditional state transitions on vistaar_v2_gigs.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `GigRepository.create` | 80 |  | async | Inserts a gig row into vistaar_v2_gigs and returns it as a plain object. |
| `GigRepository.find` | 85 |  |  | Reads one gig by _id from vistaar_v2_gigs (lean). |
| `GigRepository.openFrom` | 90 |  |  | Reads open gigs starting from a date, soonest first, capped, list fields only. |
| `GigRepository.page` | 100 |  | async | Filtered, sorted, paged gig list plus total count from vistaar_v2_gigs. |
| `GigRepository.forAgentBetween` | 123 |  |  | Reads a partner gigs in given statuses within a start-time window, soonest first, capped. |
| `GigRepository.transition` | 143 |  |  | Conditional findOneAndUpdate on _id plus expected state; null when state moved meanwhile. |
| `GigRepository.removeUntaken` | 157 |  | async | Deletes a gig only if open, unassigned and never released; returns whether deleted. |
| `GigRepository.heldBetween` | 170 |  |  | Counts the partner other accepted/checked-in gigs in a time window. |
| `GigRepository.approvedFor` | 187 |  |  | Reads a partner approved gigs (id, payout, reviewed_at, title), oldest approval first. |
| `GigRepository.approvedStats` | 199 |  | async | Aggregates a partner approved gigs in a window: count, payout sum, farmers present. |
| `GigRepository.seenElsewhere` | 231 |  | async | Aggregates other gigs since a date where given attendee phones appear (max 500). |
| `GigRepository.totals` | 274 |  | async | Aggregates filtered gigs: counts per status, distinct partners, approved payout, farmers. |
| `queryOf` | 328 |  | local | Builds the Mongo filter from GigFilter (status, agent, state, exact district, date range). |

#### `src/modules/gigs/services/admin-gigs.service.ts`

File role: Service: HO gig desk (post, edit, delete, assign, reopen, cancel, approve/reject, list, summary).

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `AdminGigsService.list` | 84 |  | async | Pages gigs for HO with partner names, payout source and missed flag. |
| `AdminGigsService.summary` | 109 |  | async | Gig totals for a date range, defaulting to the current IST month. |
| `AdminGigsService.get` | 119 |  | async | Returns one gig HO view; 404 when missing. |
| `AdminGigsService.create` | 123 |  | async | Validates times, fills settings defaults, takes a GIG id and inserts an open gig. |
| `AdminGigsService.update` | 172 |  | async | Edits an open unheld gig only, else GIG_CLOSED; empty payout means cohort-paid. |
| `AdminGigsService.remove` | 219 |  | async | Deletes a never-taken gig; otherwise GIG_CLOSED (cancel instead). |
| `AdminGigsService.assign` | 228 |  | async | Assigns an open future gig to an approved active in-cohort partner; GIG_TAKEN on race. |
| `AdminGigsService.reopen` | 284 |  | async | Returns a held gig to open, clearing proof and pay, logging an HO release. |
| `AdminGigsService.cancel` | 311 |  | async | Cancels any non-final gig with a reason. |
| `AdminGigsService.approve` | 328 |  | async | Approves a submitted gig, then lets the earning rules pay any gig-approval bonus to the taker. |
| `AdminGigsService.reject` | 340 |  | async | Rejects a submitted gig with a reason (delegates to review). |
| `AdminGigsService.review` | 346 |  | private | Moves a submitted gig to the decision, stamping reviewer and time. |
| `AdminGigsService.takerRate` | 362 |  | private async | Partner earning-cohort meeting-gig rate, else settings gig payout. |
| `AdminGigsService.move` | 371 |  | private async | Runs a transition; 404 if gone, GIG_CLOSED if moved meanwhile. |
| `AdminGigsService.require` | 382 |  | private async | Loads a gig or throws 404 not found. |
| `AdminGigsService.view` | 388 |  | private async | Builds HO view: partner, signed photo URLs, repeat attendee phones across recent gigs. |
| `filterOf` | 436 |  | local | Turns HO query into GigFilter with IST day range; VALIDATION_FAILED if from after to. |
| `timeCheck` | 454 |  | local | VALIDATION_FAILED unless end after start and, when required, start in the future. |
| `closed` | 463 |  | local | Builds the GIG_CLOSED conflict error asking HO to reload. |

#### `src/modules/gigs/services/gig-reads.service.ts`

File role: Service: read-only gig facts for other modules (Today, My Story, wallet, My Performance).

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `briefOf` | 44 |  | local | Maps a gig row to the brief shape other modules use, payout defaulting to 0. |
| `GigReadsService.soon` | 66 |  | async | Partner held gigs starting today or tomorrow IST, for Today tasks. |
| `GigReadsService.upcoming` | 78 |  | async | Partner accepted gigs from now on, for the My Story invite picker. |
| `GigReadsService.creditsFor` | 89 |  | async | Partner approved gigs as wallet credits (id, amount, approved_at). |
| `GigReadsService.monthStats` | 100 |  | async | Month-to-date approved gig stats plus count of upcoming accepted gigs. |

#### `src/modules/gigs/services/gigs.service.ts`

File role: Service: partner side of gigs (list, accept, release, check-in, attendees, photos, submit).

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `closed` | 129 |  | local | Builds a GIG_CLOSED conflict error with the given message. |
| `changed` | 130 |  | local | GIG_CLOSED conflict saying the gig changed, reload and retry. |
| `photoFolder` | 132 |  | local | Returns the private bucket folder for a partner gig photos. |
| `forCohort` | 135 |  | local | True when the gig has no cohorts or includes the partner cohort. |
| `GigsService.list` | 158 |  | async | Partner gig tabs: available (cached, nearest first, cohort rate) or mine/history paged. |
| `GigsService.summary` | 192 |  | async | Counts available and held gigs, month earnings and whether gig pay is enabled. |
| `GigsService.get` | 209 |  | async | Gig detail for its holder or an open in-cohort gig; else 404. |
| `GigsService.accept` | 225 |  | async | Takes a gig (idempotent for its holder) and warns if another gig is held that day. |
| `GigsService.release` | 251 |  | async | Gives back an accepted gig before its IST day, clearing cohort pay and logging release. |
| `GigsService.checkIn` | 280 |  | async | Checks in an accepted gig with server time and review flags; never refuses on location. |
| `GigsService.setAttendees` | 309 |  | async | Replaces attendee list on a checked-in gig; rejects invalid or duplicate mobiles. |
| `GigsService.photoTicket` | 340 |  | async | Signed PUT upload URL for one gig photo; FILE_TOO_LARGE over 5 MB, photo cap. |
| `GigsService.addPhoto` | 369 |  | async | Links an uploaded, verified photo to a checked-in gig; MEDIA_NOT_FOUND if upload missing. |
| `GigsService.removePhoto` | 413 |  | async | Unlinks a photo from a checked-in gig and deletes the file; idempotent. |
| `GigsService.submit` | 432 |  | async | Submits a checked-in gig once minimum farmers and photos met; else VALIDATION_FAILED. |
| `GigsService.available` | 462 |  | private async | Open future gigs for the partner cohort and state, sorted nearest first. |
| `GigsService.openRows` | 478 |  | private async | Open gigs from a per-process cache refreshed at most every TTL. |
| `GigsService.take` | 487 |  | private async | Conditionally accepts an open future gig, fixing cohort pay; GIG_TAKEN on race. |
| `GigsService.mine` | 519 |  | private async | Loads a gig held by the partner, else 404. |
| `GigsService.checkedIn` | 525 |  | private async | Loads the partner gig only if checked in, else GIG_CLOSED. |
| `GigsService.detail` | 537 |  | private async | Builds gig detail, showing attendees and signed photos only to the holder. |
| `GigsService.takerRate` | 558 |  | private async | Partner earning-cohort meeting-gig rate, else settings gig payout. |
| `GigsService.requireWorkingPartner` | 567 |  | private async | Requires an approved active partner; ACCOUNT_BLOCKED or PARTNER_NOT_APPROVED otherwise. |
| `gigTaken` | 585 |  | local | Builds the GIG_TAKEN conflict error. |
| `taken` | 589 |  | local | GIG_TAKEN if held by another partner, else GIG_CLOSED no longer open. |
| `tooManyPhotos` | 595 |  | local | VALIDATION_FAILED error for exceeding the gig photo cap. |
| `pointOf` | 602 |  | local | Partner GeoJSON location to lat/lng point, or null. |
| `viewOf` | 611 |  | local | Maps a gig to partner view; proof and review fields only on the caller own gig. |

### modules/payments

#### `src/modules/payments/controllers/admin-payment-credentials.controller.ts`

File role: Controller: HO merchant-key routes under /admin/payment-credentials, guarded by payments.credentials.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `who` | 40 |  | local | Normalises the admin email via actorOf for the two-person rule. |
| `AdminPaymentCredentialsController.overview` | 52 | `GET /admin/payment-credentials` · `@Can(payments.credentials)` |  | Delegates to PaymentCredentialsService.overview: live and waiting keys masked, fields, storage readiness. |
| `AdminPaymentCredentialsController.history` | 63 | `GET /admin/payment-credentials/:provider/history` · `@Can(payments.credentials)` |  | Delegates to PaymentCredentialsService.history: paged key sets of a provider. |
| `AdminPaymentCredentialsController.submit` | 78 | `POST /admin/payment-credentials/:provider` · `@Can(payments.credentials)` |  | Delegates to PaymentCredentialsService.submit: new keys stored pending, encrypted. |
| `AdminPaymentCredentialsController.test` | 96 | `POST /admin/payment-credentials/requests/:id/test` · `@Can(payments.credentials)` |  | Delegates to PaymentCredentialsService.test: gateway check of waiting keys. |
| `AdminPaymentCredentialsController.approve` | 112 | `POST /admin/payment-credentials/requests/:id/approve` · `@Can(payments.credentials)` |  | Delegates to PaymentCredentialsService.approve by a second admin. |
| `AdminPaymentCredentialsController.reject` | 127 | `POST /admin/payment-credentials/requests/:id/reject` · `@Can(payments.credentials)` |  | Delegates to PaymentCredentialsService.reject: waiting keys wiped. |
| `AdminPaymentCredentialsController.revoke` | 140 | `POST /admin/payment-credentials/:provider/revoke` · `@Can(payments.credentials)` |  | Delegates to PaymentCredentialsService.revoke: emergency wipe of live keys. |

#### `src/modules/payments/controllers/admin-payment-options.controller.ts`

File role: Controller: HO routes to list, audit, reorder and edit online payment options.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `AdminPaymentOptionsController.list` | 42 | `GET /admin/payment-options` · `@Can(payments.read)` |  | Delegates to PaymentOptionsService.list: all options plus online kill switch. |
| `AdminPaymentOptionsController.audit` | 52 | `GET /admin/payment-options/audit` · `@Can(payments.read)` |  | Delegates to PaymentOptionsService.auditLog: change log newest first. |
| `AdminPaymentOptionsController.reorder` | 61 | `PUT /admin/payment-options/order` · `@Can(payments.write)` |  | Delegates to PaymentOptionsService.reorder with every option id once. |
| `AdminPaymentOptionsController.update` | 73 | `PATCH /admin/payment-options/:id` · `@Can(payments.write)` |  | Delegates to PaymentOptionsService.update; VERSION_CONFLICT if stale. |

#### `src/modules/payments/controllers/payment-options.controller.ts`

File role: Controller: partner route returning the online payment options shown to their cohort.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `PaymentOptionsController.list` | 18 | `GET /payment-options` |  | Delegates to PaymentOptionsService.forPartner for the token partner. |

#### `src/modules/payments/payment-credentials.domain.ts`

File role: Domain: per-provider credential field specs and pure rules for validation, mode, masking, approval.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `TOKEN` | 45 |  | local | Builds a regex for a token of allowed characters with min and max length. |
| `splitFields` | 101 |  | export | Validates raw fields per provider spec (unknown, missing, malformed), skips optional blanks, splits into public and secret; returns errors. |
| `defaultMode` | 134 |  | export | Gives the suggested key mode: live in production, test elsewhere. |
| `mask` | 138 |  | export | Returns the value masked to its last four characters. |
| `approvalRefusal` | 151 |  | export | Returns not_pending, expired, same_person or not_tested, or null if approval allowed. |

#### `src/modules/payments/payments.domain.ts`

File role: Domain: closed provider list, defaults and pure rules for option visibility, text, order, actor.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `isPaymentProvider` | 12 |  | export | Type guard: string is razorpay, cashfree or phonepe. |
| `needsKeys` | 36 |  | export | Tells whether a payment provider needs merchant keys here, false for keyless providers whose keys live elsewhere. |
| `isShownTo` | 45 |  | export | True if option active and cohorts empty or include the partner cohort. |
| `textError` | 60 |  | export | Label or hint check: required name, max length, no links or angle brackets. |
| `orderError` | 75 |  | export | Error unless the ids list names every provider exactly once. |
| `actorOf` | 91 |  | export | Trims and lower-cases an email for audit and two-person comparison. |

#### `src/modules/payments/providers/credential-cipher.ts`

File role: Provider: AES-256-GCM seal and open of merchant secrets with the env key.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `CredentialCipher.configured` | 41 |  | get | True when the encryption key env var is set. |
| `CredentialCipher.seal` | 45 |  |  | Encrypts a value with AES-256-GCM and context as AAD; returns kid, iv, tag, ciphertext. |
| `CredentialCipher.open` | 62 |  |  | Decrypts a sealed value; throws on key id mismatch, bad tag, wrong context or tampering. |
| `CredentialCipher.requireKey` | 87 |  | private | Returns the key or throws CREDENTIALS_NOT_CONFIGURED (503). |
| `sealContext` | 99 |  | export | Builds the AAD string from row id, provider and field. |

#### `src/modules/payments/providers/gateway-verifier.ts`

File role: Provider: checks merchant keys against Razorpay, Cashfree or PhonePe without moving money.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `GatewayVerifier.verify` | 40 |  | async | Dispatches to the provider check; network failure returns a not-reachable result. |
| `GatewayVerifier.razorpay` | 64 |  | private async | Checks a Razorpay Key ID alone through Razorpay's public preferences call and reads the status. |
| `GatewayVerifier.cashfree` | 74 |  | private async | Calls Cashfree with app id and secret for the mode; 404 counts as accepted. |
| `GatewayVerifier.phonepe` | 90 |  | private async | Requests a PhonePe client-credentials token for the mode; reads the status. |
| `GatewayVerifier.read` | 108 |  | private | Maps HTTP status to accepted, refused (400/401/403) or error result message. |
| `label` | 135 |  | local | Returns the display name of a provider. |

#### `src/modules/payments/providers/payment-alerts.ts`

File role: Provider: logs and posts payment-credential change alerts to a Slack webhook.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `PaymentAlerts.send` | 20 |  | async | Logs the text and, if a webhook URL is set, posts it to Slack; errors only logged. |

#### `src/modules/payments/repositories/payment-credential.repository.ts`

File role: Repository: reads and conditional writes on vistaar_v2_payment_credentials, secrets excluded unless asked.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `retire` | 17 |  | local | Builds the $set that marks a set retired with status, wipes secrets, records who and why. |
| `isDuplicateKey` | 29 |  | local | True for a Mongo duplicate-key (11000) error. |
| `PaymentCredentialRepository.insertPending` | 40 |  | async | Inserts a pending set into vistaar_v2_payment_credentials; null on duplicate pending. |
| `PaymentCredentialRepository.find` | 53 |  |  | Reads one credential set by id without secrets. |
| `PaymentCredentialRepository.findSealed` | 61 |  |  | Reads one credential set by id including sealed secrets. |
| `PaymentCredentialRepository.activeSealed` | 65 |  |  | Reads the active set of a provider with sealed secrets. |
| `PaymentCredentialRepository.current` | 73 |  |  | Reads active, pending and approved sets of every provider, no secrets. |
| `PaymentCredentialRepository.history` | 80 |  | async | Paged credential sets of a provider, newest first, no secrets, with total. |
| `PaymentCredentialRepository.setTest` | 98 |  |  | Saves the gateway test result on a still-pending set. |
| `PaymentCredentialRepository.claimApproval` | 113 |  |  | Conditionally marks pending, unexpired, tested, other-submitter set approved. |
| `PaymentCredentialRepository.retireActive` | 135 |  | async | Retires the provider active set (except an id) as superseded or revoked, wiping secrets. |
| `PaymentCredentialRepository.promote` | 152 |  |  | Turns an approved set active with activation time. |
| `PaymentCredentialRepository.approving` | 164 |  | async | True if the provider has a set stuck in approved status. |
| `PaymentCredentialRepository.reject` | 172 |  |  | Marks a pending or approved set rejected, wiping secrets. |
| `PaymentCredentialRepository.expire` | 193 |  | async | Marks a pending past-expiry set expired by system, wiping secrets. |

#### `src/modules/payments/repositories/payment-option.repository.ts`

File role: Repository: vistaar_v2_payment_options with optimistic version, plus inserts/pages vistaar_v2_payment_option_audit.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `isDuplicateKey` | 19 |  | local | True for a Mongo duplicate-key (11000) error. |
| `PaymentOptionRepository.listAll` | 31 |  |  | Reads all rows of vistaar_v2_payment_options. |
| `PaymentOptionRepository.find` | 35 |  |  | Reads one payment option by provider id. |
| `PaymentOptionRepository.save` | 43 |  | async | Version 0 inserts with defaults; else update only at matching version, incrementing it; null on conflict. |
| `PaymentOptionRepository.reorder` | 80 |  | async | Bulk upsert setting order by position, creating unsaved options off. |
| `PaymentOptionRepository.log` | 101 |  | async | Inserts one row into vistaar_v2_payment_option_audit. |
| `PaymentOptionRepository.auditPage` | 105 |  | async | Paged audit rows newest first, optionally for one option, with total. |

#### `src/modules/payments/services/payment-credentials.service.ts`

File role: Service: merchant-key lifecycle; submit sealed, gateway test, two-person approval, reject, revoke, decrypt for use.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `PaymentCredentialsService.overview` | 125 |  | async | Per key-needing provider: field specs, masked active and pending sets, storage ready, suggested mode and available modes. |
| `PaymentCredentialsService.history` | 156 |  | async | Paged history of a provider key sets as views. |
| `PaymentCredentialsService.submit` | 168 |  | async | Refuses keyless providers, validates fields, seals secrets, inserts a pending set; CREDENTIALS_PENDING if one waits; audit and alert. |
| `PaymentCredentialsService.test` | 243 |  | async | Opens waiting keys, runs gateway check, saves result, audits. |
| `PaymentCredentialsService.approve` | 260 |  | async | Two-person rule, claims approval (or resumes a half-done one), retires the old live set, promotes, audits and alerts. |
| `PaymentCredentialsService.reject` | 297 |  | async | Rejects a waiting or stuck approved set, wipes it, audits, alerts. |
| `PaymentCredentialsService.revoke` | 319 |  | async | Wipes the live set of a provider; 404 if none; audits and alerts. |
| `PaymentCredentialsService.activeModes` | 341 |  | async | Map of providers with live keys to their mode, cached about a minute unless fresh is asked. |
| `PaymentCredentialsService.activePublicIds` | 351 |  | async | Map of providers to their live keys' public ids (Razorpay key_id), never secrets, cached about a minute. |
| `PaymentCredentialsService.activeSet` | 357 |  | private async | Loads live credential sets into one cached snapshot of modes and public ids, refreshed after a minute or on demand. |
| `PaymentCredentialsService.usable` | 379 |  | async | Decrypted live keys of a provider for taking a payment, or null. |
| `PaymentCredentialsService.liveRows` | 385 |  | private async | Current sets with stale pending ones expired and dropped. |
| `PaymentCredentialsService.expireStale` | 396 |  | private async | Expires a provider past-due pending set. |
| `PaymentCredentialsService.open` | 411 |  | private | Decrypts a set's secrets into its fields (Key-ID-only sets have none); wiped sets refused; CREDENTIALS_UNREADABLE on failure. |
| `PaymentCredentialsService.require` | 436 |  | private async | Loads a set without secrets or throws not found. |
| `PaymentCredentialsService.requirePending` | 442 |  | private async | Loads sealed set; must be pending and unexpired, else CREDENTIALS_NOT_PENDING or CREDENTIALS_EXPIRED. |
| `PaymentCredentialsService.refuseApproval` | 453 |  | private | Maps approvalRefusal to errors, APPROVER_IS_SUBMITTER or CREDENTIALS_NOT_TESTED. |
| `PaymentCredentialsService.requireStorage` | 485 |  | private | Throws CREDENTIALS_NOT_CONFIGURED when no encryption key is set. |
| `PaymentCredentialsService.notPending` | 494 |  | private | Builds the CREDENTIALS_NOT_PENDING conflict error. |
| `PaymentCredentialsService.expired` | 501 |  | private | Builds the CREDENTIALS_EXPIRED conflict error. |
| `PaymentCredentialsService.audit` | 508 |  | private async | Writes an audit row via the option repository; failure only logged. |
| `toView` | 536 |  | local | Maps a credential set to its API view with masked values, no secrets. |
| `summary` | 559 |  | local | Audit snapshot of a set: id, mode, public fields, masks. |
| `describe` | 568 |  | local | Joins public fields and masks into one line for alerts. |

#### `src/modules/payments/services/payment-options.service.ts`

File role: Service: HO on/off, label, cohorts, order of payment options with audit; partner list cached.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `PaymentOptionsService.forPartner` | 99 |  | async | Empty if online payments off; else configured active options shown to the partner's cohort, with the Razorpay key_id when set. |
| `PaymentOptionsService.list` | 124 |  | async | All options with defaults, key status, and the online-enabled flag. |
| `PaymentOptionsService.update` | 135 |  | async | Checks text, CREDENTIALS_MISSING if activating a key-needing option without fresh approved keys, cohorts; versioned save; VERSION_CONFLICT; audit. |
| `PaymentOptionsService.reorder` | 175 |  | async | Validates the full id list, writes the order, clears cache, audits. |
| `PaymentOptionsService.auditLog` | 190 |  | async | Paged audit log, optionally for one option. |
| `PaymentOptionsService.cachedRows` | 201 |  | private async | Per-process cached option rows with a TTL. |
| `PaymentOptionsService.checkCohorts` | 211 |  | private async | De-duplicates cohort keys and requires each to exist. |
| `PaymentOptionsService.audit` | 221 |  | private async | Writes an option audit row; failure only logged. |
| `withDefaults` | 250 |  | local | Every provider in display order, unsaved ones as off defaults, with key status. |
| `keyState` | 276 |  | local | Says whether a provider needs keys, is configured and in which mode; keyless providers count as configured. |
| `toAdminView` | 290 |  | local | Maps an option row to the admin view with key-required, configured flag and mode. |
| `checkText` | 306 |  | local | Trims and validates label or hint; VALIDATION_FAILED on error. |
| `pick` | 314 |  | local | Stored values of just the fields the change touches, for the audit before. |

### modules/stories

#### `src/modules/stories/controllers/admin-stories.controller.ts`

File role: Controller — HO read/delete routes for partners' My Story stats and saved stories.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `AdminStoriesController.summary` | 32 | `GET /admin/stories/summary` · `@Can(stories.read)` |  | Delegates to `AdminStoriesService.summary`: saves/shares totals by template, channel and day for a date range. |
| `AdminStoriesController.partners` | 42 | `GET /admin/stories/partners` · `@Can(stories.read)` |  | Delegates to `AdminStoriesService.partners`: paged per-partner story stats for a range. |
| `AdminStoriesController.partner` | 51 | `GET /admin/stories/partners/:agentId` · `@Can(stories.read)` |  | Delegates to `AdminStoriesService.partner`: one partner's daily stats and splits. |
| `AdminStoriesController.list` | 61 | `GET /admin/stories` · `@Can(stories.read)` |  | Delegates to `AdminStoriesService.list`: paged saved stories, filterable by partner or template. |
| `AdminStoriesController.get` | 73 | `GET /admin/stories/:id` · `@Can(stories.read)` |  | Delegates to `AdminStoriesService.get` for one story by UUID. |
| `AdminStoriesController.remove` | 80 | `DELETE /admin/stories/:id` · `@Can(stories.write)` |  | Delegates to `AdminStoriesService.remove`: deletes a story and its files; past shares stay counted. |

#### `src/modules/stories/controllers/admin-story-designs.controller.ts`

File role: Controller — HO CRUD and art upload for My Story designs.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `AdminStoryDesignsController.list` | 47 | `GET /admin/story-designs` · `@Can(content.read)` |  | Delegates to `StoryDesignsService.list`: paged designs with status filter. |
| `AdminStoryDesignsController.uploadImage` | 56 | `POST /admin/story-designs/image` · `@Can(content.write)` | async | Reads one multipart file (≤ 3 MB); throws FILE_REQUIRED or FILE_TOO_LARGE; passes buffer to `StoryDesignsService.uploadImage`. |
| `AdminStoryDesignsController.get` | 98 | `GET /admin/story-designs/:id` · `@Can(content.read)` |  | Delegates to `StoryDesignsService.get` for one design. |
| `AdminStoryDesignsController.create` | 105 | `POST /admin/story-designs` · `@Can(content.write)` |  | Delegates to `StoryDesignsService.create` with the admin email as author. |
| `AdminStoryDesignsController.update` | 118 | `PATCH /admin/story-designs/:id` · `@Can(content.write)` |  | Delegates to `StoryDesignsService.update` with the admin email. |
| `AdminStoryDesignsController.remove` | 132 | `DELETE /admin/story-designs/:id` · `@Can(content.write)` |  | Delegates to `StoryDesignsService.remove`: deletes design and its art. |

#### `src/modules/stories/controllers/admin-story-festivals.controller.ts`

File role: Controller — HO CRUD for Festival-template greetings.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `AdminStoryFestivalsController.list` | 35 | `GET /admin/story-festivals` · `@Can(content.read)` |  | Delegates to `StoryFestivalsService.list`: paged festivals by status. |
| `AdminStoryFestivalsController.get` | 44 | `GET /admin/story-festivals/:id` · `@Can(content.read)` |  | Delegates to `StoryFestivalsService.get` for one festival. |
| `AdminStoryFestivalsController.create` | 51 | `POST /admin/story-festivals` · `@Can(content.write)` |  | Delegates to `StoryFestivalsService.create` with the admin email. |
| `AdminStoryFestivalsController.update` | 64 | `PATCH /admin/story-festivals/:id` · `@Can(content.write)` |  | Delegates to `StoryFestivalsService.update` with the admin email. |
| `AdminStoryFestivalsController.remove` | 77 | `DELETE /admin/story-festivals/:id` · `@Can(content.write)` |  | Delegates to `StoryFestivalsService.remove`. |

#### `src/modules/stories/controllers/admin-story-samples.controller.ts`

File role: Controller — HO CRUD for ready-made farmer story quotes.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `AdminStorySamplesController.list` | 33 | `GET /admin/story-samples` · `@Can(content.read)` |  | Delegates to `StorySamplesService.list`: paged samples, optional is_active filter. |
| `AdminStorySamplesController.get` | 42 | `GET /admin/story-samples/:id` · `@Can(content.read)` |  | Delegates to `StorySamplesService.get` for one sample. |
| `AdminStorySamplesController.create` | 49 | `POST /admin/story-samples` · `@Can(content.write)` |  | Delegates to `StorySamplesService.create` with the admin email. |
| `AdminStorySamplesController.update` | 61 | `PATCH /admin/story-samples/:id` · `@Can(content.write)` |  | Delegates to `StorySamplesService.update` with the admin email. |
| `AdminStorySamplesController.remove` | 72 | `DELETE /admin/story-samples/:id` · `@Can(content.write)` |  | Delegates to `StorySamplesService.remove`. |

#### `src/modules/stories/controllers/admin-story-templates.controller.ts`

File role: Controller — HO CRUD for My Story "Choose a design" template cards.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `AdminStoryTemplatesController.list` | 34 | `GET /admin/story-templates` · `@Can(content.read)` |  | Delegates to `StoryTemplatesService.list`: every card in strip order, hidden included. |
| `AdminStoryTemplatesController.get` | 43 | `GET /admin/story-templates/:key` · `@Can(content.read)` |  | Delegates to `StoryTemplatesService.get` for one card by key. |
| `AdminStoryTemplatesController.create` | 50 | `POST /admin/story-templates` · `@Can(content.write)` |  | Delegates to `StoryTemplatesService.create` for a custom card, with admin email. |
| `AdminStoryTemplatesController.update` | 63 | `PATCH /admin/story-templates/:key` · `@Can(content.write)` |  | Delegates to `StoryTemplatesService.update` with admin email. |
| `AdminStoryTemplatesController.remove` | 77 | `DELETE /admin/story-templates/:key` · `@Can(content.write)` |  | Delegates to `StoryTemplatesService.remove` (custom cards only). |

#### `src/modules/stories/controllers/stories.controller.ts`

File role: Controller — partner's own My Story routes (content, image upload, save, share, delete), identity from token.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `StoriesController.content` | 51 | `GET /stories/content` |  | Delegates to `StoriesService.contentFor`: templates, designs, festivals, farmer stories, meetings for the partner. |
| `StoriesController.uploadImage` | 60 | `POST /stories/images` | async | Reads one multipart file within the kind's size limit; throws FILE_REQUIRED or FILE_TOO_LARGE; calls `StoriesService.uploadImage`. Throttled. |
| `StoriesController.list` | 105 | `GET /stories` |  | Delegates to `StoriesService.list`: caller's saved stories, newest first. |
| `StoriesController.get` | 111 | `GET /stories/:id` |  | Delegates to `StoriesService.get` for one of the caller's stories. |
| `StoriesController.save` | 120 | `POST /stories` |  | Delegates to `StoriesService.save`: saves or re-tops a story, optionally counting a share. Throttled. |
| `StoriesController.share` | 133 | `POST /stories/:id/share` |  | Delegates to `StoriesService.share` with the channel; returns 200. Throttled. |
| `StoriesController.remove` | 147 | `DELETE /stories/:id` |  | Delegates to `StoriesService.remove`: deletes the caller's story and its images. |

#### `src/modules/stories/dto/story-sample.dto.ts`

File role: DTO — validation shapes for HO story-sample create, update and list query.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `toOptionalBool` | 123 |  | local | Transforms query value 'true'/'false' or boolean to boolean; anything else to undefined. |

#### `src/modules/stories/repositories/story-design.repository.ts`

File role: Repository — Mongo reads and writes on `vistaar_v2_story_designs`.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `StoryDesignRepository.listActive` | 22 |  |  | Reads active, not-ended designs from `vistaar_v2_story_designs`, sorted by order, capped. |
| `StoryDesignRepository.page` | 34 |  | async | Paged find plus count on `vistaar_v2_story_designs` filtered by status via `queryOf`. |
| `StoryDesignRepository.findByKey` | 55 |  |  | Finds one design by `key` in `vistaar_v2_story_designs`. |
| `StoryDesignRepository.find` | 59 |  |  | Finds one design by `_id`. |
| `StoryDesignRepository.create` | 63 |  | async | Inserts a design row into `vistaar_v2_story_designs` and returns the plain object. |
| `StoryDesignRepository.update` | 70 |  |  | `$set` on a design by `_id`; returns the updated row or null. |
| `StoryDesignRepository.remove` | 77 |  | async | Deletes a design by `_id`; true if one was deleted. |
| `StoryDesignRepository.countByImage` | 82 |  |  | Counts designs whose `image_path` equals the given path. |
| `queryOf` | 88 |  | local | Maps a status (inactive/expired/scheduled/live/none) to a Mongo filter mirroring `festivalStatus`. |

#### `src/modules/stories/repositories/story-festival.repository.ts`

File role: Repository — Mongo reads and writes on `vistaar_v2_story_festivals`.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `StoryFestivalRepository.listActive` | 22 |  |  | Reads active, not-ended festivals from `vistaar_v2_story_festivals`, sorted, capped. |
| `StoryFestivalRepository.page` | 34 |  | async | Paged find plus count on `vistaar_v2_story_festivals` filtered by status via `queryOf`. |
| `StoryFestivalRepository.find` | 55 |  |  | Finds one festival by `_id`. |
| `StoryFestivalRepository.create` | 59 |  | async | Inserts a festival row and returns the plain object. |
| `StoryFestivalRepository.update` | 66 |  |  | `$set` on a festival by `_id`; returns updated row or null. |
| `StoryFestivalRepository.remove` | 76 |  | async | Deletes a festival by `_id`; true if deleted. |
| `queryOf` | 82 |  | local | Maps a festival status to the equivalent Mongo filter. |

#### `src/modules/stories/repositories/story-sample.repository.ts`

File role: Repository — Mongo reads and writes on `vistaar_v2_story_samples`.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `StorySampleRepository.listActive` | 20 |  |  | Reads active samples from `vistaar_v2_story_samples`, sorted by order, capped. |
| `StorySampleRepository.page` | 29 |  | async | Paged find plus count on `vistaar_v2_story_samples`, optional `is_active` filter. |
| `StorySampleRepository.find` | 50 |  |  | Finds one sample by `_id`. |
| `StorySampleRepository.create` | 54 |  | async | Inserts a sample row and returns the plain object. |
| `StorySampleRepository.update` | 61 |  |  | `$set` on a sample by `_id`; returns updated row or null. |
| `StorySampleRepository.remove` | 68 |  | async | Deletes a sample by `_id`; true if deleted. |

#### `src/modules/stories/repositories/story-stat.repository.ts`

File role: Repository — `$inc` day counters and range aggregations on `vistaar_v2_story_stats`.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `StoryStatRepository.bump` | 43 |  | async | One `$inc` upsert on the partner day row (`<agent>:<date>`) for saved, shares, template and channel. |
| `StoryStatRepository.perDay` | 68 |  | async | Aggregates `vistaar_v2_story_stats` by date in range: saved, shares, sharing partners per day. |
| `StoryStatRepository.totals` | 99 |  | async | One `$facet` pass: range saved/shares sums, distinct sharers, template and channel splits. |
| `StoryStatRepository.perPartner` | 152 |  | async | Groups range rows by partner (saved, shares, active days, last date), most shares first, paged with total. |
| `StoryStatRepository.forPartner` | 197 |  |  | Reads one partner day rows by `_id` range, sorted by date. |
| `sumCounts` | 206 |  | export | Sums a list of key-to-count maps key by key. |

#### `src/modules/stories/repositories/story-template.repository.ts`

File role: Repository — Mongo reads and writes on `vistaar_v2_story_templates`.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `StoryTemplateRepository.all` | 21 |  |  | Reads all template cards from `vistaar_v2_story_templates`, suggested first then order, capped. |
| `StoryTemplateRepository.find` | 30 |  |  | Finds one card by `_id` key. |
| `StoryTemplateRepository.create` | 34 |  | async | Inserts a card row and returns the plain object. |
| `StoryTemplateRepository.insertIfMissing` | 42 |  | async | Upserts with `$setOnInsert` only; true if a new card was inserted. |
| `StoryTemplateRepository.backfillBuiltins` | 52 |  | async | For each built-in key lacking `base`, sets base, builtin true, suggested false, empty fields, null window. |
| `StoryTemplateRepository.update` | 74 |  |  | `$set` on a card by key; returns updated row or null. |
| `StoryTemplateRepository.remove` | 88 |  | async | Deletes a card by key only when `builtin: false`; true if deleted. |
| `StoryTemplateRepository.countActive` | 95 |  |  | Counts cards with `is_active: true`. |

#### `src/modules/stories/repositories/story.repository.ts`

File role: Repository — partner-scoped reads and writes on `vistaar_v2_stories`.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `isDuplicateKey` | 26 |  | local | True when the error is a Mongo duplicate-key (11000) error. |
| `StoryRepository.listMine` | 36 |  |  | Reads a partner's stories from `vistaar_v2_stories`, newest `last_used_at` first, limited. |
| `StoryRepository.findMine` | 45 |  |  | Finds one story by `_id` and `agent_id`. |
| `StoryRepository.findBySignature` | 52 |  |  | Finds a partner's story by content `signature`. |
| `StoryRepository.upsert` | 65 |  | async | Upserts by agent and signature, setting content and `last_used_at`; retries once on duplicate key; returns story and created flag. |
| `StoryRepository.recordShare` | 98 |  |  | Increments `share_count` and sets last shared/used time on the partner's story; returns updated row. |
| `StoryRepository.beyond` | 113 |  |  | Reads the partner's stories past the newest `keep`. |
| `StoryRepository.removeMany` | 122 |  | async | Deletes the partner's stories with the given ids; no-op on empty list. |
| `StoryRepository.remove` | 129 |  | async | Deletes one story by `_id` and `agent_id`; true if deleted. |
| `StoryRepository.countUsing` | 137 |  |  | Counts the partner's stories whose image or photo path equals the path. |
| `StoryRepository.find` | 146 |  |  | Finds any story by `_id` (HO use, no agent filter). |
| `StoryRepository.page` | 150 |  | async | Paged find plus count on `vistaar_v2_stories`, optional agent_id and template filters. |

#### `src/modules/stories/services/admin-stories.service.ts`

File role: Service — HO My Story reporting (stats summaries, partner breakdowns) and story moderation.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `AdminStoriesService.summary` | 65 |  | async | Resolves range, reads totals and per-day stats, fills missing days with zeros; returns totals, template/channel splits, by_day. |
| `AdminStoriesService.partners` | 92 |  | async | Pages per-partner stats for range and joins partner name/phone/cohort/location from `AgentsService`. |
| `AdminStoriesService.partner` | 111 |  | async | Requires the agent, reads their day rows; returns partner ref, totals, template/channel sums and days. |
| `AdminStoriesService.list` | 146 |  | async | Pages stories by agent/template, signs images via `StoriesService.views`, adds agent_id. |
| `AdminStoriesService.get` | 163 |  | async | Finds a story by id, throws not found if missing; returns signed view with agent_id. |
| `AdminStoriesService.remove` | 171 |  | async | Deletes the story under its owner, throws not found if missing, then drops its unused files. |
| `AdminStoriesService.refs` | 180 |  | private async | Lists agents by ids (unverified included) and maps agent_id to partner ref. |
| `range` | 192 |  | local | Resolves from/to via `statsRange` against today IST; throws VALIDATION_FAILED on error. |
| `nextDay` | 198 |  | local | Returns the next YYYY-MM-DD date. |
| `refOf` | 204 |  | local | Builds a partner ref from an agent record, profile first then preview. |
| `bareRef` | 215 |  | local | Partner ref with only agent_id, other fields null. |

#### `src/modules/stories/services/stories.service.ts`

File role: Service — partner's My Story: image upload with receipts, save/share/delete, 20-story cap, picker content.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `StoriesService.uploadImage` | 176 |  | async | Checks bytes are an image of allowed size (FILE_TYPE_NOT_ALLOWED, IMAGE_SIZE_NOT_ALLOWED); saves privately with signed receipt stem; returns signed URL. |
| `StoriesService.list` | 217 |  | async | Returns the partner newest 20 stories with signed image URLs. |
| `StoriesService.get` | 221 |  | async | Returns one of the partner stories, signed; not found otherwise. |
| `StoriesService.save` | 232 |  | async | Verifies uploads, upserts by signature, optionally records share, bumps stats, drops replaced render, trims to 20. |
| `StoriesService.share` | 291 |  | async | Records a share on the partner story, bumps day stats; throws not found if missing. |
| `StoriesService.remove` | 306 |  | async | Deletes the partner story (not found if missing) and drops its unused files. |
| `StoriesService.contentFor` | 320 |  | async | Merges shared content with the partner events, meetings and gigs as date-sorted meeting options. |
| `StoriesService.sharedContent` | 363 |  | private | Returns shared picker content from a short in-memory cache. |
| `StoriesService.buildShared` | 367 |  | private async | Builds live templates, designs, festivals and farmer stories (testimonials plus HO samples). |
| `StoriesService.views` | 398 |  | async | Signs all story images in one call and maps rows to views. |
| `StoriesService.farmerStories` | 407 |  | private | Returns cached approved-testimonial farmer stories. |
| `StoriesService.loadFarmerStories` | 411 |  | private async | Loads approved testimonials via `TestimonialsService.forStories` and maps them to farmer stories. |
| `StoriesService.requireMine` | 428 |  | private async | Finds the partner story or throws not found. |
| `StoriesService.requireUpload` | 438 |  | private async | Checks path is in caller folder and of this kind via fresh receipt or bucket metadata; else IMAGE_NOT_FOUND. |
| `StoriesService.trim` | 462 |  | private async | Deletes stories beyond the newest 20 and their files. |
| `StoriesService.dropFiles` | 472 |  | async | Drops each distinct image and photo file of the removed stories. |
| `StoriesService.dropFile` | 482 |  | private async | Removes a file from storage only when no remaining story uses it. |
| `toView` | 488 |  | local | Maps a story row and signed URL map to the API view. |
| `imageNotFound` | 517 |  | local | Builds IMAGE_NOT_FOUND error naming story image or photo. |

#### `src/modules/stories/services/story-designs.service.ts`

File role: Service — HO story designs CRUD, public art upload, palette and window checks, cached live list.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `isDuplicateKey` | 72 |  | local | True when the error is a Mongo duplicate-key (11000) error. |
| `StoryDesignsService.live` | 87 |  | async | Returns cached active designs that are live now, as partner views. |
| `StoryDesignsService.exists` | 95 |  | async | True when a design with this key exists, live or not. |
| `StoryDesignsService.uploadImage` | 100 |  | async | Checks image type and 9:16 size (FILE_TYPE_NOT_ALLOWED, IMAGE_SIZE_NOT_ALLOWED); saves public; returns path and URL. |
| `StoryDesignsService.list` | 128 |  | async | Pages designs by status and maps them to admin views. |
| `StoryDesignsService.get` | 146 |  | async | Returns one design as admin view; not found if missing. |
| `StoryDesignsService.create` | 150 |  | async | Validates label, palette, window, image; inserts design, clears cache; DESIGN_EXISTS on duplicate key. |
| `StoryDesignsService.update` | 189 |  | async | Validates and sets sent fields, resolves new art and overlay, checks window, clears cache, drops old art. |
| `StoryDesignsService.remove` | 231 |  | async | Deletes the design (not found if missing), clears cache, drops its unused art. |
| `StoryDesignsService.activeRows` | 239 |  | private async | Returns active designs from the one-minute cache. |
| `StoryDesignsService.require` | 243 |  | private async | Finds a design by id or throws not found. |
| `StoryDesignsService.resolveImage` | 250 |  | private async | Reads uploaded public file URL and size; IMAGE_NOT_FOUND if missing; none for null path. |
| `StoryDesignsService.dropImage` | 268 |  | private async | Removes art from storage only when no design still uses it. |
| `toPartnerView` | 274 |  | local | Maps a design to partner view; overlay 0 without art. |
| `toAdminView` | 287 |  | local | Adds status and contrast warnings to a design row. |
| `paletteOf` | 295 |  | local | Completes the colour palette or throws VALIDATION_FAILED. |
| `overlayFor` | 306 |  | local | Returns the overlay, defaulting to the readable value when art exists, else 0. |
| `checkLabel` | 311 |  | local | Throws VALIDATION_FAILED when the English name is missing. |
| `toDate` | 318 |  | local | Converts an optional date string to Date or null. |
| `checkWindow` | 322 |  | local | Throws VALIDATION_FAILED when end is not after start. |
| `unique` | 327 |  | local | Removes duplicates from a list. |

#### `src/modules/stories/services/story-festivals.service.ts`

File role: Service — HO festival greetings CRUD with text and window checks, cached live list.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `isDuplicateKey` | 41 |  | local | True when the error is a Mongo duplicate-key (11000) error. |
| `StoryFestivalsService.live` | 53 |  | async | Returns cached active festivals that are live now: key, label, emoji, text. |
| `StoryFestivalsService.list` | 65 |  | async | Pages festivals by status and maps them to admin views. |
| `StoryFestivalsService.get` | 83 |  | async | Returns one festival as admin view; not found if missing. |
| `StoryFestivalsService.create` | 87 |  | async | Validates texts and window, inserts festival, clears cache; FESTIVAL_EXISTS on duplicate key. |
| `StoryFestivalsService.update` | 122 |  | async | Validates and sets sent fields, cleans text, checks merged window, clears cache. |
| `StoryFestivalsService.remove` | 152 |  | async | Deletes the festival (not found if missing) and clears cache. |
| `StoryFestivalsService.activeRows` | 158 |  | private async | Returns active festivals from the one-minute cache. |
| `StoryFestivalsService.require` | 164 |  | private async | Finds a festival by id or throws not found. |
| `toAdminView` | 171 |  | local | Adds the computed status to a festival row. |
| `toDate` | 175 |  | local | Converts an optional date string to Date or null. |
| `checkWindow` | 179 |  | local | Throws VALIDATION_FAILED when end is not after start. |
| `checkTexts` | 184 |  | local | Requires English name and valid greeting text; throws VALIDATION_FAILED. |
| `cleanText` | 197 |  | local | Keeps only trimmed headline and body per language. |

#### `src/modules/stories/services/story-samples.service.ts`

File role: Service — HO ready-made farmer quotes CRUD with cached active list.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `isDuplicateKey` | 23 |  | local | True when the error is a Mongo duplicate-key (11000) error. |
| `StorySamplesService.live` | 34 |  |  | Returns active samples from the one-minute cache. |
| `StorySamplesService.list` | 38 |  | async | Pages samples with optional is_active filter. |
| `StorySamplesService.get` | 48 |  | async | Returns one sample or throws not found. |
| `StorySamplesService.create` | 54 |  | async | Inserts a trimmed sample (stars default 5), clears cache; SAMPLE_EXISTS on duplicate key. |
| `StorySamplesService.update` | 85 |  | async | Sets sent fields and author, clears cache; not found if missing. |
| `StorySamplesService.remove` | 101 |  | async | Deletes a sample (not found if missing) and clears cache. |

#### `src/modules/stories/services/story-templates.service.ts`

File role: Service — HO "Choose a design" cards CRUD, built-in protection, seeding, cached live list.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `isBuiltinKey` | 51 |  | local | True when the key is one of the six built-in layouts. |
| `isDuplicateKey` | 54 |  | local | True when the error is a Mongo duplicate-key (11000) error. |
| `StoryTemplatesService.live` | 72 |  | async | Returns cached live cards as partner views, base defaulting to own key. |
| `StoryTemplatesService.list` | 90 |  | async | Returns every card in strip order as admin views. |
| `StoryTemplatesService.get` | 96 |  | async | Returns one card as admin view; not found if missing. |
| `StoryTemplatesService.create` | 101 |  | async | Rejects built-in keys, validates, inserts custom card, clears cache; TEMPLATE_EXISTS on duplicate. |
| `StoryTemplatesService.update` | 147 |  | async | Validates, keeps at least one card shown, sets cleaned sent fields, checks window, clears cache. |
| `StoryTemplatesService.remove` | 187 |  | async | Deletes a custom card only, keeping one shown; VALIDATION_FAILED for built-ins. |
| `StoryTemplatesService.seed` | 203 |  | async | Backfills built-ins and inserts missing cards; returns added keys, clears cache. |
| `StoryTemplatesService.designExists` | 216 |  |  | Delegates to `StoryDesignsService.exists`. |
| `StoryTemplatesService.check` | 220 |  | private async | Validates English label/hint, texts, fields and default design; throws VALIDATION_FAILED. |
| `StoryTemplatesService.rows` | 244 |  | private async | Returns all cards from the one-minute cache. |
| `StoryTemplatesService.require` | 248 |  | private async | Finds a card by key or throws not found. |
| `StoryTemplatesService.toAdminView` | 254 |  | private async | Adds key, status and a warning when the default design is missing. |
| `statusOf` | 269 |  | local | Computes card status, treating missing dates as no bound. |
| `invalid` | 283 |  | local | Builds a VALIDATION_FAILED error with the message. |
| `localizedErrors` | 287 |  | local | Returns an error when the English name or description is missing. |
| `toDate` | 297 |  | local | Converts an optional date string to Date or null. |
| `checkWindow` | 301 |  | local | Throws VALIDATION_FAILED when end is not after start. |
| `cleanTexts` | 306 |  | local | Keeps only trimmed kicker and cta per language. |
| `cleanFields` | 318 |  | local | Trims pre-fill fields and drops empty values and languages. |
| `cleanEmojis` | 333 |  | local | Trims, drops empty and de-duplicates emojis. |

#### `src/modules/stories/stories.domain.ts`

File role: Domain — pure My Story rules: signatures, image paths and receipts, size checks, status windows, palettes, text validators, IST dates.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `langName` | 26 |  | export | Maps a language code to its name (English, Hindi), else returns the code. |
| `signatureOf` | 87 |  | export | SHA-256 of the story config fields, photo path and card in fixed order, identifying the same story. |
| `storyImageFolder` | 136 |  | export | Returns `vistaar/stories/<agentId>`. |
| `receiptPayload` | 161 |  | local | Builds the string signed for an upload receipt. |
| `hmac` | 168 |  | local | HMAC-SHA256 of payload, first 20 hex chars. |
| `receiptStem` | 172 |  | export | Builds upload file stem encoding kind, size, issued time and HMAC signature. |
| `readReceipt` | 184 |  | export | Parses a path's receipt and verifies its signature timing-safely; returns receipt or null. |
| `ownsImage` | 210 |  | export | True when path matches the story image pattern inside the partner's own folder. |
| `storyImageError` | 223 |  | export | Returns a message when a render is not 9:16 and 540–2160 wide, or a photo is out of 200–4096 px. |
| `festivalStatus` | 269 |  | export | Returns inactive, expired, scheduled or live from is_active and window. |
| `festivalTextError` | 280 |  | export | Requires English greeting and headline plus body for each language. |
| `windowError` | 292 |  | export | Returns a message when end is not after start. |
| `colorName` | 344 |  | local | Maps a colour key to its editor label. |
| `withAlpha` | 348 |  | local | Returns uppercase #RRGGBB plus the given alpha byte. |
| `completeColors` | 361 |  | export | Validates required and hex colours and derives optional ones; returns full palette or error. |
| `luminance` | 398 |  | local | WCAG relative luminance of a hex colour. |
| `contrastRatio` | 406 |  | export | WCAG contrast ratio of two colours. |
| `designWarnings` | 418 |  | export | Warns when text-on-background (no art) or highlight contrast is below 3. |
| `designImageError` | 453 |  | export | Returns a message when design art is not 720–2160 wide or not 9:16. |
| `fieldName` | 498 |  | local | Maps a template field key to its display name. |
| `templateFieldsError` | 501 |  | export | Validates pre-fill fields: en/hi only, allowed keys, strings, length limits. |
| `templateTextsError` | 531 |  | export | Requires English card words, en/hi only, kicker per language, string cta. |
| `istDate` | 554 |  | export | Returns the IST YYYY-MM-DD date of a moment. |
| `shiftDate` | 559 |  | export | Returns the date n days before a YYYY-MM-DD date. |
| `statsRange` | 570 |  | export | Resolves from/to (default last 30 days); errors if reversed or over 92 days. |

### modules/feedback

#### `src/modules/feedback/controllers/admin-feedback.controller.ts`

File role: Controller: HO routes to list, summarise and follow up partner NPS feedback and edit reason chips.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `AdminFeedbackController.list` | 35 | `GET /admin/feedback` · `@Can(feedback.read)` |  | Delegates to AdminFeedbackService.list with the filter query; returns a page of feedback. |
| `AdminFeedbackController.summary` | 47 | `GET /admin/feedback/summary` · `@Can(feedback.read)` |  | Delegates to AdminFeedbackService.summary for from/to IST dates. |
| `AdminFeedbackController.reasons` | 57 | `GET /admin/feedback/reasons` · `@Can(feedback.read)` |  | Delegates to AdminFeedbackService.reasons; returns question and chips per NPS group. |
| `AdminFeedbackController.setReasons` | 66 | `PUT /admin/feedback/reasons` · `@Can(feedback.write)` |  | Delegates to AdminFeedbackService.setReasons with the DTO and admin email. |
| `AdminFeedbackController.get` | 79 | `GET /admin/feedback/:id` · `@Can(feedback.read)` |  | Delegates to AdminFeedbackService.get for one feedback id. |
| `AdminFeedbackController.setFollowUp` | 86 | `PATCH /admin/feedback/:id/follow-up` · `@Can(feedback.write)` |  | Delegates to AdminFeedbackService.setFollowUp with id, DTO and admin email. |

#### `src/modules/feedback/controllers/admin-product-suggestions.controller.ts`

File role: Controller: HO routes to list, rank and update partner product suggestions.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `AdminProductSuggestionsController.list` | 26 | `GET /admin/product-suggestions` · `@Can(feedback.read)` |  | Delegates to AdminFeedbackService.listSuggestions; returns a page of suggestions. |
| `AdminProductSuggestionsController.summary` | 38 | `GET /admin/product-suggestions/summary` · `@Can(feedback.read)` |  | Delegates to AdminFeedbackService.suggestionCounts; counts per status. |
| `AdminProductSuggestionsController.top` | 45 | `GET /admin/product-suggestions/top` · `@Can(feedback.read)` |  | Delegates to AdminFeedbackService.topProducts with from, to, limit. |
| `AdminProductSuggestionsController.get` | 55 | `GET /admin/product-suggestions/:ref` · `@Can(feedback.read)` |  | Delegates to AdminFeedbackService.getSuggestion by SUG ref. |
| `AdminProductSuggestionsController.update` | 62 | `PATCH /admin/product-suggestions/:ref` · `@Can(feedback.write)` |  | Delegates to AdminFeedbackService.updateSuggestion with ref, DTO and admin email. |

#### `src/modules/feedback/controllers/feedback.controller.ts`

File role: Controller: partner routes to read NPS reason chips, submit feedback and suggest products.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `FeedbackController.reasons` | 34 | `GET /feedback/reasons` |  | Delegates to FeedbackService.reasons; returns NPS reason chips. |
| `FeedbackController.submit` | 44 | `POST /feedback` |  | Throttled; delegates to FeedbackService.submit with token partner id and DTO. |
| `FeedbackController.suggest` | 59 | `POST /feedback/suggestions` |  | Throttled; delegates to FeedbackService.suggest with token partner id and DTO. |

#### `src/modules/feedback/feedback.domain.ts`

File role: Domain: pure NPS, reason-cleaning, IST date and suggestion-reference rules for feedback.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `npsBucket` | 11 |  | export | Score to bucket: 0-6 detractor, 7-8 passive, 9-10 promoter. |
| `npsScore` | 17 |  | export | Bucket counts to NPS (promoters minus detractors percent, rounded); null when no answers. |
| `withDefaults` | 89 |  | export | Merges stored reason sets over DEFAULT_NPS_REASONS, keeping only well-formed buckets. |
| `cleanReasons` | 112 |  | export | Trims reasons, drops blanks and case-insensitive duplicates, keeps order. |
| `istDate` | 138 |  | export | Date to its IST calendar day as YYYY-MM-DD. |
| `followUpDueAt` | 146 |  | export | Adds working days (Sundays skipped, default 2) from the IST day; returns end of that IST day. |
| `formatSuggestionRef` | 170 |  | export | Number to SUG- reference padded to 6 digits. |
| `productKey` | 179 |  | export | Product name to grouping key: trimmed, lowercased, whitespace collapsed. |
| `istRange` | 188 |  | export | IST from/to dates to UTC start/end instants; null if invalid, reversed or over 366 days. |
| `istDayStart` | 200 |  | export | Date to the UTC instant of its IST midnight. |
| `escapeRegex` | 205 |  | export | Escapes regex special characters in a string. |

#### `src/modules/feedback/repositories/feedback.repository.ts`

File role: Repository: Mongo reads/writes and stats on vistaar_v2_feedback.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `FeedbackRepository.create` | 40 |  | async | Inserts one row in vistaar_v2_feedback and returns it as a plain object. |
| `FeedbackRepository.countSince` | 46 |  |  | Counts a partner's vistaar_v2_feedback rows created since a date. |
| `FeedbackRepository.page` | 52 |  | async | Filtered, sorted, paged find on vistaar_v2_feedback plus total count. |
| `FeedbackRepository.find` | 72 |  |  | Reads one vistaar_v2_feedback row by ObjectId. |
| `FeedbackRepository.setFollowUp` | 80 |  |  | Sets follow_up status, note, done_by, done_at on a vistaar_v2_feedback row that has a follow-up. |
| `FeedbackRepository.stats` | 106 |  | async | Aggregates vistaar_v2_feedback in a date range: bucket counts, star counts, top 60 reasons. |
| `FeedbackRepository.followUpCounts` | 135 |  | async | Counts open and overdue follow-ups in vistaar_v2_feedback. |
| `queryOf` | 149 |  | local | Builds the vistaar_v2_feedback filter: bucket, partner, follow-up/overdue, dates, word search. |

#### `src/modules/feedback/repositories/product-suggestion.repository.ts`

File role: Repository: Mongo reads/writes and top-product aggregation on vistaar_v2_product_suggestions.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `ProductSuggestionRepository.create` | 42 |  | async | Inserts one row in vistaar_v2_product_suggestions and returns it. |
| `ProductSuggestionRepository.countSince` | 47 |  |  | Counts a partner's vistaar_v2_product_suggestions rows since a date. |
| `ProductSuggestionRepository.page` | 53 |  | async | Filtered, sorted, paged find on vistaar_v2_product_suggestions plus total. |
| `ProductSuggestionRepository.find` | 73 |  |  | Reads one vistaar_v2_product_suggestions row by SUG ref. |
| `ProductSuggestionRepository.update` | 77 |  |  | Sets status, ho_note, updated_by on a vistaar_v2_product_suggestions row; returns updated row. |
| `ProductSuggestionRepository.statusCounts` | 87 |  | async | Groups vistaar_v2_product_suggestions by status with counts. |
| `ProductSuggestionRepository.topProducts` | 96 |  | async | Aggregates vistaar_v2_product_suggestions in range by product_key: count, partners, up to 10 crops, last date. |
| `queryOf` | 142 |  | local | Builds the suggestions filter: status, partner, dates, word search over ref, product, crop, note, partner. |

#### `src/modules/feedback/services/admin-feedback.service.ts`

File role: Service: HO business rules for feedback lists, NPS summary, call-backs, reason chips and suggestions.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `AdminFeedbackService.list` | 103 |  | async | Validates optional date range, pages feedback with filters, maps rows to views with overdue flag. |
| `AdminFeedbackService.get` | 127 |  | async | Returns one feedback view; not found for bad or unknown id. |
| `AdminFeedbackService.summary` | 134 |  | async | Range to NPS, bucket counts, star histogram and average, reasons per bucket, open/overdue call-backs; VALIDATION_FAILED on bad range. |
| `AdminFeedbackService.setFollowUp` | 178 |  | async | Marks call-back done (records HO) or reopens; VALIDATION_FAILED if feedback has no call-back, else not found. |
| `AdminFeedbackService.reasons` | 199 |  | async | Reads settings feedback_reasons merged with defaults. |
| `AdminFeedbackService.setReasons` | 203 |  | async | Cleans chips per bucket, requires at least one each (VALIDATION_FAILED), saves to settings. |
| `AdminFeedbackService.listSuggestions` | 216 |  | async | Validates optional range, pages suggestions with filters, maps to views. |
| `AdminFeedbackService.suggestionCounts` | 234 |  | async | Returns suggestion counts for every status, zero-filled. |
| `AdminFeedbackService.topProducts` | 243 |  | async | Validates IST range (VALIDATION_FAILED) and returns most-asked products, default 20. |
| `AdminFeedbackService.getSuggestion` | 253 |  | async | Returns one suggestion view by SUG ref; not found if bad or missing. |
| `AdminFeedbackService.updateSuggestion` | 261 |  | async | Updates status and/or HO note with updater; VALIDATION_FAILED if nothing sent, not found if missing. |
| `optionalRange` | 284 |  | local | Optional from/to to start/end bounds via istRange; one end alone allowed; VALIDATION_FAILED if invalid. |
| `invalid` | 298 |  | local | Builds a VALIDATION_FAILED bad-request error with the message. |
| `toFeedbackView` | 302 |  | export | Maps a feedback row to the HO view, adding follow_up overdue flag. |
| `toSuggestionView` | 324 |  | local | Maps a suggestion row to the HO view with null defaults. |

#### `src/modules/feedback/services/feedback.service.ts`

File role: Service: partner feedback and product-suggestion submission with daily caps and partner snapshot.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `FeedbackService.reasons` | 44 |  | async | Reads settings feedback_reasons merged with defaults. |
| `FeedbackService.submit` | 48 |  | async | Enforces 10/day cap (FEEDBACK_LIMIT), snapshots partner, saves NPS answer; detractor opens call-back due in 2 working days. |
| `FeedbackService.suggest` | 88 |  | async | Enforces 20/day cap (FEEDBACK_LIMIT), takes SUG- number, saves suggestion with product_key and partner snapshot. |
| `checkCap` | 116 |  | local | Throws 429 FEEDBACK_LIMIT when used count reaches the max. |
| `snapshot` | 120 |  | local | Copies partner name, phone, cohort, district, state, owner from the agent record. |

### modules/testimonials

#### `src/modules/testimonials/controllers/admin-testimonial-submissions.controller.ts`

File role: Controller: HO routes to review partner testimonial submissions (approve, reject, remove, withdraw consent).

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `AdminTestimonialSubmissionsController.list` | 37 | `GET /admin/testimonial-submissions` · `@Can(testimonials.read)` |  | Delegates to SubmissionsService.list; page of partner submissions. |
| `AdminTestimonialSubmissionsController.summary` | 49 | `GET /admin/testimonial-submissions/summary` · `@Can(testimonials.read)` |  | Delegates to SubmissionsService.summary; counts per status. |
| `AdminTestimonialSubmissionsController.get` | 56 | `GET /admin/testimonial-submissions/:id` · `@Can(testimonials.read)` |  | Delegates to SubmissionsService.get for a UUID id. |
| `AdminTestimonialSubmissionsController.approve` | 63 | `POST /admin/testimonial-submissions/:id/approve` · `@Can(testimonials.write)` |  | Delegates to SubmissionsService.approve with id and admin email. |
| `AdminTestimonialSubmissionsController.reject` | 77 | `POST /admin/testimonial-submissions/:id/reject` · `@Can(testimonials.write)` |  | Delegates to SubmissionsService.reject with id, reason, admin email. |
| `AdminTestimonialSubmissionsController.remove` | 89 | `POST /admin/testimonial-submissions/:id/remove` · `@Can(testimonials.write)` |  | Delegates to SubmissionsService.remove with id, optional reason, admin email. |
| `AdminTestimonialSubmissionsController.withdrawConsent` | 104 | `POST /admin/testimonial-submissions/:id/withdraw-consent` · `@Can(testimonials.write)` |  | Delegates to SubmissionsService.withdrawConsent with id, reason, admin email. |

#### `src/modules/testimonials/controllers/admin-testimonials.controller.ts`

File role: Controller: HO CRUD routes and media upload for Vistaar rows in shared product_testimonials.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `AdminTestimonialsController.list` | 50 | `GET /admin/testimonials` · `@Can(testimonials.read)` |  | Delegates to TestimonialsService.list; page of Vistaar testimonials. |
| `AdminTestimonialsController.summary` | 62 | `GET /admin/testimonials/summary` · `@Can(testimonials.read)` |  | Delegates to TestimonialsService.summary; counts per status. |
| `AdminTestimonialsController.uploadMedia` | 69 | `POST /admin/testimonials/media` · `@Can(testimonials.write)` | async | Reads one multipart file (FILE_REQUIRED, FILE_TOO_LARGE checks) and delegates to TestimonialsService.uploadMedia. |
| `AdminTestimonialsController.get` | 116 | `GET /admin/testimonials/:id` · `@Can(testimonials.read)` |  | Delegates to TestimonialsService.get for one id. |
| `AdminTestimonialsController.create` | 123 | `POST /admin/testimonials` · `@Can(testimonials.write)` |  | Delegates to TestimonialsService.create with DTO and admin email. |
| `AdminTestimonialsController.update` | 136 | `PATCH /admin/testimonials/:id` · `@Can(testimonials.write)` |  | Delegates to TestimonialsService.update with id, DTO and admin email. |
| `AdminTestimonialsController.remove` | 150 | `DELETE /admin/testimonials/:id` · `@Can(testimonials.write)` |  | Delegates to TestimonialsService.remove; hard delete. |

#### `src/modules/testimonials/controllers/testimonials.controller.ts`

File role: Controller: partner routes for consent wording, upload tickets, submitting, own list, library and view/share counts.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `TestimonialsController.consent` | 52 | `GET /testimonials/consent` |  | Delegates to SubmissionsService.consent; current farmer consent wording and version. |
| `TestimonialsController.uploadTicket` | 61 | `POST /testimonials/uploads` |  | Throttled; delegates to SubmissionsService.uploadTicket for a signed PUT URL. |
| `TestimonialsController.submit` | 75 | `POST /testimonials` |  | Throttled; delegates to SubmissionsService.submit for the token partner. |
| `TestimonialsController.mine` | 88 | `GET /testimonials/mine` |  | Delegates to SubmissionsService.mine; partner's own submissions page. |
| `TestimonialsController.library` | 99 | `GET /testimonials/library` |  | Delegates to SubmissionsService.library; approved stories page. |
| `TestimonialsController.getMine` | 110 | `GET /testimonials/mine/:id` |  | Delegates to SubmissionsService.getMine for one own submission. |
| `TestimonialsController.view` | 119 | `POST /testimonials/:id/view` |  | Throttled; delegates to SubmissionsService.count to increment views. |
| `TestimonialsController.share` | 129 | `POST /testimonials/:id/share` |  | Throttled; delegates to SubmissionsService.count to increment shares. |

#### `src/modules/testimonials/repositories/consent.repository.ts`

File role: Repository: Mongo reads/writes on vistaar_v2_testimonial_consents.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `isDuplicateKey` | 22 |  | local | True when the error is a Mongo duplicate-key (11000) error. |
| `ConsentRepository.insert` | 34 |  | async | Inserts a consent in vistaar_v2_testimonial_consents; ignores duplicate key (retry-safe). |
| `ConsentRepository.find` | 42 |  |  | Reads one vistaar_v2_testimonial_consents row by id. |
| `ConsentRepository.findMany` | 46 |  | async | Reads vistaar_v2_testimonial_consents rows by ids into a map. |
| `ConsentRepository.withdraw` | 56 |  |  | Marks a given consent withdrawn with who, why, when; returns updated row or null. |

#### `src/modules/testimonials/repositories/review.repository.ts`

File role: Repository: raw-driver writes on shared product_reviews, always filtered on _id + source vistaar.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `ReviewRepository.rows` | 59 |  | get private | Getter for the raw product_reviews collection. |
| `ReviewRepository.show` | 67 |  | async | Upserts a product_reviews row by _id + source vistaar, setting verified, not deleted, verified_by. |
| `ReviewRepository.hide` | 91 |  | async | Sets deleted and deleted_by on the Vistaar product_reviews row. |
| `ReviewRepository.erase` | 99 |  | async | Deletes the Vistaar product_reviews row by _id + source. |

#### `src/modules/testimonials/repositories/submission.repository.ts`

File role: Repository: reads and writes partner testimonial submissions on vistaar_v2_testimonials

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `isDuplicateKey` | 49 |  | local | True if the error is a Mongo duplicate key (11000) |
| `SubmissionRepository.insert` | 60 |  | async | Inserts a submission; returns false on duplicate _id instead of throwing |
| `SubmissionRepository.find` | 70 |  |  | Reads one submission by _id |
| `SubmissionRepository.mediaTaken` | 75 |  | async | True if this partner already has a submission using the media path |
| `SubmissionRepository.findMine` | 83 |  |  | Reads one submission by _id owned by the partner |
| `SubmissionRepository.pageMine` | 90 |  | async | Pages the partner's submissions, optional status, newest first |
| `SubmissionRepository.library` | 102 |  |  | Pages approved submissions by product, kind, crop, place and text search; sort shared or newest |
| `SubmissionRepository.adminPage` | 139 |  |  | HO page of submissions filtered by status, kind, partner and text search |
| `SubmissionRepository.counts` | 166 |  | async | Counts submissions per status |
| `SubmissionRepository.transition` | 180 |  |  | Sets fields only if the row is in an allowed from-status; returns updated row or null |
| `SubmissionRepository.bump` | 196 |  |  | Increments views or shares on an approved submission, without touching timestamps |
| `SubmissionRepository.linkedTestimonials` | 215 |  | async | Returns which of the given testimonial ids are linked to a submission |
| `SubmissionRepository.approvedQuotes` | 227 |  |  | Lists newest approved submissions with non-empty text, up to limit |
| `SubmissionRepository.page` | 236 |  | private async | Shared helper: finds sorted, skipped, limited rows plus total count |

#### `src/modules/testimonials/repositories/testimonial.repository.ts`

File role: Repository: raw-driver reads/writes on shared product_testimonials (source vistaar), plus bulk_v2 and combos_v2 lookups.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `TestimonialRepository.rows` | 63 |  | get private | Getter for the raw product_testimonials collection. |
| `TestimonialRepository.page` | 67 |  | async | Filtered, sorted, paged find on Vistaar product_testimonials plus total. |
| `TestimonialRepository.counts` | 82 |  | async | Counts Vistaar product_testimonials per pending/approved/removed. |
| `TestimonialRepository.find` | 98 |  | async | Reads one Vistaar product_testimonials row by id. |
| `TestimonialRepository.create` | 102 |  | async | Inserts a product_testimonials row with a new ObjectId. |
| `TestimonialRepository.update` | 108 |  | async | Sets fields plus updated_at on a Vistaar product_testimonials row; returns updated. |
| `TestimonialRepository.remove` | 119 |  | async | Deletes a Vistaar product_testimonials row; true if deleted. |
| `TestimonialRepository.show` | 128 |  | async | Upserts a product_testimonials row by _id + source vistaar as verified, not deleted. |
| `TestimonialRepository.hide` | 159 |  | async | Sets deleted and deleted_by on the Vistaar product_testimonials row. |
| `TestimonialRepository.erase` | 167 |  | async | Deletes the Vistaar product_testimonials row by _id + source. |
| `TestimonialRepository.comboName` | 172 |  | async | Reads a combo name from combos_v2 by family. |
| `TestimonialRepository.productExists` | 179 |  | async | True if bulk_v2 has a row with this sku. |
| `TestimonialRepository.approvedWithReview` | 191 |  | async | Reads newest approved Vistaar product_testimonials with non-empty review. |
| `TestimonialRepository.tradeNames` | 204 |  | async | Reads bulk_v2 trade names for skus into a map. |
| `TestimonialRepository.comboExists` | 219 |  | async | True if combos_v2 has this family. |
| `byId` | 228 |  | local | Filter of ObjectId _id plus source vistaar. |
| `queryOf` | 233 |  | local | Builds the product_testimonials filter: source vistaar, status, type, media type, word search. |

#### `src/modules/testimonials/services/submissions.service.ts`

File role: Service: partner testimonial submission flow and HO review, writing shared Stockship rows on approval.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `SubmissionsService.consent` | 155 |  | async | Returns settings testimonial_consent wording and version. |
| `SubmissionsService.uploadTicket` | 160 |  | async | Checks type (FILE_TYPE_NOT_ALLOWED) and size (FILE_TOO_LARGE); returns signed PUT URL in partner folder. |
| `SubmissionsService.submit` | 203 |  | async | Idempotent by id; requires approved, active partner, current consent (CONSENT_OUTDATED), own farmer, product, media; writes consent then submission. |
| `SubmissionsService.mine` | 291 |  | async | Pages partner's own submissions with signed media URLs for undecided ones. |
| `SubmissionsService.getMine` | 309 |  | async | Returns one own submission; not found otherwise. |
| `SubmissionsService.library` | 319 |  | async | Pages approved submissions with filters for the app library. |
| `SubmissionsService.count` | 338 |  | async | Increments views or shares on an approved submission; not found otherwise. |
| `SubmissionsService.list` | 349 |  | async | HO page of submissions with signed media and consent records. |
| `SubmissionsService.summary` | 374 |  |  | Delegates to SubmissionRepository.counts. |
| `SubmissionsService.get` | 378 |  | async | Returns one submission as HO view; not found otherwise. |
| `SubmissionsService.approve` | 388 |  | async | Publishes media, upserts shared review/testimonial rows, moves to approved; CONSENT_WITHDRAWN and race checks. |
| `SubmissionsService.reject` | 431 |  | async | Moves a submitted row to rejected with reason; TESTIMONIAL_NOT_ALLOWED if not allowed or changed. |
| `SubmissionsService.remove` | 453 |  | async | Hides shared rows and media, moves approved to removed; TESTIMONIAL_NOT_ALLOWED if not allowed. |
| `SubmissionsService.withdrawConsent` | 481 |  | async | Marks consent withdrawn, erases shared rows and file, moves to removed; CONSENT_WITHDRAWN if already done. |
| `SubmissionsService.require` | 526 |  | private async | Loads a submission by id; not found otherwise. |
| `SubmissionsService.allow` | 532 |  | private | Throws TESTIMONIAL_NOT_ALLOWED when the HO action is not allowed from the current status. |
| `SubmissionsService.showShared` | 546 |  | private async | Upserts the product_reviews row and, for media kinds, the product_testimonials row. |
| `SubmissionsService.eraseShared` | 588 |  | private async | Erases shared review and testimonial rows and the media file. |
| `SubmissionsService.takeDown` | 595 |  | private async | Erases shared rows if consent withdrawn, else hides them. |
| `SubmissionsService.hideShared` | 601 |  | private async | Hides shared review and testimonial rows and unpublishes media. |
| `SubmissionsService.productOf` | 609 |  | private async | Exactly one of bulk or family (VALIDATION_FAILED); checks it exists (PRODUCT_NOT_FOUND); returns name. |
| `SubmissionsService.mediaOf` | 638 |  | private async | Text needs words and no file; video/photo needs own unused uploaded file in limits (MEDIA_NOT_FOUND). |
| `SubmissionsService.signUndecided` | 690 |  | private | Signs media paths of rows without a lasting media_url. |
| `SubmissionsService.mineView` | 696 |  | private async | Maps one row to the partner view with signed media. |
| `SubmissionsService.adminView` | 700 |  | private async | Maps one row to the HO view with signed media and consent. |
| `invalid` | 709 |  | local | Builds a VALIDATION_FAILED bad-request error with the message. |
| `productNotFound` | 713 |  | local | Builds a PRODUCT_NOT_FOUND bad-request error. |
| `changedMeanwhile` | 719 |  | local | Builds a TESTIMONIAL_NOT_ALLOWED conflict for a concurrent change. |
| `mediaOf` | 725 |  | local | Row to media view (type, lasting or signed URL, duration); null for text. |
| `productOfRow` | 738 |  | local | Row to product view (bulk, family, name). |
| `toMine` | 744 |  | export | Maps a submission row to the partner view. |
| `toLibrary` | 768 |  | export | Maps an approved submission row to the library card view. |
| `toAdmin` | 790 |  | local | Maps a submission row to the HO view with partner, farmer contact, ids and consent. |

#### `src/modules/testimonials/services/testimonials.service.ts`

File role: Service: HO-filed testimonials on product_testimonials, media upload and the My Story farmer-story feed.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `TestimonialsService.uploadMedia` | 88 |  | async | Checks type (FILE_TYPE_NOT_ALLOWED), size, non-empty; saves public file; returns media_url. |
| `TestimonialsService.forStories` | 138 |  | async | Merges approved partner quotes and HO-filed testimonials (deduped), newest first, for My Story. |
| `TestimonialsService.list` | 185 |  | async | Pages Vistaar product_testimonials with from_partner flag. |
| `TestimonialsService.summary` | 209 |  |  | Delegates to TestimonialRepository.counts. |
| `TestimonialsService.get` | 213 |  | async | Returns one testimonial view with from_partner flag; not found otherwise. |
| `TestimonialsService.create` | 218 |  | async | Requires one of product or combo, valid mobile, existing product (PRODUCT_NOT_FOUND); inserts product_testimonials row. |
| `TestimonialsService.update` | 268 |  | async | Sets sent fields and who verified/removed; VALIDATION_FAILED if empty, refuses partner rows; not found. |
| `TestimonialsService.remove` | 298 |  | async | Hard-deletes an HO-filed testimonial; refuses partner rows; not found otherwise. |
| `TestimonialsService.refusePartners` | 310 |  | private async | Throws TESTIMONIAL_FROM_PARTNER when the row is linked to a partner submission. |
| `TestimonialsService.fromPartner` | 319 |  | private async | True if a partner submission links this testimonial id. |
| `TestimonialsService.require` | 323 |  | private async | Checks id and loads the testimonial; not found otherwise. |
| `checkId` | 331 |  | local | Throws VALIDATION_FAILED unless the id is a 24-hex ObjectId. |
| `invalid` | 338 |  | local | Builds a VALIDATION_FAILED bad-request error with the message. |
| `toView` | 342 |  | export | Maps a product_testimonials row to the HO view with status, likes and dislikes. |

#### `src/modules/testimonials/testimonials.domain.ts`

File role: Domain: constants and pure rules for testimonial statuses, HO actions, media types and storage paths.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `hoMediaTypeOf` | 58 |  | export | MIME type to image, video or audio per HO media rules; null if not allowed. |
| `statusOf` | 77 |  | export | Flags to status: deleted removed, verified approved, else pending. |
| `statusFilter` | 83 |  | export | Status to the Mongo filter on deleted and verified flags. |
| `toContact` | 97 |  | export | Ten-digit mobile to +91 contact string. |
| `escapeRegex` | 103 |  | export | Escapes regex special characters in a string. |
| `canAct` | 153 |  | export | True if the HO action is allowed from the given submission status. |
| `testimonialFolder` | 187 |  | export | Partner id to storage folder vistaar/testimonials/<agent_id>. |
| `mediaPathFor` | 194 |  | export | Builds the media path folder/kind/id.ext for a partner upload. |
| `ownsMedia` | 205 |  | export | True if the path matches the media pattern and lies in this partner's kind folder. |

### modules/banners

#### `src/modules/banners/banners.domain.ts`

File role: Domain — pure banner rules: image size/ratio, text-banner content, status from schedule, cohort visibility.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `imageSizeError` | 52 |  | export | Width, height → error sentence if under 600 px wide or not 2.4:1 within tolerance, else null. |
| `contentError` | 75 |  | export | Banner without image must have English subtitle and cta; returns error sentence or null. |
| `statusOf` | 91 |  | export | Banner window + now → inactive, expired, scheduled or live. |
| `isShownTo` | 99 |  | export | True when banner is live and targets all cohorts or includes the given cohort. |
| `windowError` | 110 |  | export | Returns error sentence when ends_at is not after starts_at, else null. |

#### `src/modules/banners/controllers/admin-banners.controller.ts`

File role: Controller — HO CRUD, image upload and reorder for Home carousel banners under /admin/banners.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `AdminBannersController.list` | 48 | `GET /admin/banners` · `@Can(content.read)` |  | Delegates to `BannersService.list` with status/cohort filter query. |
| `AdminBannersController.uploadImage` | 59 | `POST /admin/banners/image` · `@Can(content.write)` | async | Reads one multipart file (≤ 2 MB), throws FILE_REQUIRED / FILE_TOO_LARGE, delegates to `BannersService.uploadImage`. |
| `AdminBannersController.reorder` | 98 | `PUT /admin/banners/order` · `@Can(content.write)` |  | Delegates full ordered id list and admin email to `BannersService.reorder`. |
| `AdminBannersController.get` | 111 | `GET /admin/banners/:id` · `@Can(content.read)` |  | Delegates to `BannersService.get` for one UUID. |
| `AdminBannersController.create` | 118 | `POST /admin/banners` · `@Can(content.write)` |  | Delegates to `BannersService.create` with DTO and admin email. |
| `AdminBannersController.update` | 131 | `PATCH /admin/banners/:id` · `@Can(content.write)` |  | Delegates to `BannersService.update` with id, DTO and admin email. |
| `AdminBannersController.remove` | 144 | `DELETE /admin/banners/:id` · `@Can(content.write)` |  | Delegates to `BannersService.remove`. |

#### `src/modules/banners/controllers/banners.controller.ts`

File role: Controller — Vistaar app read of live Home carousel banners.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `BannersController.list` | 18 | `GET /banners` |  | Delegates to `BannersService.forPartner` with the caller's token subject. |

#### `src/modules/banners/repositories/banner.repository.ts`

File role: Repository — Mongo reads/writes on `vistaar_v2_banners`.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `BannerRepository.listActive` | 23 |  |  | Reads active, not-ended banners from `vistaar_v2_banners`, sorted by order, capped at 200. |
| `BannerRepository.page` | 35 |  | async | Paged find plus count on `vistaar_v2_banners` using status/cohort filter. |
| `BannerRepository.find` | 56 |  |  | Reads one banner by `_id` from `vistaar_v2_banners`. |
| `BannerRepository.create` | 60 |  | async | Inserts a banner row into `vistaar_v2_banners` and returns it. |
| `BannerRepository.update` | 67 |  |  | `$set` fields on one banner by `_id`, returns updated row or null. |
| `BannerRepository.ids` | 74 |  | async | Returns every banner `_id` in `vistaar_v2_banners`. |
| `BannerRepository.reorder` | 83 |  | async | bulkWrite sets each banner's order to its index in ids, plus updated_by. |
| `BannerRepository.countByImage` | 94 |  |  | Counts banners using a given image_path. |
| `BannerRepository.remove` | 98 |  | async | Deletes one banner by `_id`; true if deleted. |
| `queryOf` | 104 |  | local | Builds Mongo filter mirroring `statusOf` for status, plus cohort-or-untargeted match. |

#### `src/modules/banners/services/banners.service.ts`

File role: Service: Home carousel banners for partners (cached) and HO CRUD, images and ordering

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `BannersService.forPartner` | 83 |  | async | Returns live banners shown to the partner's cohort now, capped at MAX_LIVE_BANNERS |
| `BannersService.uploadImage` | 99 |  | async | Checks JPG/PNG/WEBP and size, saves public image; FILE_TYPE_NOT_ALLOWED or IMAGE_SIZE_NOT_ALLOWED |
| `BannersService.list` | 127 |  | async | HO page of banners by status and cohort, each with computed status |
| `BannersService.get` | 143 |  | async | Returns one banner admin view; NOT_FOUND if missing |
| `BannersService.create` | 147 |  | async | Validates text, window, content, cohorts and image, saves a new banner, clears cache |
| `BannersService.update` | 181 |  | async | Merges and validates sent fields, saves, clears cache, drops replaced unused image |
| `BannersService.reorder` | 228 |  | async | Saves a new order of all banners; BANNERS_CHANGED if ids differ from stored set |
| `BannersService.remove` | 242 |  | async | Deletes a banner, clears cache, removes its image if no other banner uses it |
| `BannersService.activeRows` | 250 |  | private async | Active banners from the 60 s cache, loading from repository on miss |
| `BannersService.require` | 254 |  | private async | Loads a banner or throws NOT_FOUND |
| `BannersService.checkCohorts` | 261 |  | private async | Dedupes cohort keys and checks each exists |
| `BannersService.resolveImage` | 268 |  | private async | Looks up an uploaded public image and returns its url and size; IMAGE_NOT_FOUND |
| `BannersService.dropImage` | 286 |  | private async | Deletes an image file only when no banner still references it |
| `toPartnerView` | 292 |  | local | Maps a banner to the app view, image only when url and size are set |
| `toAdminView` | 308 |  | local | Banner plus its status at the given time |
| `toDate` | 312 |  | local | Converts an optional string to a Date or null |
| `checkWindow` | 316 |  | local | Throws VALIDATION_FAILED if the start/end window is invalid |
| `checkContent` | 321 |  | local | Throws VALIDATION_FAILED if image, subtitle and cta content is invalid |
| `requireEnglish` | 333 |  | local | Throws VALIDATION_FAILED if title, subtitle or cta lacks English text, or title is null |

### modules/events

#### `src/modules/events/controllers/admin-events.controller.ts`

File role: Controller — HO CRUD of farmer events and their registrations under /admin/events.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `AdminEventsController.list` | 37 | `GET /admin/events` · `@Can(content.read)` |  | Delegates to `AdminEventsService.list`. |
| `AdminEventsController.get` | 44 | `GET /admin/events/:id` · `@Can(content.read)` |  | Delegates to `AdminEventsService.get`. |
| `AdminEventsController.registrations` | 51 | `GET /admin/events/:id/registrations` · `@Can(content.read)` |  | Delegates to `AdminEventsService.registrationsOf` with paging. |
| `AdminEventsController.create` | 61 | `POST /admin/events` · `@Can(content.write)` |  | Delegates to `AdminEventsService.create` with admin email. |
| `AdminEventsController.update` | 71 | `PATCH /admin/events/:id` · `@Can(content.write)` |  | Delegates to `AdminEventsService.update` with admin email. |
| `AdminEventsController.remove` | 85 | `DELETE /admin/events/:id` · `@Can(content.write)` |  | Delegates to `AdminEventsService.remove`. |

#### `src/modules/events/controllers/events.controller.ts`

File role: Controller — Vistaar app event list, detail and seat register/unregister (throttled).

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `EventsController.upcoming` | 39 | `GET /events` |  | Delegates to `EventsService.upcoming` for the caller. |
| `EventsController.past` | 45 | `GET /events/past` |  | Delegates to `EventsService.past` with paging. |
| `EventsController.get` | 54 | `GET /events/:id` |  | Delegates to `EventsService.get`. |
| `EventsController.register` | 63 | `POST /events/:id/register` |  | Delegates to `EventsService.register`; throttled 20 per minute. |
| `EventsController.unregister` | 75 | `DELETE /events/:id/register` |  | Delegates to `EventsService.unregister`; throttled 20 per minute. |

#### `src/modules/events/events.domain.ts`

File role: Domain — pure event rules: status, cohort targeting, registration and seat checks, seat id.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `eventStatus` | 24 |  | export | Returns inactive, upcoming (starts in future) or past. |
| `isForCohort` | 30 |  | export | True when event has no cohorts or includes the given cohort. |
| `registerError` | 40 |  | export | Returns EVENT_CLOSED if not upcoming, EVENT_FULL if no seat left, else null. |
| `seatsError` | 53 |  | export | Error sentence when new seats is below registered count, else null. |
| `registrationId` | 60 |  | export | Builds seat `_id` as eventId:agentId. |

#### `src/modules/events/repositories/event-registration.repository.ts`

File role: Repository — seat rows on `vistaar_v2_event_registrations`.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `isDuplicateKey` | 11 |  | local | True for a Mongo 11000 duplicate-key error. |
| `EventRegistrationRepository.add` | 22 |  | async | Inserts seat row into `vistaar_v2_event_registrations`; false if partner already holds it. |
| `EventRegistrationRepository.remove` | 36 |  | async | Deletes the partner's seat row; true if deleted. |
| `EventRegistrationRepository.heldBy` | 44 |  | async | Returns set of given event ids where the partner holds a seat, by `_id` lookup. |
| `EventRegistrationRepository.page` | 56 |  | async | Paged seat rows plus count for one event, oldest first. |
| `EventRegistrationRepository.removeAll` | 74 |  | async | Deletes all seat rows of one event. |

#### `src/modules/events/repositories/event.repository.ts`

File role: Repository — event rows on `vistaar_v2_events`, including atomic seat counters.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `EventRepository.listActiveFrom` | 27 |  |  | Reads active events starting from a date, soonest first, capped at 300. |
| `EventRepository.page` | 36 |  | async | Paged find plus count on `vistaar_v2_events` with status/type/cohort filter. |
| `EventRepository.find` | 57 |  |  | Reads one event by `_id`. |
| `EventRepository.create` | 61 |  | async | Inserts an event row and returns it. |
| `EventRepository.update` | 69 |  |  | `$set` on one event; when seats sent, only if registered_count ≤ new seats. |
| `EventRepository.takeSeat` | 81 |  |  | Atomic `$inc` registered_count while event active, not started and not full; null otherwise. |
| `EventRepository.releaseSeat` | 97 |  |  | Atomic `$inc` -1 on registered_count when above zero. |
| `EventRepository.remove` | 108 |  | async | Deletes one event by `_id`; true if deleted. |
| `queryOf` | 114 |  | local | Builds Mongo filter mirroring `eventStatus`, plus type and cohort or untargeted-only. |

#### `src/modules/events/services/admin-events.service.ts`

File role: Service — HO event calendar: list, create, edit, delete and registration list.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `AdminEventsService.list` | 49 |  | async | Paged HO event list with computed status. |
| `AdminEventsService.get` | 65 |  | async | Returns one event with status or throws not found. |
| `AdminEventsService.create` | 69 |  | async | Validates cohorts, inserts event with zero registrations, clears partner cache. |
| `AdminEventsService.update` | 88 |  | async | Applies sent fields; VALIDATION_FAILED if seats below taken, EVENT_SEATS_TAKEN on race; clears cache. |
| `AdminEventsService.remove` | 124 |  | async | Deletes event (not found if missing) and all its seats, clears cache. |
| `AdminEventsService.registrationsOf` | 131 |  | async | Paged seats of an event joined with partner name, phone, cohort, district from `AgentsService`. |
| `AdminEventsService.require` | 166 |  | private async | Finds event or throws not found. |
| `AdminEventsService.checkCohorts` | 173 |  | private async | De-duplicates cohort keys and requires each exists (inactive allowed). |
| `toAdminView` | 180 |  | local | Event row plus computed status. |

#### `src/modules/events/services/events.service.ts`

File role: Service — partner event reads (60 s cache) and idempotent seat register/unregister.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `EventsService.upcoming` | 56 |  | async | Cached active events filtered to future and caller's cohort, with registered flag. |
| `EventsService.past` | 68 |  | async | Paged past events for caller's cohort (or untargeted only if none), newest first. |
| `EventsService.get` | 86 |  | async | One visible event as partner view. |
| `EventsService.register` | 93 |  | async | Checks registerError, adds seat row, atomically takes seat; on race removes row and throws EVENT_FULL/EVENT_CLOSED. |
| `EventsService.unregister` | 119 |  | async | Throws EVENT_CLOSED after start; removes seat row and releases seat if one was held. |
| `EventsService.invalidate` | 131 |  |  | Clears the cached active event list. |
| `EventsService.views` | 135 |  | private async | Maps events to partner views with the caller's held-seat flag. |
| `EventsService.requireVisible` | 149 |  | private async | Throws not found unless event exists, is active and targets caller's cohort. |
| `EventsService.cohortOf` | 163 |  | private async | Delegates to `AgentsService.cohortByAgentId`. |
| `EventsService.activeRows` | 167 |  | private async | Returns active upcoming events from 60 s per-process cache, re-reading when stale. |
| `toView` | 177 |  | local | Maps event to `PartnerEventView` with seats_left, status and registered. |
| `refusal` | 197 |  | local | Builds 409 apiError for EVENT_FULL or EVENT_CLOSED with user message. |

### modules/faqs

#### `src/modules/faqs/controllers/admin-faq-sections.controller.ts`

File role: Controller — HO CRUD of FAQ sections under /admin/faq-sections.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `checkKey` | 27 |  | local | Throws VALIDATION_FAILED unless key matches `SECTION_KEY`; returns key. |
| `AdminFaqSectionsController.list` | 40 | `GET /admin/faq-sections` · `@Can(content.read)` |  | Delegates to `FaqSectionsService.list` with optional is_active. |
| `AdminFaqSectionsController.get` | 47 | `GET /admin/faq-sections/:key` · `@Can(content.read)` |  | Checks key, delegates to `FaqSectionsService.get`. |
| `AdminFaqSectionsController.create` | 54 | `POST /admin/faq-sections` · `@Can(content.write)` |  | Delegates to `FaqSectionsService.create` with admin email. |
| `AdminFaqSectionsController.update` | 66 | `PATCH /admin/faq-sections/:key` · `@Can(content.write)` |  | Checks key, delegates to `FaqSectionsService.update`. |
| `AdminFaqSectionsController.remove` | 77 | `DELETE /admin/faq-sections/:key` · `@Can(content.write)` |  | Checks key, delegates to `FaqSectionsService.remove`. |

#### `src/modules/faqs/controllers/admin-faqs.controller.ts`

File role: Controller — HO CRUD of help FAQs under /admin/faqs.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `AdminFaqsController.list` | 29 | `GET /admin/faqs` · `@Can(content.read)` |  | Delegates to `FaqsService.list`. |
| `AdminFaqsController.get` | 36 | `GET /admin/faqs/:id` · `@Can(content.read)` |  | Delegates to `FaqsService.get`. |
| `AdminFaqsController.create` | 43 | `POST /admin/faqs` · `@Can(content.write)` |  | Delegates to `FaqsService.create` with admin email. |
| `AdminFaqsController.update` | 55 | `PATCH /admin/faqs/:id` · `@Can(content.write)` |  | Delegates to `FaqsService.update` with admin email. |
| `AdminFaqsController.remove` | 66 | `DELETE /admin/faqs/:id` · `@Can(content.write)` |  | Delegates to `FaqsService.remove`. |

#### `src/modules/faqs/controllers/faqs.controller.ts`

File role: Controller — Vistaar app read of live FAQ sections and FAQs.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `FaqsController.list` | 12 | `GET /faqs` |  | Delegates to `FaqsService.live`. |

#### `src/modules/faqs/dto/faq-section.dto.ts`

File role: DTO — validation shapes for FAQ section create, update and list query.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `toOptionalBool` | 64 |  | local | Query transform: true/'true' → true, false/'false' → false, else undefined. |

#### `src/modules/faqs/dto/faq.dto.ts`

File role: DTO — validation shapes for FAQ create, update and list query.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `toOptionalBool` | 77 |  | local | Query transform: true/'true' → true, false/'false' → false, else undefined. |

#### `src/modules/faqs/faqs.domain.ts`

File role: Domain — pure FAQ rules: question normalisation and which sections are shown.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `questionKey` | 19 |  | export | Trims, collapses whitespace and lowercases a question for the duplicate check. |
| `liveSections` | 27 |  | export | Keeps FAQs whose section is given, and only sections that have at least one FAQ. |

#### `src/modules/faqs/repositories/faq-section.repository.ts`

File role: Repository — Mongo reads/writes on `vistaar_v2_faq_sections`.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `FaqSectionRepository.list` | 21 |  |  | Reads sections from `vistaar_v2_faq_sections`, optional is_active filter, by order, capped 200. |
| `FaqSectionRepository.find` | 32 |  |  | Reads one section by key `_id`. |
| `FaqSectionRepository.create` | 36 |  | async | Inserts a section row and returns it. |
| `FaqSectionRepository.update` | 43 |  |  | `$set` on one section by key, returns updated row or null. |
| `FaqSectionRepository.remove` | 54 |  | async | Deletes one section by key; true if deleted. |

#### `src/modules/faqs/repositories/faq.repository.ts`

File role: Repository — Mongo reads/writes on `vistaar_v2_faqs`.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `FaqRepository.listActive` | 21 |  |  | Reads active FAQs from `vistaar_v2_faqs` by order, capped at 500. |
| `FaqRepository.page` | 30 |  | async | Paged find plus count with optional category and is_active filter. |
| `FaqRepository.inSection` | 52 |  | async | True if any FAQ has the given category. |
| `FaqRepository.find` | 56 |  |  | Reads one FAQ by `_id`. |
| `FaqRepository.create` | 60 |  | async | Inserts a FAQ row and returns it. |
| `FaqRepository.update` | 65 |  |  | `$set` on one FAQ by `_id`, returns updated row or null. |
| `FaqRepository.remove` | 72 |  | async | Deletes one FAQ by `_id`; true if deleted. |

#### `src/modules/faqs/services/faq-sections.service.ts`

File role: Service — HO FAQ section rules: unique key, delete only when empty, refresh FAQ cache.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `isDuplicateKey` | 14 |  | local | True for a Mongo 11000 duplicate-key error. |
| `FaqSectionsService.list` | 25 |  |  | Delegates to `FaqSectionRepository.list`. |
| `FaqSectionsService.get` | 29 |  | async | Returns section or throws not found. |
| `FaqSectionsService.create` | 35 |  | async | Inserts section; throws FAQ_SECTION_EXISTS on duplicate key; refreshes FAQ cache. |
| `FaqSectionsService.update` | 59 |  | async | Applies sent fields (label trimmed), not found if missing, refreshes FAQ cache. |
| `FaqSectionsService.remove` | 81 |  | async | Throws FAQ_SECTION_IN_USE if section has FAQs; deletes it, refreshes cache. |

#### `src/modules/faqs/services/faqs.service.ts`

File role: Service: help FAQs for the app (cached live list) and HO CRUD

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `isDuplicateKey` | 37 |  | local | True if the error is a Mongo duplicate key (11000) |
| `duplicate` | 40 |  | local | Builds a FAQ_EXISTS conflict for a repeated question |
| `FaqsService.live` | 58 |  |  | Live sections and FAQs from the 60 s cache |
| `FaqsService.load` | 62 |  | private async | Loads active sections and FAQs, keeps only live sections, maps to views |
| `FaqsService.refresh` | 79 |  |  | Clears the live cache |
| `FaqsService.inSection` | 83 |  |  | Delegates to repository: whether any FAQ uses the section key |
| `FaqsService.list` | 87 |  | async | HO page of FAQs by category and active flag |
| `FaqsService.get` | 97 |  | async | Returns one FAQ or NOT_FOUND |
| `FaqsService.create` | 103 |  | async | Checks section, saves trimmed FAQ with question key; FAQ_EXISTS on duplicate |
| `FaqsService.update` | 126 |  | async | Checks section, saves sent fields and new question key; NOT_FOUND or FAQ_EXISTS |
| `FaqsService.remove` | 150 |  | async | Deletes a FAQ and clears cache; NOT_FOUND if missing |
| `FaqsService.checkSection` | 157 |  | private async | Throws VALIDATION_FAILED if the FAQ section does not exist |
| `toView` | 165 |  | local | Maps a FAQ row to {id, category, q, a} |

### modules/info-pages

#### `src/modules/info-pages/controllers/about-company.controller.ts`

File role: Controller: public app read of the About Katyayani info page.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `AboutCompanyController.get` | 20 | `GET /about-company` · `@Public` |  | Public About Katyayani page; delegates to InfoPagesService.live(about_company), 404 until created. |

#### `src/modules/info-pages/controllers/about-program.controller.ts`

File role: Controller: public app read of the About Vistaar info page.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `AboutProgramController.get` | 20 | `GET /about-program` · `@Public` |  | Public About Vistaar page; delegates to InfoPagesService.live(about_program), 404 until created. |

#### `src/modules/info-pages/controllers/admin-about-company.controller.ts`

File role: Controller: HO CRUD for the About Katyayani page.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `AdminAboutCompanyController.get` | 21 | `GET /admin/about-company` · `@Can(content.read)` |  | HO reads the stored about_company page; delegates to InfoPagesService.get. |
| `AdminAboutCompanyController.create` | 28 | `POST /admin/about-company` · `@Can(content.write)` |  | HO creates about_company with admin email; delegates to InfoPagesService.create (409 INFO_PAGE_EXISTS). |
| `AdminAboutCompanyController.update` | 40 | `PATCH /admin/about-company` · `@Can(content.write)` |  | Splits version from patch, delegates to InfoPagesService.update (409 VERSION_CONFLICT). |
| `AdminAboutCompanyController.remove` | 54 | `DELETE /admin/about-company` · `@Can(content.write)` |  | Deletes about_company page; delegates to InfoPagesService.remove. |

#### `src/modules/info-pages/controllers/admin-about-program.controller.ts`

File role: Controller: HO CRUD for the About Vistaar page.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `AdminAboutProgramController.get` | 21 | `GET /admin/about-program` · `@Can(content.read)` |  | HO reads the stored about_program page; delegates to InfoPagesService.get. |
| `AdminAboutProgramController.create` | 28 | `POST /admin/about-program` · `@Can(content.write)` |  | HO creates about_program with admin email; delegates to InfoPagesService.create (409 INFO_PAGE_EXISTS). |
| `AdminAboutProgramController.update` | 40 | `PATCH /admin/about-program` · `@Can(content.write)` |  | Splits version from patch, delegates to InfoPagesService.update (409 VERSION_CONFLICT). |
| `AdminAboutProgramController.remove` | 54 | `DELETE /admin/about-program` · `@Can(content.write)` |  | Deletes about_program page; delegates to InfoPagesService.remove. |

#### `src/modules/info-pages/controllers/admin-contact-us.controller.ts`

File role: Controller: HO CRUD for the Contact Us page.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `AdminContactUsController.get` | 18 | `GET /admin/contact-us` · `@Can(content.read)` |  | HO reads the stored contact_us page; delegates to InfoPagesService.get. |
| `AdminContactUsController.create` | 25 | `POST /admin/contact-us` · `@Can(content.write)` |  | HO creates contact_us with admin email; delegates to InfoPagesService.create (409 INFO_PAGE_EXISTS). |
| `AdminContactUsController.update` | 37 | `PATCH /admin/contact-us` · `@Can(content.write)` |  | Splits version from patch, delegates to InfoPagesService.update (409 VERSION_CONFLICT). |
| `AdminContactUsController.remove` | 51 | `DELETE /admin/contact-us` · `@Can(content.write)` |  | Deletes contact_us page; delegates to InfoPagesService.remove. |

#### `src/modules/info-pages/controllers/contact-us.controller.ts`

File role: Controller: public app read of Contact Us with open_now.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `ContactUsController.get` | 22 | `GET /contact-us` · `@Public` |  | Public Contact Us page with open_now; delegates to InfoPagesService.contactUs. |

#### `src/modules/info-pages/info-pages.domain.ts`

File role: Domain: info page content types and pure validation rules (hours, placeholders, duplicate keys).

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `minutes` | 130 |  | local | Converts an HH:mm string to minutes since midnight. |
| `isOpenAt` | 136 |  | export | True when the IST weekday is in hours.days and time is within opens..closes (closes exclusive). |
| `hoursProblems` | 145 |  | export | Returns messages when closing is not after opening or a weekday is listed twice. |
| `strings` | 157 |  | local | Generator yielding every string nested anywhere in a value, depth-first. |
| `unknownPlaceholders` | 166 |  | export | Lists {name} tokens in content that are not in PLACEHOLDERS. |
| `duplicateKeys` | 178 |  | export | Returns keys that appear more than once in a list of items. |
| `ruleCohorts` | 186 |  | export | Distinct non-null cohort keys named by programme rules. |
| `contentProblems` | 191 |  | export | Collects unknown placeholders, duplicate lifecycle/more keys (about_program) and hours problems (contact_us). |

#### `src/modules/info-pages/repositories/info-page.repository.ts`

File role: Repository: reads and writes vistaar_v2_info_pages with optimistic version.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `isDuplicateKey` | 8 |  | local | True when the error is a Mongo duplicate-key error (code 11000). |
| `InfoPageRepository.find` | 17 |  |  | Reads one page by _id from vistaar_v2_info_pages (lean). |
| `InfoPageRepository.create` | 22 |  | async | Inserts page at version 1 into vistaar_v2_info_pages; returns null on duplicate key. |
| `InfoPageRepository.update` | 43 |  |  | findOneAndUpdate on _id plus version, sets content and $inc version in vistaar_v2_info_pages; null on mismatch. |
| `InfoPageRepository.remove` | 59 |  | async | Deletes the page row from vistaar_v2_info_pages; true if one was deleted. |

#### `src/modules/info-pages/services/info-pages.service.ts`

File role: Service: About and Contact Us info pages for the app (cached) and HO CRUD with versioning

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `notPublished` | 33 |  | local | Builds a NOT_FOUND error saying the page is not published yet |
| `InfoPagesService.live` | 45 |  | async | Returns the cached page version, updated_at and content; NOT_FOUND if unpublished |
| `InfoPagesService.contactUs` | 58 |  | async | Live Contact Us page plus open_now from its hours |
| `InfoPagesService.get` | 63 |  | async | Returns the stored page row or NOT_FOUND |
| `InfoPagesService.create` | 69 |  | async | Validates and creates a page; INFO_PAGE_EXISTS if already there |
| `InfoPagesService.update` | 87 |  | async | Merges patch into content, validates, saves at version; VERSION_CONFLICT on mismatch |
| `InfoPagesService.remove` | 113 |  | async | Deletes a page and clears cache; NOT_FOUND if missing |
| `InfoPagesService.check` | 119 |  | private async | Validates page content and About cohorts; VALIDATION_FAILED with all problems |
| `InfoPagesService.cached` | 134 |  | private | Reads the page through the 60 s cache |
| `InfoPagesService.missingCohorts` | 139 |  | private async | Lists problems for About rules naming cohorts that do not exist |

### modules/meetings

#### `src/modules/meetings/controllers/admin-meetings.controller.ts`

File role: Controller: HO read-only meetings list, summary and detail.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `AdminMeetingsController.list` | 24 | `GET /admin/meetings` · `@Can(leads.read)` |  | HO paged list of all partners meetings; delegates to MeetingsService.adminList. |
| `AdminMeetingsController.summary` | 36 | `GET /admin/meetings/summary` · `@Can(leads.read)` |  | HO summary cards for an IST day window; delegates to MeetingsService.adminSummary. |
| `AdminMeetingsController.get` | 46 | `GET /admin/meetings/:id` · `@Can(leads.read)` |  | HO meeting detail by id; delegates to MeetingsService.adminGet. |

#### `src/modules/meetings/controllers/meetings.controller.ts`

File role: Controller: partner meetings CRUD-like routes, attendance and lead capture.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `MeetingsController.list` | 59 | `GET /meetings` |  | Partner own meetings paged; delegates to MeetingsService.list with token agent id. |
| `MeetingsController.invitees` | 70 | `GET /meetings/invitees` |  | Partner customers and open leads to invite; delegates to MeetingsService.invitees. |
| `MeetingsController.get` | 82 | `GET /meetings/:id` |  | Partner own meeting detail; delegates to MeetingsService.get. |
| `MeetingsController.create` | 91 | `POST /meetings` |  | Schedules a meeting with the app UUID (idempotent); delegates to MeetingsService.create. |
| `MeetingsController.update` | 105 | `PATCH /meetings/:id` |  | Edits a scheduled meeting; delegates to MeetingsService.update (409 MEETING_CLOSED). |
| `MeetingsController.cancel` | 117 | `POST /meetings/:id/cancel` |  | Cancels a scheduled meeting with a note; delegates to MeetingsService.cancel. |
| `MeetingsController.complete` | 130 | `POST /meetings/:id/complete` |  | Marks a meeting completed; delegates to MeetingsService.complete. |
| `MeetingsController.setAttendees` | 142 | `PUT /meetings/:id/attendees` |  | Replaces the whole attendee list; delegates to MeetingsService.setAttendees. |
| `MeetingsController.captureLead` | 157 | `POST /meetings/:id/attendees/:phone/lead` |  | Captures an attendee as the partner lead; delegates to MeetingsService.captureLead. |

#### `src/modules/meetings/dto/meeting.dto.ts`

File role: DTO: request validation shapes for meetings routes.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `trim` | 32 |  | local | class-transformer helper that trims string values, leaving others unchanged. |

#### `src/modules/meetings/meetings.domain.ts`

File role: Domain: meeting types, statuses and pure rules for edits, attendance and counts.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `defaultTitle` | 54 |  | export | Builds the default title as type label plus village. |
| `editError` | 59 |  | export | Null when status is scheduled, else a message that the meeting can no longer change. |
| `attendanceError` | 66 |  | export | Message when status is cancelled, else null (attendance editable after completion). |
| `completeError` | 72 |  | export | Non-scheduled gives editError; otherwise requires at least one attendee present. |
| `countsOf` | 88 |  | export | Counts invited, present and lead_captured attendees. |
| `mergeAttendees` | 101 |  | export | Maps the sent list by phone onto stored, keeping stored pii_id and lead_captured. |
| `duplicatePhone` | 117 |  | export | Returns the first repeated phone in a list, or null. |

#### `src/modules/meetings/repositories/meeting.repository.ts`

File role: Repository: reads and writes partner meetings on vistaar_v2_meetings

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `isDuplicateKey` | 31 |  | local | True if the error has Mongo duplicate key code 11000 |
| `countOf` | 37 |  | local | Builds an aggregation expression counting attendees with the given flag true |
| `MeetingRepository.create` | 50 |  | async | Inserts a meeting; returns null on duplicate _id |
| `MeetingRepository.find` | 62 |  |  | Reads one meeting by _id |
| `MeetingRepository.page` | 66 |  | async | Pages meetings without attendees by filter and sort, plus total |
| `MeetingRepository.scheduledBetween` | 89 |  |  | Lists a partner's scheduled meetings starting in a time range, up to cap |
| `MeetingRepository.updateScheduled` | 109 |  |  | Sets fields on the partner's scheduled meeting; null if not matched |
| `MeetingRepository.setAttendees` | 129 |  |  | Replaces attendees and counts if unchanged since readAt and not cancelled |
| `MeetingRepository.markCaptured` | 152 |  |  | Marks the attendee by phone present and captured with pii_id, recomputes counts |
| `MeetingRepository.totals` | 208 |  | async | Aggregates meeting counts by status, partners, invited, present and leads |
| `queryOf` | 254 |  | local | Builds a meeting query from partner, status and start date range |

#### `src/modules/meetings/services/meeting-notifier.service.ts`

File role: Service: placeholder notifier for meeting invites (logs only, no WhatsApp yet).

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `MeetingNotifier.scheduled` | 15 |  |  | No-op notifier; logs that scheduled invites were not sent. |
| `MeetingNotifier.rescheduled` | 19 |  |  | No-op notifier; logs that rescheduled invites were not sent. |
| `MeetingNotifier.cancelled` | 23 |  |  | No-op notifier; logs that cancellation notices were not sent. |
| `MeetingNotifier.held` | 27 |  | private | Debug-logs the meeting id, event and invited count as not sent. |

#### `src/modules/meetings/services/meetings.service.ts`

File role: Service: partner meeting rules, attendance merge, lead capture, HO reads.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `closed` | 87 |  | local | Builds a 409 MEETING_CLOSED conflict error with the given message. |
| `viewOf` | 89 |  | local | Strips _id, agent_id and attendees, returning the meeting with id. |
| `MeetingsService.list` | 108 |  | async | Partner meetings by status, scheduled soonest first else newest first, as PageResult. |
| `MeetingsService.get` | 121 |  | async | Loads the partner own meeting and returns its detail with attendee stages. |
| `MeetingsService.invitees` | 125 |  | async | Pages LeadsService.invitees results in memory. |
| `MeetingsService.create` | 137 |  | async | Requires approved partner, idempotent on id, future start, invites own farmers; 409 MEETING_EXISTS; notifies. |
| `MeetingsService.update` | 173 |  | async | Edits a scheduled meeting (future start, default title); 409 MEETING_CLOSED; notifies on reschedule. |
| `MeetingsService.cancel` | 204 |  | async | Sets status cancelled with note on a scheduled meeting; 409 MEETING_CLOSED; notifies. |
| `MeetingsService.complete` | 222 |  | async | Marks completed when someone present; VALIDATION_FAILED or MEETING_CLOSED otherwise. |
| `MeetingsService.setAttendees` | 245 |  | async | Validates phones and duplicates, links own leads, merges and saves with two tries; VERSION_CONFLICT. |
| `MeetingsService.captureLead` | 314 |  | async | Checks attendee and phone match, not already a lead, upserts via LeadsService, marks captured. |
| `MeetingsService.soon` | 367 |  |  | Scheduled meetings starting today or tomorrow IST, for Today tasks. |
| `MeetingsService.upcoming` | 373 |  |  | Scheduled meetings from now over the next days (default 60). |
| `MeetingsService.adminList` | 379 |  | async | HO paged meetings by partner, status, IST days, with partner names; VALIDATION_FAILED on bad range. |
| `MeetingsService.adminGet` | 406 |  | async | HO meeting detail with partner name; notFound if missing. |
| `MeetingsService.adminSummary` | 421 |  | async | Totals for an IST day window (default this month); VALIDATION_FAILED on bad range. |
| `MeetingsService.upcomingBetween` | 442 |  | private async | Reads scheduled meetings from a time until N IST days ahead and maps to views. |
| `MeetingsService.retried` | 452 |  | private | Returns the existing meeting detail if same partner, else 409 MEETING_EXISTS. |
| `MeetingsService.mine` | 459 |  | private async | Loads a meeting owned by the partner; notFound otherwise. |
| `MeetingsService.detail` | 465 |  | private async | Adds each attendee current lead stage from LeadsService.mineByPhones. |
| `MeetingsService.invited` | 480 |  | private async | Turns requested pii_ids into invited attendees, keeping only the partner own invitees. |
| `MeetingsService.requireWorkingPartner` | 502 |  | private async | Throws ACCOUNT_BLOCKED if blocked or inactive, PARTNER_NOT_APPROVED if not approved. |
| `futureOrThrow` | 519 |  | local | Parses a date; throws VALIDATION_FAILED if not in the future. |

### modules/terms

#### `src/modules/terms/controllers/admin-terms.controller.ts`

File role: Controller: HO management of Vistaar T&C versions and editor text.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `checkId` | 30 |  | local | Throws VALIDATION_FAILED unless the id matches TOC-n. |
| `AdminTermsController.list` | 43 | `GET /admin/terms-and-conditions` · `@Can(content.read)` |  | HO paged Vistaar T&C rows; delegates to TermsService.list. |
| `AdminTermsController.get` | 52 | `GET /admin/terms-and-conditions/:toc_id` · `@Can(content.read)` |  | HO reads one T&C by checked toc_id; delegates to TermsService.get. |
| `AdminTermsController.text` | 59 | `GET /admin/terms-and-conditions/:toc_id/text` · `@Can(content.read)` |  | Editor text read from the version document; delegates to TermsService.text. |
| `AdminTermsController.rewrite` | 71 | `PUT /admin/terms-and-conditions/:toc_id/text` · `@Can(content.write)` |  | Saves edited text as a new document on the same row; delegates to TermsService.rewrite. |
| `AdminTermsController.compose` | 84 | `POST /admin/terms-and-conditions/compose` · `@Can(content.write)` |  | First T&C written as text, server builds the docx; delegates to TermsService.compose. |
| `AdminTermsController.create` | 94 | `POST /admin/terms-and-conditions` · `@Can(content.write)` |  | Adds a version with the next TOC-n; delegates to TermsService.create. |
| `AdminTermsController.update` | 104 | `PATCH /admin/terms-and-conditions/:toc_id` · `@Can(content.write)` |  | Edits title or link or switches active; delegates to TermsService.update. |
| `AdminTermsController.remove` | 116 | `DELETE /admin/terms-and-conditions/:toc_id` · `@Can(content.write)` |  | Deletes a switched-off version; delegates to TermsService.remove. |

#### `src/modules/terms/controllers/terms.controller.ts`

File role: Controller: public app read of the active Vistaar T&C.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `TermsController.live` | 21 | `GET /terms-and-conditions` · `@Public` |  | Public current Vistaar T&C title and link; delegates to TermsService.live. |

#### `src/modules/terms/dto/terms.dto.ts`

File role: DTO: request validation shapes for T&C routes.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `toOptionalBool` | 57 |  | local | Transforms true/false or their strings to booleans, anything else to undefined. |

#### `src/modules/terms/repositories/terms.repository.ts`

File role: Repository: Vistaar-scoped reads and writes on shared terms_and_conditions.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `isDuplicateKey` | 11 |  | local | True when the error is a Mongo duplicate-key error (code 11000). |
| `TermsRepository.live` | 25 |  |  | Newest active Vistaar row in terms_and_conditions. |
| `TermsRepository.page` | 33 |  | async | Paged Vistaar rows in terms_and_conditions, optional is_active filter, with total. |
| `TermsRepository.find` | 54 |  |  | Reads one Vistaar row by toc_id from terms_and_conditions. |
| `TermsRepository.lastTocNumber` | 65 |  | async | Highest TOC-n number across all apps rows in terms_and_conditions, 0 if none. |
| `TermsRepository.insert` | 82 |  | async | Inserts a Vistaar row into terms_and_conditions; null on duplicate toc_id. |
| `TermsRepository.update` | 98 |  |  | Sets fields on a Vistaar row in terms_and_conditions, $inc __v when title or link changes. |
| `TermsRepository.replaceDocument` | 117 |  |  | Sets title and link and $inc __v only if __v matches, in terms_and_conditions. |
| `TermsRepository.deactivateOthers` | 133 |  | async | Sets is_active false on every other active Vistaar row in terms_and_conditions. |
| `TermsRepository.removeInactive` | 143 |  | async | Deletes a Vistaar row only if inactive from terms_and_conditions; true if deleted. |

#### `src/modules/terms/services/terms.service.ts`

File role: Service: Vistaar T&C on shared terms_and_conditions, app read (cached) and HO CRUD, docx editor

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `TermsService.live` | 54 |  | async | Returns the cached active Vistaar T&C view; NOT_FOUND if none |
| `TermsService.list` | 63 |  | async | HO page of Vistaar T&C rows by active flag |
| `TermsService.get` | 75 |  | async | Returns one T&C row or NOT_FOUND |
| `TermsService.create` | 82 |  | async | Inserts next TOC-n with retry, deactivates others if active; TERMS_ID_UNAVAILABLE |
| `TermsService.update` | 102 |  | async | Saves sent fields, deactivates others if made active, clears cache; NOT_FOUND |
| `TermsService.remove` | 118 |  | async | Deletes an inactive T&C; NOT_FOUND or TERMS_IN_USE if active |
| `TermsService.text` | 132 |  | async | Reads editor text back from the stored docx; TERMS_NOT_EDITABLE if absent |
| `TermsService.compose` | 149 |  | async | Tidies editor text, uploads a docx, creates a new T&C row |
| `TermsService.rewrite` | 164 |  | async | Uploads new docx and replaces link at the same version; VERSION_CONFLICT, removes upload on miss |
| `TermsService.upload` | 182 |  | private async | Builds the docx from text and saves it public under toc, returns url |
| `TermsService.activated` | 191 |  | private async | Deactivates other Vistaar T&C rows and clears the cache |
| `versionConflict` | 197 |  | local | Builds a VERSION_CONFLICT conflict error |
| `tidyText` | 204 |  | local | Trims editor text, drops empty points, nulls blank optional fields |
| `toView` | 223 |  | local | Maps a row to app view with version = __v + 1 |

#### `src/modules/terms/terms-docx.ts`

File role: Utility: builds a T&C .docx with embedded editor text and reads it back.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `xml` | 38 |  | local | Escapes ampersand, angle brackets and quotes for XML. |
| `para` | 45 |  | local | Builds a WordprocessingML paragraph with spacing, indent, bold and size options. |
| `documentXml` | 66 |  | local | Builds word/document.xml from title, intro, sections, points and items. |
| `buildTermsDocx` | 96 |  | export | Zips a minimal docx with the rendered text and a base64 JSON copy in a custom XML part. |
| `isStr` | 133 |  | local | Type guard for string. |
| `isNullableStr` | 134 |  | local | Type guard for string or null. |
| `isTermsText` | 137 |  | local | Structural type guard checking a value matches TermsText. |
| `readTermsText` | 168 |  | export | Extracts and validates the embedded TermsText JSON from a docx; null otherwise. |

#### `src/modules/terms/terms.domain.ts`

File role: Domain: Vistaar profile constant and TOC-n id rules.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `tocId` | 13 |  | export | Formats n as TOC-n. |

### modules/earning

#### `src/modules/earning/controllers/admin-earning-cohorts.controller.ts`

File role: Controller — HO earning-cohort CRUD, reorder, recompute and per-partner cohort view routes.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `AdminEarningCohortsController.list` | 44 | `GET /admin/earning-cohorts` · `@Can(earning.read)` |  | Delegates to EarningCohortsService.adminList: paged cohorts with partner counts. |
| `AdminEarningCohortsController.catalog` | 56 | `GET /admin/earning-cohorts/catalog` · `@Can(earning.read)` |  | Answers the partner fields and operators a cohort condition can use, so the HO portal builds its condition form from them. |
| `AdminEarningCohortsController.reorder` | 66 | `PUT /admin/earning-cohorts/order` · `@Can(earning.write)` |  | Delegates to EarningCohortsService.reorder with the ids and admin email. |
| `AdminEarningCohortsController.recompute` | 82 | `POST /admin/earning-cohorts/recompute` · `@Can(earning.write)` |  | Delegates to EarningCohortsService.recomputeNow; returns partners checked and changed. |
| `AdminEarningCohortsController.get` | 93 | `GET /admin/earning-cohorts/:id` · `@Can(earning.read)` |  | Delegates to EarningCohortsService.adminGet for one cohort view. |
| `AdminEarningCohortsController.create` | 100 | `POST /admin/earning-cohorts` · `@Can(earning.write)` |  | Delegates to EarningCohortsService.create with the body and admin email. |
| `AdminEarningCohortsController.update` | 114 | `PATCH /admin/earning-cohorts/:id` · `@Can(earning.write)` |  | Delegates to EarningCohortsService.update with id, body and admin email. |
| `AdminEarningCohortsController.archive` | 131 | `POST /admin/earning-cohorts/:id/archive` · `@Can(earning.write)` |  | Delegates to EarningCohortsService.archive with id and admin email. |
| `AdminPartnerEarningController.get` | 153 | `GET /admin/agents/:agentId/earning-cohort` · `@Can(earning.read)` |  | Delegates to EarningCohortsService.partnerView: partner cohort now, facts and history. |

#### `src/modules/earning/controllers/admin-earning-rules.controller.ts`

File role: Controller — HO earning-rule catalog, CRUD and reorder routes.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `AdminEarningRulesController.catalog` | 39 | `GET /admin/earning-rules/catalog` · `@Can(earning.read)` |  | Delegates to EarningRulesService.catalog: triggers, fields, operators, reward kinds. |
| `AdminEarningRulesController.list` | 49 | `GET /admin/earning-rules` · `@Can(earning.read)` |  | Delegates to EarningRulesService.list: paged rules filtered by cohort and trigger. |
| `AdminEarningRulesController.reorder` | 60 | `PUT /admin/earning-rules/order` · `@Can(earning.write)` |  | Delegates to EarningRulesService.reorder with the body and admin email. |
| `AdminEarningRulesController.get` | 76 | `GET /admin/earning-rules/:id` · `@Can(earning.read)` |  | Delegates to EarningRulesService.get for one rule view. |
| `AdminEarningRulesController.create` | 83 | `POST /admin/earning-rules` · `@Can(earning.write)` |  | Delegates to EarningRulesService.create with the body and admin email. |
| `AdminEarningRulesController.update` | 97 | `PATCH /admin/earning-rules/:id` · `@Can(earning.write)` |  | Delegates to EarningRulesService.update with id, body and admin email. |
| `AdminEarningRulesController.archive` | 111 | `POST /admin/earning-rules/:id/archive` · `@Can(earning.write)` |  | Delegates to EarningRulesService.archive with id and admin email. |

#### `src/modules/earning/dto/earning-cohort.dto.ts`

File role: DTO — validated bodies, params and queries for earning cohorts, with trim/case transforms.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `trim` | 33 |  | local | Trims a string value; other values pass through. |
| `lower` | 35 |  | local | Trims and lower-cases a string value. |
| `upper` | 37 |  | local | Trims and upper-cases a string value. |
| `eachTrim` | 39 |  | local | Trims each string in an array value. |
| `eachUpper` | 43 |  | local | Trims and upper-cases each string in an array value. |
| `toBool` | 49 |  | local | Converts true, "true" or "1" to boolean true. |

#### `src/modules/earning/dto/earning-rule.dto.ts`

File role: DTO — validated bodies, params and queries for earning rules and their conditions.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `trim` | 36 |  | local | Trims a string value; other values pass through. |
| `lower` | 38 |  | local | Trims and lower-cases a string value. |
| `toBool` | 40 |  | local | Converts true, "true" or "1" to boolean true. |

#### `src/modules/earning/earning.domain.ts`

File role: Domain — pure rules for cohort filters, cohort picking, ids, ordering and rule-condition matching.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `normText` | 96 |  | export | Trims, collapses spaces and lower-cases text for comparison. |
| `tidy` | 99 |  | local | Trims and collapses inner whitespace, keeping case. |
| `uniqueText` | 102 |  | local | Drops blanks and case-insensitive duplicates, keeping first spelling; optional upper-casing. |
| `normalizeFilters` | 116 |  | export | Normalises HO filters: unique states (upper), districts, pincodes; non-positive thresholds become null. |
| `hasFilters` | 131 |  | export | True when any state, district, pincode or minimum threshold filter is set. |
| `cohortOrder` | 141 |  | export | Active cohorts sorted by priority, default last, ties broken by id. |
| `pickCohort` | 150 |  | export | Returns the first active cohort in priority order whose conditions match the partner, else the default cohort. |
| `cohortIdOf` | 166 |  | export | Builds an ec_ slug id from a name or key; null when nothing usable remains. |
| `withSuffix` | 179 |  | export | Appends _n to a cohort id for n above 1, trimming to stay within length. |
| `orderError` | 190 |  | export | Returns an error message unless ids name every current id exactly once; else null. |
| `cohortAtIn` | 203 |  | export | From assignment rows, returns the cohort whose latest start is at or before the date. |
| `opsOf` | 261 |  | export | Returns a catalog field's own operators, else the operators its type allows. |
| `fieldOf` | 476 |  | export | Looks up a trigger catalog field by key. |
| `isText` | 482 |  | local | True for a non-blank string within the max text length. |
| `checkConditionIn` | 490 |  | export | Validates one condition against a field list (known field, allowed operator, value type); returns the stored form or a readable error. |
| `checkCondition` | 554 |  | export | Validates a rule condition against its trigger's catalog fields; returns the stored form or an error. |
| `matchesCondition` | 566 |  | export | Tests one condition (eq, in, any_of, gte, lte) against the facts, text compared case-insensitively; a missing fact never matches. |
| `pickRewards` | 611 |  | export | Picks, in rule order, the first matching active rule per reward kind for a trigger. |
| `describeConditionsIn` | 635 |  | export | Builds a readable summary of conditions with field labels, shortening long lists to a few values plus a count. |
| `describeConditions` | 655 |  | export | Builds a readable summary of a rule's conditions, or 'Every time' when there are none. |
| `matchesConditions` | 720 |  | export | True when every condition holds against the facts, so a cohort needs all its conditions. |
| `cohortConditionsOf` | 726 |  | export | Returns a cohort's conditions, converting a legacy filters-only row on the spot. |
| `filtersToConditions` | 733 |  | export | Converts legacy filters into the equivalent conditions in a fixed order, so a round trip compares equal. |
| `conditionsToFilters` | 755 |  | export | Derives the legacy filters view from conditions, for clients still reading filters. |
| `describeCohortConditions` | 786 |  | export | Builds a readable summary of a cohort's conditions, or 'Every partner' when there are none. |

#### `src/modules/earning/repositories/earning-assignment.repository.ts`

File role: Repository — partner cohort stretches in vistaar_v2_earning_assignments.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `isDuplicateKey` | 27 |  | local | True when the error is a Mongo duplicate-key (11000) error. |
| `EarningAssignmentRepository.open` | 37 |  |  | Reads the partner open assignment row in vistaar_v2_earning_assignments. |
| `EarningAssignmentRepository.openAll` | 45 |  |  | Reads every open assignment (id, agent, cohort, from) in vistaar_v2_earning_assignments. |
| `EarningAssignmentRepository.history` | 61 |  |  | Reads a partner assignment stretches newest first, capped at 500. |
| `EarningAssignmentRepository.forAgents` | 71 |  |  | Reads all stretches of the given partners, sorted by agent then start. |
| `EarningAssignmentRepository.at` | 91 |  |  | Reads the cohort of the partner latest stretch started by the given time. |
| `EarningAssignmentRepository.switchTo` | 104 |  | async | Closes the open stretch and inserts a new open one; false if another process won. |
| `EarningAssignmentRepository.switchMany` | 134 |  | async | Bulk closes open stretches and inserts new ones; returns agents whose insert succeeded. |
| `EarningAssignmentRepository.row` | 180 |  | private | Builds a new open assignment document with a random UUID. |

#### `src/modules/earning/repositories/earning-cohort.repository.ts`

File role: Repository — earning cohorts in vistaar_v2_earning_cohorts.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `isDuplicateKey` | 25 |  | local | True when the error is a Mongo duplicate-key (11000) error. |
| `EarningCohortRepository.all` | 36 |  |  | Reads every cohort in vistaar_v2_earning_cohorts. |
| `EarningCohortRepository.find` | 40 |  |  | Reads one cohort by id in vistaar_v2_earning_cohorts. |
| `EarningCohortRepository.ensureDefault` | 45 |  | async | Upserts the default cohort (no conditions, priority 0) with setOnInsert; ignores duplicate-key races between processes. |
| `EarningCohortRepository.create` | 76 |  | async | Inserts a cohort into vistaar_v2_earning_cohorts; false when the id is taken. |
| `EarningCohortRepository.save` | 89 |  |  | Updates an active cohort at the given version and bumps version; null on mismatch. |
| `EarningCohortRepository.archive` | 105 |  |  | Marks an active cohort archived with who and when, bumping version. |
| `EarningCohortRepository.setPriorities` | 125 |  | async | Bulk sets priority by list position on active cohorts. |

#### `src/modules/earning/repositories/earning-rule.repository.ts`

File role: Repository — earning rules in vistaar_v2_earning_rules.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `EarningRuleRepository.list` | 33 |  |  | Reads rules in vistaar_v2_earning_rules filtered by cohort, trigger, status, capped. |
| `EarningRuleRepository.find` | 46 |  |  | Reads one rule by id in vistaar_v2_earning_rules. |
| `EarningRuleRepository.active` | 51 |  |  | Reads a cohort active rules, optionally for one trigger, by order. |
| `EarningRuleRepository.maxOrder` | 66 |  | async | Returns the highest order among a cohort active rules, or 0. |
| `EarningRuleRepository.create` | 76 |  | async | Inserts a rule into vistaar_v2_earning_rules and returns it. |
| `EarningRuleRepository.save` | 84 |  |  | Updates an active rule at the given version and bumps version; null on mismatch. |
| `EarningRuleRepository.archive` | 100 |  |  | Marks an active rule archived with who and when, bumping version. |
| `EarningRuleRepository.setOrder` | 120 |  | async | Bulk sets order by list position on a cohort active rules. |

#### `src/modules/earning/services/earning-cohorts.service.ts`

File role: Service — earning cohort CRUD and assigning each approved partner to a cohort.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `message` | 135 |  | local | Returns an error message string from any thrown value. |
| `isWorking` | 139 |  | local | True when the partner is approved and not switched off. |
| `factsOf` | 142 |  | local | Builds partner facts (state, district, pincode, open leads, customers) from profile and holdings. |
| `EarningCohortsService.useHoldings` | 178 |  |  | Registers the leads module holdings source. |
| `EarningCohortsService.all` | 189 |  | async | Returns all cohorts with conditions filled in, creating the default if missing; active in priority order, then archived newest first. |
| `EarningCohortsService.find` | 204 |  | async | Finds one cohort by id with conditions filled in; the default goes through all so it always exists. |
| `EarningCohortsService.get` | 212 |  | async | Finds a cohort or throws not found. |
| `EarningCohortsService.current` | 222 |  | async | Returns the partner's current cohort and since; assigns an approved unassigned partner first. |
| `EarningCohortsService.cohortAt` | 250 |  | async | Returns the cohort id the partner was in at a time, or null. |
| `EarningCohortsService.assignmentsOf` | 257 |  |  | Delegates to the assignment repository for the unique upper-cased partner ids. |
| `EarningCohortsService.recompute` | 269 |  |  | Queues a per-partner cohort recompute so one partner runs serially. |
| `EarningCohortsService.recomputeLater` | 278 |  |  | Fires recompute for each partner in the background, logging failures. |
| `EarningCohortsService.recomputeAll` | 294 |  | async | Re-picks every approved partner cohort in memory, bulk-writes changes, retries race losers. |
| `EarningCohortsService.recomputeAllLater` | 361 |  |  | Runs recomputeAll in the background, rerunning once more if asked again meanwhile. |
| `EarningCohortsService.adminList` | 388 |  | async | Pages cohorts (optionally archived) with partner counts for HO. |
| `EarningCohortsService.adminGet` | 407 |  | async | Returns one cohort view with its partner count. |
| `EarningCohortsService.catalog` | 416 |  |  | Returns the cohort field catalog with each field's operators, plus operator labels, for the HO condition form. |
| `EarningCohortsService.create` | 424 |  | async | Creates a cohort from checked conditions or legacy filters with a free ec_ id just above the default; COHORT_EXISTS when none free. |
| `EarningCohortsService.update` | 495 |  | async | Patches a cohort at its version; EARNING_ARCHIVED, EARNING_COHORT_LOCKED, VERSION_CONFLICT; recomputes partners when conditions change. |
| `EarningCohortsService.archive` | 553 |  | async | Archives a non-default cohort and recomputes all; EARNING_COHORT_LOCKED or EARNING_ARCHIVED. |
| `EarningCohortsService.reorder` | 570 |  | async | Sets cohort priorities if ids match all active non-default; else EARNING_ORDER_CHANGED. |
| `EarningCohortsService.recomputeNow` | 582 |  |  | Delegates to recomputeAll with reason recompute, awaited. |
| `EarningCohortsService.partnerView` | 587 |  | async | Returns partner current cohort, facts and stretch history for HO. |
| `EarningCohortsService.recomputeOne` | 622 |  | private async | Picks one partner cohort and switches stretch if changed, retrying once on a race. |
| `EarningCohortsService.holdingsOf` | 678 |  | private | Calls the registered holdings source; throws if none registered. |
| `EarningCohortsService.checkConditions` | 689 |  | private | Validates cohort conditions against the cohort field catalog, rejecting conditions sent with filters; VALIDATION_FAILED lists every error. |
| `EarningCohortsService.checkFilters` | 723 |  | private | Normalises legacy filters; VALIDATION_FAILED when none set, since an empty cohort would equal the default. |
| `withConditions` | 735 |  | local | Fills a pre-conditions cohort row's conditions from its legacy filters. |
| `viewOf` | 742 |  | local | Maps a cohort record to its view with id, conditions, derived filters, summary, is_default and partner count. |

#### `src/modules/earning/services/earning-rules.service.ts`

File role: Service — earning rule CRUD, catalog, and evaluating what an event pays.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `EarningRulesService.evaluate` | 105 |  | async | Returns rewards a trigger earns from the partner's current cohort's active rules; nothing before placement; writes nothing. |
| `EarningRulesService.appCohort` | 125 |  | async | Returns the partner cohort and its active rules with summaries for the app. |
| `EarningRulesService.catalog` | 144 |  |  | Returns triggers with fields and operators, operator labels and reward kinds, for the HO rule form. |
| `EarningRulesService.list` | 160 |  | async | Pages rules filtered by cohort, trigger and archived flag. |
| `EarningRulesService.get` | 175 |  | async | Returns one rule view or not found. |
| `EarningRulesService.create` | 180 |  | async | Creates a rule last in an active cohort with checked conditions; EARNING_ARCHIVED otherwise. |
| `EarningRulesService.update` | 211 |  | async | Patches name, conditions or reward at version; EARNING_ARCHIVED, VERSION_CONFLICT. |
| `EarningRulesService.archive` | 243 |  | async | Archives an active rule; EARNING_ARCHIVED if already archived. |
| `EarningRulesService.reorder` | 253 |  | async | Sets rule order if ids match all active rules of the cohort; else EARNING_ORDER_CHANGED. |
| `EarningRulesService.require` | 265 |  | private async | Finds a rule or throws not found. |
| `checkConditions` | 273 |  | local | Checks every condition against the catalog; VALIDATION_FAILED listing all errors. |
| `viewOf` | 288 |  | local | Maps a rule record to its view with id and conditions summary. |

### modules/rewards

#### `src/modules/rewards/controllers/admin-rewards.controller.ts`

File role: Controller — HO reward list, summary, and single or bulk approve/reject routes.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `AdminRewardsController.list` | 43 | `GET /admin/rewards` · `@Can(rewards.read)` |  | Delegates to RewardsService.list: paged rewards with filters. |
| `AdminRewardsController.summary` | 55 | `GET /admin/rewards/summary` · `@Can(rewards.read)` |  | Delegates to RewardsService.summary for a date range. |
| `AdminRewardsController.approveMany` | 67 | `POST /admin/rewards/approve` · `@Can(rewards.review)` |  | Delegates to RewardsService.approveMany with ids and admin email. |
| `AdminRewardsController.rejectMany` | 81 | `POST /admin/rewards/reject` · `@Can(rewards.review)` |  | Delegates to RewardsService.rejectMany with ids, reason and admin email. |
| `AdminRewardsController.get` | 95 | `GET /admin/rewards/:id` · `@Can(rewards.read)` |  | Delegates to RewardsService.get for one reward. |
| `AdminRewardsController.approve` | 102 | `POST /admin/rewards/:id/approve` · `@Can(rewards.review)` |  | Delegates to RewardsService.approve with id and admin email. |
| `AdminRewardsController.reject` | 118 | `POST /admin/rewards/:id/reject` · `@Can(rewards.review)` |  | Delegates to RewardsService.reject with id, reason and admin email. |

#### `src/modules/rewards/controllers/rewards.controller.ts`

File role: Controller — partner reward list and summary routes.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `RewardsController.summary` | 24 | `GET /rewards/summary` |  | Delegates to RewardsService.summaryMine for the token partner. |
| `RewardsController.list` | 33 | `GET /rewards` |  | Delegates to RewardsService.mine for the token partner, paged. |

#### `src/modules/rewards/dto/reward.dto.ts`

File role: DTO — validated queries, params and decision bodies for rewards.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `trim` | 29 |  | local | Trims a string value; other values pass through. |
| `upper` | 31 |  | local | Trims and upper-cases a string value. |

#### `src/modules/rewards/repositories/reward.repository.ts`

File role: Repository — reward rows in vistaar_v2_rewards.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `isDuplicateKey` | 40 |  | local | True when the error is a Mongo duplicate-key (11000) error. |
| `RewardRepository.insertNew` | 54 |  | async | Inserts rows into vistaar_v2_rewards one by one, skipping duplicate ids; returns inserted ids. |
| `RewardRepository.find` | 67 |  |  | Reads one reward by id in vistaar_v2_rewards. |
| `RewardRepository.findMany` | 71 |  |  | Reads rewards by a list of ids. |
| `RewardRepository.page` | 78 |  | async | Reads a newest-first page of rewards plus total count for a filter. |
| `RewardRepository.totals` | 98 |  |  | Aggregates count and amount per kind and status for a filter. |
| `RewardRepository.approvedGigs` | 123 |  |  | Reads a partner approved gig rewards (id, amount, reviewed_at). |
| `RewardRepository.decide` | 134 |  |  | Sets decision on one pending reward; null if missing or not pending. |
| `RewardRepository.decideMany` | 159 |  | async | Sets decision on all listed pending rewards (optionally one agent); returns modified count. |
| `toQuery` | 188 |  | local | Builds the Mongo filter from agent, status, kind, trigger and created date range. |

#### `src/modules/rewards/rewards.domain.ts`

File role: Domain — pure reward rules: IST day key, reward ids, due follow-ups, bulk outcome.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `istDayKey` | 33 |  | export | Returns the IST calendar day as YYYY-MM-DD. |
| `rewardIdOf` | 43 |  | export | Builds the deterministic reward id trigger:parts:kind, so each event pays once per kind. |
| `dueFollowUp` | 56 |  | export | Returns due day and days overdue when a counting activity meets a follow-up due by today IST. |
| `bulkOutcome` | 73 |  | export | Splits bulk ids into changed (carry this decision stamp) and skipped with current status. |

#### `src/modules/rewards/services/rewards.service.ts`

File role: Service — records rewards on lead events, partner views, and HO review.

| Function | Line | Route / guard | Kind | Purpose |
|---|---|---|---|---|
| `RewardsService.leadCreated` | 136 |  |  | Records lead_created rewards once per farmer from crops, acreage and place facts. |
| `RewardsService.followUpDone` | 163 |  |  | Records follow_up_done rewards once per farmer and due day when a counting activity completes a follow-up due by today. |
| `RewardsService.leadStageAdvanced` | 190 |  |  | Records lead_stage_advanced rewards once per farmer and new stage, with from and to stage facts. |
| `RewardsService.reorder` | 209 |  |  | Records reorder rewards once per order, with the gap in days since the farmer's previous order. |
| `RewardsService.meetingAttendeeCaptured` | 229 |  |  | Records meeting_attendee_captured rewards once per meeting and farmer, with crops and acreage facts. |
| `RewardsService.gigApproved` | 250 |  |  | Records gig_approved rewards once per gig, with attendee and photo counts as facts. |
| `RewardsService.eventRegistered` | 264 |  |  | Records event_registered rewards once per HO event per partner. |
| `RewardsService.attendanceStreak` | 278 |  |  | Records attendance_streak rewards once per partner per IST day, with the unbroken field-day streak length. |
| `RewardsService.onboardingApproved` | 292 |  |  | Records the onboarding_approved welcome reward once per partner, with partner type and state facts. |
| `RewardsService.storyCreated` | 306 |  |  | Records story_created rewards once per new My Story, with its template; edits never fire it. |
| `RewardsService.leadRemoved` | 320 |  | async | Rejects the removed lead's pending lead_created coin and gig rewards as system; logs errors and returns 0. |
| `RewardsService.record` | 340 |  | private async | Evaluates rules and inserts pending rewards with deterministic ids, skipping non-positive amounts; logs and swallows errors. |
| `RewardsService.mine` | 379 |  | async | Pages the partner own rewards by kind and status. |
| `RewardsService.summaryMine` | 395 |  | async | Returns partner coin and gig approved/pending totals plus gig_pay_enabled. |
| `RewardsService.gigCreditsFor` | 420 |  | async | Returns the partner approved gig rewards as wallet credits. |
| `RewardsService.list` | 433 |  | async | Pages rewards for HO with filters and IST date range, adding partner info. |
| `RewardsService.summary` | 452 |  | async | Returns per-kind totals and pending count for an IST date range. |
| `RewardsService.get` | 464 |  | async | Returns one reward HO view or not found. |
| `RewardsService.approve` | 471 |  |  | Delegates to decide with approved. |
| `RewardsService.reject` | 475 |  |  | Delegates to decide with rejected and the reason. |
| `RewardsService.approveMany` | 479 |  |  | Delegates to decideMany with approved. |
| `RewardsService.rejectMany` | 483 |  |  | Delegates to decideMany with rejected and the reason. |
| `RewardsService.decide` | 492 |  | private async | Decides one pending reward; not found or REWARD_NOT_PENDING when not pending. |
| `RewardsService.decideMany` | 518 |  | private async | Decides unique pending ids at one instant and reports changed versus skipped. |
| `RewardsService.adminViews` | 532 |  | private async | Adds partner details, rule, cohort and reviewer to reward views. |
| `viewOf` | 549 |  | local | Maps a reward record to the partner view with its trigger label. |
| `byKind` | 569 |  | local | Groups totals into kind then status with zeros for missing. |

