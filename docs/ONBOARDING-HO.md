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
| `agents.edit` | correct a partner's form values (audited); approve / reject a name change |
| `kyc.review` | verify / reject a KYC document; log verification calls; approve / reject a bank account change |
| `agents.decide` | approve, reject, request changes, block, unblock, reopen |
| `agents.assign` | change a partner's owner |
| `config.read` / `config.write` / `config.publish` | cohorts and forms |
| `settings.write` | default owner, conflict radius, farmer-lead settings (LEADS-HO.md) |
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
`sort` = `-created_at` (default) | `created_at` | `-updated_at` | `updated_at` | `-decided_at` | `decided_at` | `-last_login_at` | `last_login_at` (who has gone quiet).

Row: `{ agent_id, pii_id, phone, name, cohort, sub_cohort, district, state, village, pincode,
email, stage, otp_verified, is_approved, completion_pct, submitted_at, decided_at, last_login_at,
owner: { agent_id, name } | null, created_at, updated_at }` — `email`, `village`, `sub_cohort` come from the
profile mapped at approval. `agent_id`, `pii_id` (null for unverified numbers), `name`, `cohort`,
`district`, `state` are nullable; `owner` is `null` when unassigned.

**Agent directory** (the HO "Partners" page) is the same list:
`GET /admin/agents?stage=approved&sort=-decided_at` — every working agent, newest approval first
(`decided_at` = approval date). `stage=blocked` lists blocked ones; drop `stage` for everyone.

Detail:

```jsonc
{
  "agent": { "agent_id": "VST-000001", "pii_id": "PII-…", "phone": "…", "stage": "kyc_review",
             "stage_history": [{ "from": "onboarding", "to": "kyc_review", "by": "self", "at": "…" }],
             "owner_agent_id": "A0-2691", "is_approved": false, "profile": null,
             "verification_calls": [{ "at": "…", "by": "ho@…", "outcome": "verified", "note": null }],  // always an array
             "pending_name": null,          // { value, requested_at } — waiting for HO (§3)
             "name_change": null, … },      // { value, approved, reason, by, at } — the last decision
  "owner": { "agent_id": "A0-2691", "name": "Manav Barodiya", "email": "…" },   // | null
  "onboarding": {                                                              // | null (form not started)
    "steps": [ … the form version this partner filled … ],   // render the values with it
    "raw_data": { … with signed file urls (1 h) … },
    "documents_review": { "pan": { "status": "pending|verified|rejected", "reason", "by", "at" } },
    "remarks": { … }, "missing_required": [], "completion_pct": 100,
    "updated_data": [ { "field", "old_value", "new_value", "by", "at" } ],   // HO edits
    "location": { "type": "Point", "coordinates": [lng, lat] },
    "duplicate_ids": [ { "kind": "aadhaar|pan", "agent_ids": ["VST-000012"] } ],  // [] when none
    …
  },
  "nearby": {
    "radius_km": 5, "center": { "lat": 23.25, "lng": 77.41 },             // | null (no location)
    "vistaar": [ { "agent_id", "name", "stage", "distance_km" } ],          // other partners / applicants
    "network": [ { "source": "franchise|prasar_retailer|old_vistaar_agent", "id", "name", "distance_km" } ],
    "has_conflicts": true          // show a warning beside Approve
  }
}
```

`?radius_km=` overrides the configured radius for one look. `center` is `null` when the partner
has no location — then `vistaar` and `network` are `[]` and `has_conflicts` is `false`.
`vistaar[].stage` is a pipeline stage, or `"applicant"` for someone whose form is not yet
approved (then `name` is `null`).

`onboarding.duplicate_ids` — other partners whose form holds the same Aadhaar or PAN (at most 50
partners read); show it as a warning beside Approve. The app refuses a clash on save and submit
(`409 ID_IN_USE`), so this catches rows saved before the check, or two saves at the same
moment. Also in the edit-values and review-document answers. The numbers are never listed.

