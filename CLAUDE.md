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
channel's records are never changed. Owner = the one active Offline Head
(USR-1037) as `{agent_id, agent_ref}`, unless `settings.lead_owner_agent_id`
names another. Never `profiled_at` (keeps the offline lead out of telecaller
cohorts). No pipeline, LQS or webhook. See `docs/DATABASE.md`.

Other apps' collections read here, read-only: `agents_v2` (HO role, owner
names), `pincode_map_v2`, and `franchises` / `prasar_v2_retailers` /
`vistaaragents` for the nearby-network warning.

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

---

## Collections

| Domain | Collection | Note |
|---|---|---|
| Partners | `vistaar_v2_agents` | Created at OTP send (`otp_verified: false`); `VST-` id + `pii_id` at verify; `stage` drives the HO pipeline; profile mapped at approval. Never deleted |
| Onboarding | `vistaar_v2_onboarding_data` | `vistar_onboarding_data`: generic fields + `raw_data`, written per key; KYC review per document; optimistic `version` |
| Forms | `vistaar_v2_onboarding_configs` | Per cohort and version; published versions immutable; one draft per cohort |
| Cohorts | `vistaar_v2_cohorts` | HO-managed partner types |
| Sessions | `vistaar_v2_sessions` | SHA-256 of refresh tokens, TTL |
| Settings | `vistaar_v2_settings` | Default owner, farmer-lead owner, farmer-consent wording (versioned), conflict radius |
| Leads | `vistaar_v2_leads` | One row per farmer a partner holds (unique `pii_id`): holder, stage, follow-up, activity, consent; copy of the farmer basics for lists. The farmer is the org's `leads_v2` / `contacts_v2` |
| Counters | `vistaar_v2_counters` | `VST-` series (not `app_counters`, not legacy `sequences`) |
| cart | `carts` (shared, `source: 'vistaar'`) | B2B's row shape exactly, no `user_id`; `pii_id` = farmer (partner's own for shop stock), `_id` derived from the partner. See `docs/DATABASE.md` |
| draft-order | `draft_orders` (shared, `entry_path: 'vistaar'`) | Existing shape + `reminder_sent`; partner in `agent_id`; id from `app_counters`. See `docs/DATABASE.md` |
| leads | `leads_v2`, `contacts_v2`, `addresses` (shared, `source: 'vistaar'`) | Farmers partners add; new people only; `created_by` = `VST-…`. See `docs/DATABASE.md` |

Auth: partners use our own HS256 token (`core/auth/partner-token.service.ts`);
HO routes (`@Can(...)`, `/admin/*`) accept only the company SSO token and check a
capability from `modules/access/access.domain.ts`.

---

## Writing code here

- Comments explain *why*, never *what*.
- No `any` (lint error). Named exports, `type` imports, Swagger decorators on
  every route, `.lean()` on every read.
- Test the decisions, not the framework: domain rules and service branching.
- Docs ship with the code: `docs/<FEATURE>-APP.md` for the mobile app,
  `docs/<FEATURE>-HO.md` for the HO portal, plus `DATABASE.md` and
  `PROD-CHECKLIST.md` in the same branch.
- Git: one `feat/<module>` branch per module, PR into `beta`.
