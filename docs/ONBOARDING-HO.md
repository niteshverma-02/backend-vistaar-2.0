# Vistaar partners — HO portal (forms, pipeline, KYC, approval)

**Base URL:** `{VISTAAR_API}/api/v2` · bearer = the portal's **SSO** token
(`localStorage.sso_access_token`, the same one Prasar and Franchise screens send).
Every response is the standard envelope; lists are `{ items, page, limit, total, has_more }`
inside `data`.

## 1. Access

`GET /admin/me` → `{ email, agent_id, name, role, role_code, capabilities: [...] }`.
Gate screens and buttons on `capabilities`, never on role names.

| Capability | Allows |
|---|---|
| `agents.read` | pipeline, partner detail, settings read |
| `agents.edit` | correct a partner's form values (audited) |
| `kyc.review` | verify / reject a KYC document |
| `agents.decide` | approve, reject, request changes, block, unblock, reopen |
| `agents.assign` | change a partner's owner |
| `config.read` / `config.write` / `config.publish` | cohorts and forms |
| `settings.write` | default owner, conflict radius |
| `content.read` / `content.write` | Home banners (`docs/BANNERS-HO.md`) |

Today every capability goes to **USR-1037 (Offline Head), USR-1000 (Super Admin), USR-1001 (Admin)**
(`agents_v2.user_role`, read once per token). Others get `403 NO_ADMIN_ACCESS`; a role
without the capability gets `403 ROLE_NOT_ALLOWED`. A partner token on these routes is `401`.

## 2. Pipeline (the tabs)

Stages: `signed_up → onboarding → kyc_review → approved`, with `changes_requested` (back to the
partner), `rejected` (reopenable) and `blocked` (from anywhere; unblock returns to where it was).

| Method | Path | |
|---|---|---|
| GET | `/admin/agents/summary` | `{ stages: { signed_up, onboarding, kyc_review, changes_requested, approved, rejected, blocked }, unverified, total, by_cohort: [{ key, count }], by_state: [{ key, count }] }` — the top 10 cohorts and states among verified partners |
| GET | `/admin/agents` | list — query below |
| GET | `/admin/agents/:agentId` | one partner in full (`agentId` = `VST-000001`) |

List query: `stage`, `cohort`, `state`, `district`, `owner_agent_id`, `q` (name, phone prefix,
`VST-…`, `PII-…`), `from` / `to` (signup date), `include_unverified`, `page`, `limit` (≤ 200),
`sort` = `-created_at` (default) | `created_at` | `-updated_at` | `updated_at` | `-decided_at` | `decided_at`.

Row: `{ agent_id, pii_id, phone, name, cohort, sub_cohort, district, state, village, pincode,
email, stage, otp_verified, is_approved, completion_pct, submitted_at, decided_at, last_login_at,
owner: { agent_id, name }, created_at, updated_at }` — `email`, `village`, `sub_cohort` come from the
profile mapped at approval.

**Agent directory** (the HO "Partners" page) is the same list:
`GET /admin/agents?stage=approved&sort=-decided_at` — every working agent, newest approval first
(`decided_at` = approval date). `stage=blocked` lists blocked ones; drop `stage` for everyone.

Detail:

```jsonc
{
  "agent": { "agent_id": "VST-000001", "pii_id": "PII-…", "phone": "…", "stage": "kyc_review",
             "stage_history": [{ "from": "onboarding", "to": "kyc_review", "by": "self", "at": "…" }],
             "owner_agent_id": "A0-2691", "is_approved": false, "profile": null, … },
  "owner": { "agent_id": "A0-2691", "name": "Manav Barodiya", "email": "…" },
  "onboarding": {
    "steps": [ … the form version this partner filled … ],   // render the values with it
    "raw_data": { … with signed file urls (1 h) … },
    "documents_review": { "pan": { "status": "pending|verified|rejected", "reason", "by", "at" } },
    "remarks": { … }, "missing_required": [], "completion_pct": 100,
    "updated_data": [ { "field", "old_value", "new_value", "by", "at" } ],   // HO edits
    "location": { "type": "Point", "coordinates": [lng, lat] }, …
  },
  "nearby": {
    "radius_km": 5, "center": { "lat": 23.25, "lng": 77.41 },
    "vistaar": [ { "agent_id", "name", "stage", "distance_km" } ],          // other partners / applicants
    "network": [ { "source": "franchise|prasar_retailer|old_vistaar_agent", "id", "name", "distance_km" } ],
    "has_conflicts": true          // show a warning beside Approve
  }
}
```

`?radius_km=` overrides the configured radius for one look.

## 3. Decisions

