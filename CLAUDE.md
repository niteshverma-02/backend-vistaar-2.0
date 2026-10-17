# CLAUDE.md — working rules for this repo

**What this is:** the v2 backend for Vistaar 2.0 — the Vistaar app and its
HO portal screens. A rewrite, not a port: every collection this
service owns is a new `vistaar_v2_*` collection, and every route is `/api/v2`.
The old Vistaar (KSS app + `CRM-Backend`) keeps running on its own collections
(`vistaaragents`, `vistaarfarmers`), which this service never writes.

**The database is shared production data.** `CRM-Database` is used by ko-sales,
Stockship, prasar, franchise and others. Read anything; write only our own
`vistaar_v2_*` collections, plus a new person and verified KYC documents on
`piis`, and the farmers partners add as org leads (see *Shared records*).

Conventions follow `prasar-backend` (`CLAUDE.md` on its `beta` branch) and
`franchise-offline-hub`, so the HO portal can talk to all three the same way.

---

## Commands

```bash
pnpm start:dev     # watch mode
pnpm typecheck     # tsc --noEmit — must be 0 errors
pnpm lint          # eslint --fix, type-checked rules
pnpm test          # jest — unit specs
pnpm test:e2e      # jest --config test/jest-e2e.json — HTTP layer
pnpm build         # nest build → node dist/main
pnpm start:cluster # node dist/cluster — one worker per core
```

Run **`pnpm typecheck && pnpm lint && pnpm test`** before calling any change done.

---

## The four layers

```
Controller  →  Service  →  Repository  →  Schema
   HTTP        Business      Mongo         DB shape
```

| Layer | Does | Never does |
|---|---|---|
| **Controller** | Routing, DTO validation, guards, Swagger | Business logic. Mongoose. |
| **Service** | Business rules, calls other services | Touch a Mongoose model — **not even an import** |
| **Repository** | Queries, aggregations, `.lean()` reads | Business decisions. HTTP concepts. |
| **Schema** | Document shape, indexes, collection name | Logic |

Need another module's data? Inject its **service** — never its repository or
schema (lint-enforced).

```
src/
├── main.ts              bootstrap: Fastify, helmet, compress, ETag, CORS, /api/v2, Swagger
├── app.module.ts        root composition — every module is wired here
├── config/              env.schema.ts — the only place process.env is read
├── core/                runs by itself on every request: guards, filters, interceptors, http
├── common/              toolbox, runs only when imported: decorators, dto, errors, http, utils
├── database/            Mongo connection + IndexSyncService (vistaar_v2_* only)
└── modules/             one folder per business domain
```

Dependencies point one way: `modules → core → common`. Aliases `@core/*`,
`@common/*`, `@config/*`, `@database/*`, `@modules/*` across units; relative
`./` inside a module. Aliases live in `tsconfig.json`, `package.json` (jest)
and `eslint.config.mjs` — keep the three in agreement.

### Module layout

```
src/modules/<feature>/
├── controllers/<x>.controller.ts
├── services/<x>.service.ts
├── repositories/<x>.repository.ts
├── schemas/<x>.schema.ts            @Schema({ collection: 'vistaar_v2_…' })
├── dto/
├── <x>.domain.ts                    pure rules (stage moves, validators) — test these
└── <x>.module.ts
```

Add `guards/`, `providers/`, `utils/` only when the need is real. Read-only
aggregations for HO screens go in a `<x>.query-service.ts`.

---

## Non-negotiables

1. **Identity comes from the token, never the body.** A partner can read and
   write only their own records; nothing in a DTO says who the caller is.
2. **Auth is on by default.** A global guard protects every route; opt out with
   `@Public()` deliberately. HO routes live under `/admin/*` and check a
   capability, not a role name.
3. **One URI version: `/api/v2`.**
4. **One response envelope.** Return a plain value; `EnvelopeInterceptor` wraps
   it as `{ "success": true, "data": … }`. Lists return `PageResult<T>`:
   `{ items, page, limit, total, has_more }` inside `data`, `limit` clamped to
   200. Errors are `AllExceptionsFilter`'s job — throw through `apiError()` /
   `badRequest()` so `error.code` stays inside `API_ERROR_CODES`.
