# Onboarding — dynamic form (Vistaar app)

**Base URL:** `{API_BASE}/api/v2` · bearer = partner `access_token` (AUTH-APP.md), except the
three **public** reads (partner types, form, pincode) used by the Join wizard before login.

The form is **not hard-coded in the app**. HO designs it per partner type (cohort) in the
HO portal; the app downloads it and renders steps and fields from it. Everything the
partner types is saved with `PATCH /onboarding` after every step (any number of calls);
`POST /onboarding/submit` sends it for KYC review.

## 1. Flow — Join Vistaar as in the PRD and the app design

The signup wizard is filled **before** the OTP and verified **last** (PRD A2):
Who you are → Mobile → Personal → Location → Details → Review → OTP → KYC checklist → submit.

```
BEFORE LOGIN (public — no token)
  GET /onboarding/cohorts               → "Who you are": partner-type picker (+ sub_types for Other)
  GET /onboarding/config?cohort=<key>   → the form for that type; render its steps
                                          (cache it; send If-None-Match → 304)
  GET /onboarding/pincode/:pincode      → prefill state / district on the Location step
  … the app keeps every answer locally until the OTP is verified …

OTP (AUTH-APP.md §1, intent: "signup")
  POST /auth/otp/send   { phone, intent: "signup" }
  POST /auth/otp/verify { phone, otp, intent: "signup" }   → session

RIGHT AFTER VERIFY — one call saves the whole wizard
  PATCH /onboarding { cohort, step_id: "<last step shown>", data: { …every answer… } }
                                          (up to 100 fields per call; files are not in the wizard)

KYC CHECKLIST (logged in)
  POST /uploads?purpose=<field_key>     → for each document / photo (multipart `file`)
  PATCH /onboarding { step_id, data }   → save each checklist item as it is done
  POST /onboarding/submit               → stage kyc_review, form locked
  GET /me                               → status tracker
```

- Which fields belong to the wizard and which to the KYC checklist is the form's own steps:
  the steps without `document` / `file` fields are the wizard, the rest is the checklist
  (in the default forms: personal, location, details → wizard; kyc, agreement → checklist).
- A partner who closes the app mid-way logs in later (`intent: "login"`): `GET /me` says
  `complete_onboarding` and `GET /onboarding` returns everything already saved — resume there.
- OTP-first (verify, then fill each step with `PATCH /onboarding`) works too; same calls.
- A partner who has not been approved never lands on home.

## 2. Routes

| Method | Path | Auth | Answer |
|---|---|---|---|
| GET | `/onboarding/cohorts` | **public** | `[{ _id, label{en,hi…}, description, icon, sub_types, order }]` |
| GET | `/onboarding/config?cohort=` | **public** | `{ _id: "vistaar_agent@2", cohort, version, steps: [...] }` — active steps, in order |
| GET | `/onboarding/pincode/:pincode` | **public** | `{ pincode, state, district, taluk }` or `null` — prefill the location step |
| GET | `/onboarding` | bearer | my form (below), or `null` before the first save |
| PATCH | `/onboarding` | bearer | `{ cohort?, step_id?, data: { key: value } }` → my form |
| POST | `/onboarding/submit` | bearer | my form, `stage: kyc_review` |
| POST | `/uploads?purpose=<field_key>` | bearer | multipart `file` (≤ 10 MB; JPG/PNG/WEBP/HEIC/PDF) → `{ path, url, content_type, size }` |

Public routes allow 60 calls a minute per network (429 beyond).

## 3. The config

```jsonc
{ "step_id": "kyc", "order": 4, "title": { "en": "KYC documents", "hi": "केवाईसी दस्तावेज़" },
  "description": { "en": "…" }, "icon": "shield-check", "is_active": true,
  "fields": [
    { "key": "pan", "type": "document", "label": { "en": "PAN card" }, "required": true,
      "help": { "en": "Needed for TDS on commission." },
      "validation": { "max_items": 1, "number_required": true, "regex": "^[A-Z]{5}[0-9]{4}[A-Z]$" } }
  ] }
```

Field keys: `key`, `type`, `label`, `placeholder?`, `help?`, `required`, `options?` (select),
`validation?`, `visible_if?`, `fields?` (groups). Labels are `{ en, hi, mr, gu, … }` — show the
user's language, fall back to `en`.

`visible_if: { field, op: eq|ne|in|filled, value }` — hide the field unless the rule holds
against the values entered so far. A hidden required field is not required.

### Field types → value to send

