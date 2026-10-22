# Login — phone + OTP (Vistaar app)

**Base URL:** `{API_BASE}/api/v2` · every response is `{ "success": true, "data": … }` or
`{ "success": false, "error": { "code", "message", "details" } }`.

Partners are not company staff: they sign in with a mobile number and an OTP, and this
API issues their session itself. The HO portal keeps using the company SSO login.

## 1. The flow — two doors, as in the PRD

```
LOGIN (existing partner)
  Phone ──POST /auth/otp/send { phone }──────────────▶ 404 ACCOUNT_NOT_FOUND → show
                                                        "No account with this number" + "Join Vistaar"
                                                       200 → SMS sent
  OTP   ──POST /auth/otp/verify { phone, otp }────────▶ session
  App   ──GET /me──────────────────────────────────────▶ open the screen `next_action` names

JOIN VISTAAR (new partner) — PRD A2: choose cohort → phone → OTP → form
  Phone ──POST /auth/otp/send { phone, intent: "signup" }─▶ 409 ACCOUNT_EXISTS → "Log in instead"
                                                            200 → partner record created, SMS sent
  OTP   ──POST /auth/otp/verify { phone, otp, intent: "signup" }─▶ VST-… given, person linked → session
  Form  ──PATCH /onboarding { cohort, step_id, data }──▶ the cohort picked before the phone screen
                                                        starts the application (ONBOARDING-APP.md)
```

- `intent` is `"login"` when left out. Send the **same intent** on send, resend and verify.
- The OTP is **4 digits** (show four boxes, not six).
- Join Vistaar collects the wizard answers **before** this OTP and saves them right after
  verify (ONBOARDING-APP.md §1). No referral code for now — hide that field.
- Login refuses a number that never finished signup (asked for an OTP, never verified) — it is
  not an account yet; the partner uses Join Vistaar.
- After **every** verify and on every app start, call `GET /me` and route by `next_action` (§2).
  A logged-in partner is not necessarily approved: only `next_action: "approved"` opens home, and
  ordering waits for `ordering_unlocked: true`. A partner who joined but did not finish the form
  gets `choose_cohort` / `complete_onboarding` and resumes onboarding.

India (+91) numbers only for now.

## 2. Routes

| Method | Path | Auth | Body | Answer |
|---|---|---|---|---|
| POST | `/auth/otp/send` | public | `{ phone, country_code?, intent? }` | `{ sent: true, resend_after_seconds: 30 }` |
| POST | `/auth/otp/resend` | public | `{ phone, country_code?, intent? }` | same |
| POST | `/auth/otp/verify` | public | `{ phone, country_code?, otp, intent? }` | session (below) |
| POST | `/auth/refresh` | public | `{ refresh_token }` | a new session — **store the new refresh token** |
| POST | `/auth/logout` | bearer | `{ refresh_token }` | `{ signed_out: true }` — this device only |
| GET | `/me` | bearer | — | status (below) |
| PATCH | `/me` | bearer | profile edit (ONBOARDING-APP.md §6) | status (below) |
| POST | `/auth/customer-session` | bearer | `{ device_id?, device_name? }` | the partner's ko-sales customer pass (CUSTOMER-SESSION-APP.md) |

`phone` is 10 digits (`+91 98765 43210`, `09876543210` are accepted and cleaned).
`country_code` defaults to `+91`.

### Session

```jsonc
{
  "access_token": "eyJ…",          // Authorization: Bearer <access_token> on every call
  "refresh_token": "Qm9…",         // single use; rotated by /auth/refresh
  "token_type": "Bearer",
  "expires_in": 43200,             // seconds (12 h)
  "agent": { "agent_id": "VST-000001", "pii_id": "PII-1617919", "stage": "signed_up",
             "is_approved": false, "onboarding_id": null }
}
```

Refresh tokens live 30 days. Several devices may be signed in at once.
On `401` from any route: call `/auth/refresh` once; if that also fails, show the login screen.

### `GET /me` — the status / pending screen