5. **Every env var is declared in `config/env.schema.ts`** (and `.env.example`).
6. **Collection names are always explicit.** Never rely on Mongoose pluralisation.
7. **No index declarations on shared collections.** `vistaar_v2_*` declare
   theirs on the schema; `IndexSyncService` builds them outside production, and
   every index is also listed in `docs/PROD-CHECKLIST.md` for production.

---

## Shared records

A Vistaar partner is **not a customer**: the partner is never written to
`leads_v2`, `contacts_v2`, `customers`, `addresses` or `agents_v2`.

The partner's one shared write is the person on `piis`: at the first OTP verify,
`modules/spine/PiiService` finds the PII by phone (oldest first) or inserts a
new one (`app_counters.piis` `$inc`, retry on collision, never `referral_id`).
`pii_id` (`PII-n`) is the true link; we keep a copy of the phone and name only
for fast search. When HO verifies a KYC document whose form field has an
`org_document`, `PiiService` copies it to `piis.documents.<type>` (ko-sales
entry shape, `source: 'vistaar'`, dotted `$set` only) — never over another
portal's entry. Files live private in the org bucket under
`KO-documents/<pii_id>/`. Partners carry role `USR-1040` (Vistaar Partner; head
USR-1037) on `vistaar_v2_agents.user_role`.

**Exception — farmer leads** (TL, 2026-10-12): the farmers a partner adds are
org leads, inserted directly the way prasar-backend writes its retailers, with
ko-sales' `/leads/upsert` as the reference shape — `leads_v2` +
`contacts_v2` + an `addresses` row (+ `piis.addresses[]`), ids from
`app_counters` (`leads`, `contacts`, `addresses`). Always `source:
'vistaar'` and `created_by: VST-…`; only for a person with no lead or
contact yet (a farmer from another channel is only linked, in
`vistaar_v2_leads`), and later updates filter on `source`, so another
channel's records are never changed. A GPS fix of the farm goes on that
`addresses` row as `geo {lat, lng}` (Vistaar's rows only). The partner's
follow-up (`vistaar_v2_leads.next_follow_up`) is mirrored to
`leads_v2.follow_up_date` on Vistaar's own lead rows only (filter `lead_id` +
`source`, that one field), after the partner's row, a failure only logged
(user's decision, 2026-10-16). Owner = the one active Offline Head
(USR-1037) as `{agent_id, agent_ref}`, unless `settings.lead_owner_agent_id`
names another. Never `profiled_at` (keeps the offline lead out of telecaller
cohorts). No pipeline, LQS or webhook. See `docs/DATABASE.md`.

Other apps' collections read here, read-only: `agents_v2` (HO role, owner
names), `pincode_map_v2`, `orders_v2` + `products_v2` (the partner's orders:
`source: 'vistaar'`, partner's `VST-` id in `agent`; decided 2026-10-12; the
commission module reads `orders_v2` too), `bulk_v2` + `categories_v2` (GST and
category, held in memory), and `franchises` / `prasar_v2_retailers` /
`vistaaragents` for the nearby-network warning (and `franchises` as the KKD stores on
the radar).

**Exception — `carts`** (owned by B2B Sales): the cart module writes its rows
there directly, by the user's decision (2026-10-08), always with
`source: 'vistaar'` and always filtering on `_id` + `source`. Its rows use
B2B's existing row shape exactly — no Vistaar-only fields and no `user_id`
(user's decisions, 2026-10-09): `pii_id` is the farmer, or the partner's own
`pii_id` for shop stock, and the partner is only in the `_id`, derived from
their `VST-` id. No index is declared in code, and none is needed.

**Exception — `draft_orders`** (shared with the B2B order portal and Sankalp):
the draft-order module writes its rows there directly, by the user's decision
(2026-10-09), always with `entry_path: 'vistaar'` and always filtering on
`entry_path` + `agent_id`. Rows use the existing shape exactly, plus one
user-approved field, `reminder_sent`. Its `DFT-n` ids come from the
`app_counters` row `_id: 'draft_orders'` by the same atomic `$inc` the other
writers make — the only write this module makes to `app_counters`, never an
upsert.

**Exception — `terms_and_conditions`** (shared with Krishi Sampark, B2B Portal,
RLM): the terms module keeps Vistaar's partner T&C there, by the user's
decision (2026-10-13), instead of a `vistaar_v2_*` collection. Rows use the
existing shape exactly — `toc_id` (`TOC-n`), `title`, `link` (the document),
`profiles`, `is_active`, `__v` — with `profiles: ['vistaar']`, and every read
and write filters on `profiles: 'vistaar'`. `TOC-n` is the next number after
every app's rows (the collection's unique `{toc_id}` index; retry on
collision). One Vistaar row is active at a time.
The portal writes the text in an editor: the server makes the .docx
(`terms-docx.ts`) and keeps the text inside it as a custom XML part, so it
opens again — no other store. Editing keeps the `toc_id` and raises the
row's existing `__v` (version = `__v + 1`, user's decision 2026-10-13); a new
`TOC-n` is only for the first T&C.
Vistaar's document holds both the privacy policy and the partner terms. No
index is declared in code.