| `type` | Send in `data` | Notes |
|---|---|---|
| `text`, `textarea` | `"string"` | trimmed; `validation.min_length/max_length/regex` |
| `number` | `12` | `validation.min/max` |
| `boolean` | `true` / `false` | `validation.must_accept: true` → only `true` is accepted (agreements) |
| `date` | `"2026-10-09"` | |
| `phone` | `"9876543210"` | |
| `email` | `"a@b.com"` | |
| `pincode` | `"462026"` | |
| `select` | `"option_value"` | one of `options[].value` |
| `multi_select` | `["a","b"]` | |
| `file` | `{ "path": "<from /uploads>" }` | |
| `document` | `{ "files": ["<path>", …], "number": "ABCDE1234F" }` | KYC document HO verifies; `max_items` files; `number_required` |
| `location` | `{ "lat": 23.25, "lng": 77.41, "accuracy": 12, "captured_at": "ISO" }` | **device GPS**, India only — always optional (served as `required: false` on every form); without it the nearby-network check is skipped |
| `location` | `{ "lat": 23.25, "lng": 77.41, "accuracy": 12, "captured_at": "ISO" }` | **device GPS**, India only — optional; without it the nearby-network check is skipped |
| `object` | `{ "sub_key": value, … }` | sub-fields in `fields` |
| `object_list` | `[{ … }, { … }]` | repeatable group, `max_items` rows |

`null` for a key clears it. Only the keys you send change — other steps are never overwritten.
Files must be uploaded by this partner (`/uploads` → `KO-documents/<your pii_id>/…`); anyone else's path is refused.

## 4. My form (`GET /onboarding`, and every PATCH/submit answer)

```jsonc
{
  "onboarding_id": "ffb3…", "cohort": "vistaar_agent", "config_id": "vistaar_agent@1", "config_version": 1,
  "stage": "onboarding",
  "editable_fields": null,            // null = all; [] = locked; ["pan"] = only these (changes requested)
  "raw_data": { "full_name": "…", "pan": { "files": ["…"], "number": "…", "urls": ["https://signed…"] } },
  "current_step": "kyc", "completed_steps": ["personal", "location"], "completion_pct": 72,
  "missing_required": ["selfie", "partner_agreement"],
  "documents_review": { "pan": { "status": "rejected", "reason": "Photo is blurred", "by": "…", "at": "…" } },
  "remarks": { "pan": "Photo is blurred" },        // HO's notes when changes are requested
  "submitted_at": null, "submit_count": 0, "updated_at": "…"
}
```

File values come back with signed `url` / `urls` (valid 1 hour) for previews.

Before the first submit the form follows the latest published version (values for removed
fields are dropped) and the partner may switch cohort by sending a different `cohort`.
After submitting, both are fixed.

### Aadhaar / PAN used by another partner

A save that sets the Aadhaar or PAN field, and the submit, are refused with
`409 ID_IN_USE` when another Vistaar partner's form already holds the same number:
"This Aadhaar (PAN / Aadhaar and PAN) is already used by another Vistaar account. Contact
Katyayani support." `details` = the clashing field keys, e.g. `["aadhaar"]` — mark those
fields. The number itself is never in the answer. Aadhaar is compared on its 12 digits
(spaces and `-` ignored), PAN in upper case. Your own number saved again is fine.

## 5. Errors

| Code | HTTP | Meaning |
|---|---|---|
| `ID_IN_USE` | 409 | Aadhaar / PAN already on another partner's form; `details` = field keys (§4) |
| `COHORT_REQUIRED` | 400 | first save without `cohort` |
| `COHORT_NOT_FOUND` | 400 | unknown or inactive partner type |
| `CONFIG_NOT_PUBLISHED` | 409 | that type has no published form yet |
| `UNKNOWN_FIELD` | 400 | `details` = keys not on the form |
| `VALIDATION_FAILED` | 400 | `details` = one sentence per bad value — show `details[0]` |
| `FIELD_NOT_EDITABLE` | 409 | changes requested: only `editable_fields` may change |
| `ONBOARDING_LOCKED` | 409 | already submitted / approved |
| `REQUIRED_FIELDS_MISSING` | 400 | submit with empty required fields; `details` = keys |
| `VERSION_CONFLICT` | 409 | two saves collided — retry |
| `UPLOADS_NOT_CONFIGURED` | 503 | file storage not set up on this server |
| `FILE_REQUIRED`, `FILE_TYPE_NOT_ALLOWED`, `FILE_TOO_LARGE` | 400 / 413 | upload problems |
| `ACCOUNT_BLOCKED` | 403 | |
| `PARTNER_NOT_APPROVED` | 403 | `PATCH /me` or a bank change before approval (§6) |
| `IMAGE_NOT_FOUND` | 400 | `PATCH /me`: the photo path is not an upload in your own folder |
| `BANK_CHANGE_PENDING` | 409 | a bank change is already waiting for HO; also refuses a new withdrawal (COMMISSION-APP.md) |
| `BANK_CHANGE_NOT_PENDING` | 409 | withdraw a bank change that is no longer waiting — reload |
| `CONFIG_INVALID` | 409 | bank change: your form has no payout account field — contact support |