`agent.profile.photo` (set by the partner's Edit Profile) is a storage path, not a link.

## 3. Decisions

| Method | Path | Body | Rule | Returns |
|---|---|---|---|---|
| POST | `/admin/agents/:agentId/documents/:fieldKey/review` | `{ decision: verified\|rejected, reason? }` | only in `kyc_review`; reason required to reject. A field with `org_document` (`adhar`, `pan`, `bank_details`, `selfie`) is copied to the person's org record `piis.documents` on verify, `is_verified: false` on reject; another portal's entry there is never replaced | the updated `onboarding` (shape of `detail.onboarding`) |
| POST | `/admin/agents/:agentId/request-changes` | `{ remarks: { field_key: "note" } }` | only in `kyc_review`. Every note non-empty and every key a field on the form (`400 UNKNOWN_FIELD`); needs at least one note or one rejected document (`400 VALIDATION_FAILED`). Rejected documents are added automatically; only these fields become editable for the partner | the updated partner (shape of `detail.agent`) |
| POST | `/admin/agents/:agentId/approve` | — | **every required document verified** (else `409 DOCUMENTS_NOT_VERIFIED`, `details` = keys). Maps the form onto the partner (`maps_to`) | the updated partner (shape of `detail.agent`) |
| POST | `/admin/agents/:agentId/reject` | `{ reason }` | from `kyc_review` or `changes_requested`; partner sees the reason | the updated partner (shape of `detail.agent`) |
| POST | `/admin/agents/:agentId/reopen` | `{ reason? }` | rejected → onboarding | the updated partner (shape of `detail.agent`) |
| POST | `/admin/agents/:agentId/block` | `{ reason }` | login refused, refresh refused | the updated partner (shape of `detail.agent`) |
| POST | `/admin/agents/:agentId/unblock` | `{ reason? }` | back to the previous stage | the updated partner (shape of `detail.agent`) |
| PATCH | `/admin/agents/:agentId/onboarding` | `{ data: { key: value } }` | only in `onboarding`, `kyc_review` or `changes_requested` (`409 STAGE_NOT_ALLOWED` otherwise). Corrects values (same validation as the app); `null` clears a value; a changed document goes back to pending. Unknown key → `400 UNKNOWN_FIELD`, `details` = the keys; bad value → `400 VALIDATION_FAILED`, `details` = sentences; an Aadhaar / PAN another partner holds → `409 ID_IN_USE`, `details` = the field keys | the updated `onboarding` (shape of `detail.onboarding`) |
| PUT | `/admin/agents/:agentId/owner` | `{ owner_agent_id: "A0-…" }` | must be an active `agents_v2` account | the updated partner (shape of `detail.agent`) |
| POST | `/admin/agents/:agentId/verification-call` | `{ outcome: reached\|not_reached\|verified, note? }` (note ≤ 300) | `kyc.review`. Any stage before a decision (`signed_up`, `onboarding`, `kyc_review`, `changes_requested`); `409 STAGE_NOT_ALLOWED` once approved, rejected or blocked. Not a stage: the pipeline does not move. The first `verified` call is the app's "Verification call" step | `{ agent_id, verification_calls }` |
| POST | `/admin/agents/:agentId/name-change/approve` | — | `agents.edit`. The partner's `pending_name` becomes `profile.name` (and the list's name); `name_change` records it | the updated partner, without `stage_history` |
| POST | `/admin/agents/:agentId/name-change/reject` | `{ reason }` (1–300, the partner sees it) | `agents.edit`. `pending_name` cleared; `profile.name` unchanged | the updated partner, without `stage_history` |

A decision on a partner whose stage moved meanwhile answers `409 STAGE_NOT_ALLOWED` — refresh the drawer.
Every POST here answers `200`, not `201`.

A name decision applies only to the name HO saw: if the partner sent another one meanwhile,
or none is waiting, it answers `409 NAME_CHANGE_NOT_PENDING` — refresh. A partner with a
name waiting shows it in `agent.pending_name`; there is no list of them.

Calls and name changes write `vistaar_v2_agents` only.

### Bank account change (approved partners)

The partner asks in the app (ONBOARDING-APP.md §6); payouts keep going to the old, verified
account until HO approves. `kyc.review` on all three. No list of waiting changes: open the
partner.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/admin/agents/:agentId/bank-change` | — | the waiting or last change, or `null` |
| POST | `/admin/agents/:agentId/bank-change/approve` | — | the change, `status: "approved"` |
| POST | `/admin/agents/:agentId/bank-change/reject` | `{ reason }` (required, ≤ 300; the partner sees it) | the change, `status: "rejected"` |

```jsonc
{ "agent_id": "VST-000001", "status": "pending",      // pending · approved · rejected · withdrawn
  "account_holder": "Suresh Kumar", "account_number": "000123454321", "ifsc": "SBIN0001234",
  "proof_path": "KO-documents/PII-9/…", "proof_url": "https://signed…",   // 1 h
  "requested_at": "…", "decided_at": null,
  "decided_by": null,                                  // HO email, or "self" when the partner withdrew
  "reason": null,
  "current_account": { "account_holder", "account_number", "ifsc" } }   // paid into now | null