**Exception — `product_reviews` + `product_testimonials`** (owned by Stockship
v3): partner testimonials are written there by the user's decision
(2026-10-14) — the collections are Stockship's, the APIs are ours. Only on HO's
approval (pending ones live in `vistaar_v2_testimonials`), always with
`source: 'vistaar'`, Stockship's row shape exactly (`verified_by` /
`deleted_by` = HO email, `__v: 0`), upsert by the `_id` reserved at submit, and
every write filters on `_id` + `source`. The farmer's consent is its own
collection, `vistaar_v2_testimonial_consents`, never deleted. No index is
declared in code.

---

## Collections

| Domain | Collection | Note |
|---|---|---|
| Partners | `vistaar_v2_agents` | Created at OTP send (`otp_verified: false`); `VST-` id + `pii_id` at verify; `stage` drives the HO pipeline; profile mapped at approval. Never deleted |
| Onboarding | `vistaar_v2_onboarding_data` | `vistar_onboarding_data`: generic fields + `raw_data`, written per key; KYC review per document; optimistic `version` |
| Forms | `vistaar_v2_onboarding_configs` | Per cohort and version; published versions immutable; one draft per cohort |
| Cohorts | `vistaar_v2_cohorts` | HO-managed partner types |
| Sessions | `vistaar_v2_sessions` | SHA-256 of refresh tokens, TTL |
| OTP attempts | `vistaar_v2_otp_attempts` | `_id` `send:<phone>` or `verify:<phone>` (sign-in), `lead-send:` / `lead-verify:<phone>` (farmer OTP on lead add), sliding window of hits, one atomic pipeline update; TTL. Shared OTP limits across processes |
| Settings | `vistaar_v2_settings` | Default owner, farmer-lead owner, farmer-consent wording (versioned), lead / customer release days, commission (return window, min withdrawal, TDS rates, monthly target), conflict radius, Feedback reason chips |
| Leads | `vistaar_v2_leads` | One row per farmer a partner holds (unique `pii_id`): holder (released when not worked, HO transfer), stage, follow-up, activity, consent, `otp_verified_at` (farmer OTP mandatory on add — a 15-min signed token from `POST /leads/otp/verify`); copy of the farmer basics for lists. The farmer is the org's `leads_v2` / `contacts_v2`. A **customer** is a row at `won` — set by the order service's confirmed-order call (`/hooks/orders/confirmed`), business read from `orders_v2` |
| Counters | `vistaar_v2_counters` | `VST-`, `WD-` and `GIG-` series (not `app_counters`, not legacy `sequences`) |
| Commission plans | `vistaar_v2_commission_plans` | Rates per partner type or earning cohort from a month on (`<cohort>@<YYYY-MM>`, `ec_…` = earning cohort); fixed % or slabs, optional `min_order_value` (below → `ec_default`'s plan); past months locked; history kept. Order rate = cohort at placing; no earning plan saved = partner-type plan; no plan = the PRD's draft rates. Commission itself is never stored — worked out from `orders_v2` on read (`docs/COMMISSION-LOGIC.md`) |
| Withdrawals | `vistaar_v2_withdrawals` | `WD-` payout requests: TDS fixed at approval, bank file + UTR; one open per partner (unique partial `open: true`). Never deleted |
| Form 16A | `vistaar_v2_tds_certificates` | One private PDF per partner and quarter (HO upload) |
| Banners | `vistaar_v2_banners` | HO-managed Home carousel: own image (`vistaar/banners/`, public token URL) or text banner; cohort-targeted, scheduled; app reads cached ≤ 60 s |
| Attendance | `vistaar_v2_attendance` | One row per partner per IST day (`_id` `<agent_id>:<date>`), punch sessions with location at in/out only; server time |
| My Story | `vistaar_v2_stories` | Partner's saved stories (≤ 20, oldest drop off with files); same config + photo = one row; images private under `vistaar/stories/<agent_id>/` |
| Story stats | `vistaar_v2_story_stats` | One row per partner per IST day (`_id` `<agent_id>:<date>`), `$inc` counters for saves / shares by template and channel |
| Story festivals | `vistaar_v2_story_festivals` | HO-managed Festival-template greetings, unique `key`; app reads cached ≤ 60 s |
| Story templates | `vistaar_v2_story_templates` | My Story "Choose a design" cards: the six built-in ones (`_id` = layout; edit/hide only) + HO's custom cards on a `base` layout (own words, pre-fill, icons, design, suggested, window); saved story keeps `config.card`; app reads cached ≤ 60 s |
| Story designs | `vistaar_v2_story_designs` | HO-managed story looks: palette + optional 9:16 art (public, `vistaar/story-designs/`), template-targeted, scheduled; `key` = a saved story's `theme`; app reads cached ≤ 60 s |
| Story samples | `vistaar_v2_story_samples` | HO-managed ready-made farmer quotes for the Farmer story template (Vistaar-only, never on product pages) |
| Events | `vistaar_v2_events` + `vistaar_v2_event_registrations` | HO-run farmer events, cohort-targeted; a seat is `_id` `<event_id>:<agent_id>`, `registered_count` by conditional `$inc`; feeds My Story meetings |
| Meetings | `vistaar_v2_meetings` | Partner meetings (PRD C5): app UUID `_id`, attendees embedded (≤ 300, one write), counts kept in step; cancel instead of delete; capture-as-lead through `POST /leads` rules; HO read-only; WhatsApp invites not sent yet (no-op notifier) |
| Earning cohorts | `vistaar_v2_earning_cohorts` | HO-built cohorts for commission / gig / coin (**not** the onboarding cohort): `conditions[]{field, op, value}` (the rules' shape) on profile state / district / pincode and held open leads / customers (all hold, a list value on any entry; legacy `filters` accepted and converted, returned as a derived view); priority order, first match wins; built-in `ec_default` last (no conditions, never archived); `meeting_gig_payout`; optimistic `version`; archived, never deleted |
| Earning rules | `vistaar_v2_earning_rules` | Light rule engine: per cohort, trigger from the code catalog (`lead_created`, `follow_up_done`), conditions `{field, op, value}` checked against it, reward `{coin\|gig, amount}`, HO order; per reward kind the first matching rule pays; archived, never deleted |
| Earning assignments | `vistaar_v2_earning_assignments` | One row per stretch a partner spends in an earning cohort (`from`/`to`, one `open` per partner — unique partial); recomputed on approval, lead holdings changes and HO cohort changes; current copied to `vistaar_v2_agents.earning_cohort`; commission reads them for the cohort at an order's placing. Never deleted |
| Rewards | `vistaar_v2_rewards` | One row per coin / gig reward an event earned (`_id` `lead_created:<pii_id>:<kind>` / `follow_up_done:<pii_id>:<IST due day>:<kind>` — once per event and kind); rule, amount and cohort copied at the event; pending → approved / rejected by HO (single + bulk, status in the update filter); a removed lead's pending `lead_created` ones rejected by `system`. Approved gig ₹ joins the wallet with meeting gigs while `gig_pay_enabled`; coins are points only. Never deleted |
| Gigs | `vistaar_v2_gigs` | HO-posted paid farmer meetings (PRD AD14): GIG-n; open → accepted → checked_in → submitted → approved/rejected, HO cancel/reopen; GPS check-in flagged never blocked; attendees + ≤ 6 private photos on the row; pay reaches the wallet only with settings gig_pay_enabled (off until finance confirms TDS); payout empty = taker's earning-cohort `meeting_gig_payout` (else settings), fixed at accept/assign (`payout_source`) |
| FAQs | `vistaar_v2_faqs` + `vistaar_v2_faq_sections` | HO-managed sections (`_id` = key, delete only when empty) and help FAQs `{category = section key, q, a}`, unique normalised question; `GET /faqs` returns live sections + FAQs, cached ≤ 60 s |
| Terms | `terms_and_conditions` (shared, `profiles: ['vistaar']`) | Existing shape exactly: `toc_id` `TOC-n`, `title`, `link` to the document, `is_active` (one active Vistaar row); public app read cached ≤ 60 s. See *Shared records* |
| Info pages | `vistaar_v2_info_pages` | HO-edited About Vistaar, About Katyayani, Contact Us: one row per page (`_id` = page), own CRUD per page (`/admin/about-program` …), `content` checked by the page's DTO, optimistic `version`; public app read cached ≤ 60 s, Contact Us `open_now` per request |
| Feedback | `vistaar_v2_feedback` + `vistaar_v2_product_suggestions` | Feedback screen: NPS (bucket server-side), reasons, comment, stars; a detractor opens a call-back due in 2 working days (Mon–Sat IST) for the partner's owner. "Suggest a product" rows `_id` `SUG-n` (`vistaar_v2_counters`), grouped by `product_key`. Partner snapshot copied at submit; 10 answers / 20 suggestions per IST day |
| Testimonials | `vistaar_v2_testimonials` | One row per testimonial a partner sends (`_id` = app's UUID): farmer (own lead), product, crop, kind video/photo/text, rating, private media under `vistaar/testimonials/<agent_id>/`, status submitted/approved/rejected/removed + reason, reserved `review_id` / `testimonial_id`, views/shares. Library = approved |
| Testimonial consents | `vistaar_v2_testimonial_consents` | Farmer's consent per testimonial (`_id` = its id): version + exact words + lang, given/withdrawn. Never deleted; wording versioned in settings `testimonial_consent` |
| Payment options | `vistaar_v2_payment_options` + `vistaar_v2_payment_option_audit` | HO switches Razorpay / Cashfree / PhonePe on/off, label, hint, cohorts, order; providers closed in code; optimistic `version`; insert-only audit. Shown only with approved keys; app read cached ≤ 60 s, empty while `PAYMENTS_ONLINE_ENABLED` is off |
| Payment keys | `vistaar_v2_payment_credentials` | Merchant keys, company admins only (`payments.credentials`): AES-256-GCM sealed with `PAYMENTS_CREDENTIALS_KEY` (env only), never returned (masked), gateway check + a **second** admin approves, old/rejected sets wiped, Slack alert. Production takes live keys only, other servers test only |
| testimonials | `product_reviews`, `product_testimonials` (shared, `source: 'vistaar'`) | Written on HO approval only; Stockship's shape exactly. See *Shared records* |
| cart | `carts` (shared, `source: 'vistaar'`) | B2B's row shape exactly, no `user_id`; `pii_id` = farmer (partner's own for shop stock), `_id` derived from the partner. See `docs/DATABASE.md` |
| draft-order | `draft_orders` (shared, `entry_path: 'vistaar'`) | Existing shape + `reminder_sent`; partner in `agent_id`; id from `app_counters`. See `docs/DATABASE.md` |
| leads | `leads_v2`, `contacts_v2`, `addresses` (shared, `source: 'vistaar'`) | Farmers partners add; new people only; `created_by` = `VST-…`. See `docs/DATABASE.md` |

Auth: partners use our own HS256 token (`core/auth/partner-token.service.ts`);
HO routes (`@Can(...)`, `/admin/*`) accept only the company SSO token and check a
capability from `modules/access/access.domain.ts`.

---

## Writing code here

- Comments explain *why*, never *what*.
- More than one process runs in production, and **there is no Redis**: caching
  is per-process memory, fine only for data that may lag ≤ 60 s. State every
  process must agree on (OTP attempt counts) goes in a `vistaar_v2_*` Mongo
  collection with one atomic update.
- No `any` (lint error). Named exports, `type` imports, Swagger decorators on
  every route, `.lean()` on every read.
- Test the decisions, not the framework: domain rules and service branching.
- Docs ship with the code: `docs/<FEATURE>-APP.md` for the mobile app,
  `docs/<FEATURE>-HO.md` for the HO portal, plus `DATABASE.md` and
  `PROD-CHECKLIST.md` in the same branch.
- Git: one `feat/<module>` branch per module, PR into `beta`.