## 6. After approval — edit profile, change bank account

`PATCH /me` and `POST /me/bank-change` are for approved partners only: a blocked or
switched-off account gets `403 ACCOUNT_BLOCKED`, any other stage `403 PARTNER_NOT_APPROVED`.

### `PATCH /me` — Edit Profile

```jsonc
{ "name": "Ramesh Patel",          // 3–100 — waits for HO (pending_name), not applied now
  "email": "ramesh@example.com",
  "language_pref": "hi",           // ^[a-z]{2,3}$
  "village": "Rampur", "district": "Sehore", "state": "MADHYA PRADESH",   // 1–100 each
  "pincode": "466001",             // 6 digits
  "photo": "KO-documents/PII-1203/profile_photo/…jpg" }   // ≤ 300, path from POST /uploads
```

Every key is optional; only the keys sent change. Do not send `null`. Answers the full
`GET /me` (AUTH-APP.md).

- **Name:** goes to `pending_name` until HO approves it; `profile.name` stays as it is. A
  name equal to the current one is ignored; a new one replaces one still waiting. HO's
  decision shows in `name_change` (a refusal carries `reason`).
- **Pincode:** a pincode the org's list knows sets `state` and `district` (over the typed
  ones); an unknown pincode keeps what was typed.
- **Photo:** upload first with `POST /uploads?purpose=profile_photo`, then send its `path`.
  It must be your own upload (`KO-documents/<your pii_id>/`) — else `400 IMAGE_NOT_FOUND` —
  and an image, not a PDF (`400 FILE_TYPE_NOT_ALLOWED`). Show it from `photo_url`.
- `language_pref` is saved as `profile.details.language_pref`, where the form puts it.

Writes `vistaar_v2_agents` only (`profile`, the HO list's `preview` copy of
place, `pending_name`). The org's person record (`piis`) is never changed.

A new district / state / pincode works the partner's earning cohort out again before
the answer (EARNINGS-HO.md), so `earning_cohort` in it is the one for the new place — re-read
"How to earn" from it. A village alone does not move the cohort (no cohort tests it).

### Bank account change

Payouts keep going to the verified account until HO approves the new one. While a change
is waiting, no new withdrawal is accepted (`GET /wallet` → `blocked_reason:
"bank_change_pending"`).

| Method | Path | Body | Answer |
|---|---|---|---|
| GET | `/me/bank-change` | — | the waiting or last request, or `null` |
| POST | `/me/bank-change` | `{ account_holder, account_number, ifsc, proof_path }` | the request, `status: "pending"` |
| DELETE | `/me/bank-change` | — | the request, `status: "withdrawn"` |

```jsonc
{ "status": "pending",            // pending · approved · rejected · withdrawn
  "account_holder": "Suresh Kumar", "account_last4": "4321", "ifsc": "SBIN0001234",
  "requested_at": "…", "decided_at": null,
  "reason": null }                // HO's reason when rejected
```

- `account_holder` ≤ 100; `account_number` 9–18 digits; `ifsc` like `SBIN0001234` (any case,
  saved upper case); `proof_path` = a cancelled cheque or passbook photo from
  `POST /uploads?purpose=<the bank-proof field's key>`, in your own folder. The form's own
  rules for the bank fields apply too (`400 VALIDATION_FAILED`, `details[0]` says what).
- The same account number and IFSC as today → `400 VALIDATION_FAILED`.
- One waiting at a time (`409 BANK_CHANGE_PENDING`); withdraw it first to send another.
  Only the latest request is kept.
- On approval the new account replaces the old one on the form (a UPI ID there is kept).
  Read the current account from `GET /wallet` `bank`, not from
  `profile.details.bank_account` — that copy is taken once at approval and is not updated.

Writes `vistaar_v2_onboarding_data.bank_change` only. HO's approval is in ONBOARDING-HO.md §3.