| Method | Path | Body | Rule |
|---|---|---|---|
| POST | `/admin/agents/:agentId/documents/:fieldKey/review` | `{ decision: verified\|rejected, reason? }` | only in `kyc_review`; reason required to reject. A field with `org_document` (`adhar`, `pan`, `bank_details`, `selfie`) is copied to the person's org record `piis.documents` on verify, `is_verified: false` on reject; another portal's entry there is never replaced |
| POST | `/admin/agents/:agentId/request-changes` | `{ remarks: { field_key: "note" } }` | rejected documents are added automatically; only these fields become editable for the partner |
| POST | `/admin/agents/:agentId/approve` | — | **every required document verified** (else `409 DOCUMENTS_NOT_VERIFIED`, `details` = keys). Maps the form onto the partner (`maps_to`) |
| POST | `/admin/agents/:agentId/reject` | `{ reason }` | from `kyc_review` or `changes_requested`; partner sees the reason |
| POST | `/admin/agents/:agentId/reopen` | `{ reason? }` | rejected → onboarding |
| POST | `/admin/agents/:agentId/block` | `{ reason }` | login refused, refresh refused |
| POST | `/admin/agents/:agentId/unblock` | `{ reason? }` | back to the previous stage |
| PATCH | `/admin/agents/:agentId/onboarding` | `{ data: { key: value } }` | correct values (same validation as the app); a changed document goes back to pending |
| PUT | `/admin/agents/:agentId/owner` | `{ owner_agent_id: "A0-…" }` | must be an active `agents_v2` account |

A decision on a partner whose stage moved meanwhile answers `409 STAGE_NOT_ALLOWED` — refresh the drawer.

## 4. Forms (Onboarding Flow Configuration)

One form **per cohort** (tabs). HO edits a draft; publishing makes it the next version.
Published versions never change: each partner keeps the version they submitted.

| Method | Path | |
|---|---|---|
| GET | `/admin/cohorts` | all partner types |
| POST | `/admin/cohorts` | `{ key, label{en,…}, description?, icon?, sub_types?, order?, is_active? }` |
| PATCH | `/admin/cohorts/:key` | rename, reorder, (de)activate |
| DELETE | `/admin/cohorts/:key` | only if unused (`409 COHORT_IN_USE` — deactivate instead) |
| GET | `/admin/onboarding-configs/meta` | field types and `maps_to` targets for the editor |
| GET | `/admin/onboarding-configs/:cohort/versions` | version list |
| GET | `/admin/onboarding-configs/:cohort/versions/:version` | one version |
| GET | `/admin/onboarding-configs/:cohort/draft` | `{ draft, errors }` or `null` |
| PUT | `/admin/onboarding-configs/:cohort/draft` | `{ steps: [...], notes? }` → `{ draft, errors }` (saved even with errors) |
| POST | `/admin/onboarding-configs/:cohort/draft/clone-from/:source` | start from another cohort's form |
| POST | `/admin/onboarding-configs/:cohort/publish` | `409`-free only when `errors` is empty (`400 CONFIG_INVALID`, `details` = sentences) |
| DELETE | `/admin/onboarding-configs/:cohort/draft` | discard the draft |

Field types and value shapes: ONBOARDING-APP.md §3. Publish rules: unique `step_id` and
`key` (lowercase, digits, `_`), English label on every step and field, options for selects,
valid regexes, `visible_if` pointing at a real field, and **no required `location` (GPS)
field** — GPS is optional for every partner; a form saved earlier with it required is served
and checked as optional.

`maps_to` (where an approved value lands on the partner): `name`, `email`, `sub_cohort`,
`address_line`, `village`, `district`, `state`, `pincode`, `location`, or `details.<anything>`.

`org_document` (document fields only, once per form): the `piis.documents` key a verified
document is copied to — ko-sales spellings, e.g. `adhar`, `pan`, `bank_details`, `selfie`.

## 5. Settings

`GET /admin/settings` · `PUT /admin/settings { default_owner_agent_id?, conflict_radius_km? }`
— the owner every new signup gets, and the nearby-check radius (0.5–50 km).

## 6. Errors (HO)

`NO_ADMIN_ACCESS`, `ROLE_NOT_ALLOWED` (403) · `STAGE_NOT_ALLOWED` (409) · `DOCUMENTS_NOT_VERIFIED` (409) ·
`NOT_A_DOCUMENT`, `DOCUMENT_MISSING`, `UNKNOWN_FIELD`, `VALIDATION_FAILED` (400) · `OWNER_NOT_FOUND` (400) ·
`CONFIG_INVALID`, `NO_DRAFT` (400) · `COHORT_EXISTS`, `COHORT_IN_USE` (409) · `NOT_FOUND` (404).