```jsonc
{
  "agent_id": "VST-000001", "pii_id": "PII-1617919", "phone": "9691829003", "country_code": "+91",
  "stage": "kyc_review",
  "next_action": "wait_for_review",
  "is_approved": false,
  "ordering_unlocked": false,
  "rejection_reason": null,
  "onboarding": { "onboarding_id": "ffb3…", "cohort": "vistaar_agent", "completion_pct": 100,
                  "submitted_at": "2026-10-09T07:20:47.059Z", "fields_to_fix": 0 },
  "profile": null,                  // filled when approved; also profile.photo (storage path),
                                    // profile.details.language_pref
  "earning_cohort": null,           // when approved: the earning cohort and its coin / gig rules (EARNINGS-APP.md)
  "photo_url": null,                // signed link to profile.photo (1 h), or null
  "pending_name": null,             // { value, requested_at } — a new name waiting for HO
  "name_change": null,              // { value, approved, reason, at } — HO's last decision on one
  "reporting_officer": { "agent_id": "A0-2691", "name": "Manav Barodiya",
                         "phone": "9876543210", "role": "Offline Head" },   // | null
  "timeline": [
    { "step": "applied",           "at": "2026-10-09T07:20:47.059Z", "done": true },
    { "step": "verification_call", "at": null, "done": false },
    { "step": "documents_review",  "at": null, "done": false },
    { "step": "approved",          "at": null, "done": false },
    { "step": "active",            "at": null, "done": false }
  ],
  "member_since": "2026-10-09T07:20:45.600Z"
}
```

**`reporting_officer`** — the partner's HO owner, for the Profile and Help cards: name and
phone from the company staff list (`agents_v2`), `role` = `Offline Head` · `Super Admin` ·
`Admin`, or `null` for any other role. `phone` may be `null`. The whole object is `null` when
the partner has no owner or the owner's account is not found.

**`timeline`** — the application tracker, always these five steps in this order:

| Step | Reached when |
|---|---|
| `applied` | the form was first submitted |
| `verification_call` | HO logged the first call with outcome `verified` |
| `documents_review` | both of the above happened; `at` = the later one |
| `approved` | the partner was first approved |
| `active` | approved, while the stage is still `approved` and the account is not switched off (`at` = the approval). Will also need Product Knowledge L1 once that exists |

`done` = reached. When a later step is done, every earlier one is `done: true` too, with
`at: null` if nothing recorded it (partners approved before calls were logged) — so the
tracker never has gaps. A blocked partner keeps `approved` done; `active` turns off.

**`pending_name` / `name_change`** — a name sent with `PATCH /me` waits for HO; `profile.name`
stays the old one until HO approves. A refused one shows HO's `reason`.

Route on `next_action` — never on the login answer alone (`agent.stage` in the verify answer is
the same value, usable for the first screen right after login):

| `next_action` | Show |
|---|---|
| `choose_cohort` | partner-type picker → onboarding |
| `complete_onboarding` | resume the form at `onboarding.current_step` (see ONBOARDING-APP) |
| `fix_requested_changes` | the form, only the flagged fields editable, with HO's notes |
| `wait_for_review` | status tracker: application with Katyayani |
| `approved` | home — ordering unlocked |
| `rejected` | rejection reason + contact support |
| `blocked` | blocked screen (login is refused too) |

## 3. Errors

| Code | HTTP | Meaning / what to show |
|---|---|---|
| `INVALID_PHONE` | 400 | not a 10-digit Indian mobile |
| `OTP_NOT_REQUESTED` | 400 | verify before send — go back to the phone screen |
| `ACCOUNT_NOT_FOUND` | 404 | login with a number that has no account — show "No account with this number" and the **Join Vistaar** button |
| `ACCOUNT_EXISTS` | 409 | Join Vistaar with a registered number — show "Already registered" and switch to **Log in** |
| `OTP_INVALID` | 401 | wrong or expired OTP (message says which) |
| `OTP_LIMIT` | 429 | too many SMS (3 per 10 min) or tries (5 per 10 min); `details[0]` = `retry_after_seconds=N` |
| `OTP_UNAVAILABLE` | 503 | SMS service down — retry later |
| `IDENTITY_UNAVAILABLE` | 503 | could not create the account — retry |
| `ACCOUNT_BLOCKED` | 403 | blocked by Katyayani |
| `SESSION_INVALID` | 401 | refresh token spent/expired — log in again |
| `CUSTOMER_SESSION_*` | 503 / 429 / 409 | `/auth/customer-session` only — CUSTOMER-SESSION-APP.md §3 |
| `VALIDATION_FAILED` | 400 | body shape; `details` lists the fields |

## 4. Testing without an SMS

On non-production servers, numbers listed in `OTP_TEST_NUMBERS` skip the SMS and accept
`OTP_TEST_CODE`. Ask the backend dev for the current pair. Production refuses to boot with any.