```

**Approve** puts the new holder, number and IFSC into the form's payout account (a UPI ID
there is kept) and the proof into the bank-proof field, marked verified by you now — the
same entry the KYC review writes. Both changes go into `updated_data` (old and new value).
It writes `vistaar_v2_onboarding_data` and, like a KYC verify, copies the proof to the
person's org record `piis.documents.bank_details` (`source: 'vistaar'`; another portal's
entry there is never replaced). The old proof file stays in storage. The partner profile's
copy `profile.details.bank_account` is **not** updated — payouts and the bank file read the
form, not that copy.

**Reject** keeps the old account, still verified; writes `vistaar_v2_onboarding_data` only.

Approve and reject act only on the change that is waiting; one decided or withdrawn meanwhile
→ `409 BANK_CHANGE_NOT_PENDING`. A form with no payout account field → `409 CONFIG_INVALID`.
While a change waits the partner cannot ask for a new withdrawal; withdrawals already
requested or approved are not touched (COMMISSION-HO.md §2).

### Duplicate Aadhaar / PAN — one-off backfill

Each form row keeps `id_keys` (Aadhaar as a SHA-256 hash, PAN upper case) for the check.
Rows saved before it have none and are invisible to it until this runs once per environment, after deploy:

`node dist/scripts/backfill-id-keys.js` (dry run) → then `--apply`. Fills `id_keys` on
`vistaar_v2_onboarding_data` only; skips a row saved meanwhile; prints each Aadhaar / PAN held
by more than one partner as agent ids, never the number. Safe to run again.

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

**State and district come from the pincode** when the form maps a `pincode` the org's
pincode list knows (`pincode_map_v2`): typed "MADHYA" / "madh" become `MADHYA PRADESH` /
`DEWAS` on the partner (the desk's `preview` on every save, `profile` at approval). The
state filter and "by state" counts therefore use the standard names. An unknown pincode
keeps what was typed.

`org_document` (document fields only, once per form): the `piis.documents` key a verified
document is copied to — ko-sales spellings, e.g. `adhar`, `pan`, `bank_details`, `selfie`.

## 5. Settings

`GET /admin/settings` · `PUT /admin/settings { default_owner_agent_id?, lead_owner_agent_id?, farmer_consent_text?, lead_release_days?, customer_release_days?, conflict_radius_km? }` — an owner sent as `""` or `null` is cleared
— the owner every new signup gets, an override owner for the farmer leads partners add
(LEADS-HO.md; unset = the Offline Head, USR-1037), and the nearby-check radius (0.5–50 km).
Both owners must be active `agents_v2` accounts (`400 OWNER_NOT_FOUND`).
`farmer_consent_text: { en, hi? }` — the consent partners tick per farmer; a change bumps
`farmer_consent.version` (LEADS-HO.md).

## 6. Errors (HO)

`NO_ADMIN_ACCESS`, `ROLE_NOT_ALLOWED` (403) · `STAGE_NOT_ALLOWED` (409) · `DOCUMENTS_NOT_VERIFIED` (409) ·
`NOT_A_DOCUMENT`, `DOCUMENT_MISSING`, `UNKNOWN_FIELD`, `VALIDATION_FAILED` (400) · `OWNER_NOT_FOUND` (400) ·
`CONFIG_INVALID`, `NO_DRAFT` (400) · `COHORT_EXISTS`, `COHORT_IN_USE` (409) · `NOT_FOUND` (404), and:

| Code | When |
|---|---|
| `NO_ADMIN_ACCESS` 403 | no active Vistaar HO role (head / admin), or no `agents_v2` account |
| `ROLE_NOT_ALLOWED` 403 | the person lacks this route's capability (by role, or withheld by email in `access.domain.ts`) |
| `COHORT_REQUIRED` 400 | the partner has not started the form, so review, edit, request-changes and approve cannot run |
| `COHORT_NOT_FOUND` 400 | unknown cohort key on DELETE cohort, PUT draft or clone-from |
| `VERSION_CONFLICT` 409 | a concurrent save won — retry |
| `ID_IN_USE` 409 | edit values: the Aadhaar / PAN is on another partner's form; `details` = field keys |
| `NAME_CHANGE_NOT_PENDING` 409 | no name waiting, or the partner sent a newer one — refresh |
| `BANK_CHANGE_NOT_PENDING` 409 | no bank change waiting (decided or withdrawn) — refresh |
| `UNAUTHORIZED` 401 | missing, expired or partner token |
| `SERVICE_UNAVAILABLE` 503 | SSO unreachable |
