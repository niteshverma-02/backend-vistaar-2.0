# Payment options — HO portal

HO decides which online payment apps partners see on Pay online, their names,
which cohorts see them and in what order. Every change is logged.

SSO token. Read routes need `payments.read`, write routes `payments.write`
(today: the head roles).

## Security rules

- **Three providers, fixed in code:** `razorpay`, `cashfree`, `phonepe`. HO can
  switch them on/off but never add one — a gateway needs code before it can take money.
- **An option can be switched on only with approved keys** (`configured: true`);
  without them it is `400 CREDENTIALS_MISSING`, and the app never shows it.
- **Keys are entered by company admins only** (see *Merchant keys* below), never
  by the Offline Head; gateway URLs are fixed in code, never entered.
- **Server kill switch** `PAYMENTS_ONLINE_ENABLED`: off, the app shows no online
  option whatever is switched on here. `online_enabled` in the list tells the portal.
- **Optimistic lock:** every PATCH carries the `version` read; a stale one is
  `409 VERSION_CONFLICT` — reload and redo.
- **Audit log:** every change, insert-only, never deleted.
- Label and hint are plain text: no links, no `<` `>`.

## `GET /api/v2/admin/payment-options`

```json
{ "online_enabled": false,
  "items": [
    { "id": "razorpay", "provider": "razorpay", "label": "Razorpay", "hint": "UPI, cards, net banking",
      "is_active": true, "order": 0, "cohorts": [], "version": 3,
      "updated_by": "ho@katyayaniorganics.com", "updated_at": "2026-10-14T09:12:00.000Z",
      "configured": true, "mode": "test" },
    { "id": "cashfree", "provider": "cashfree", "label": "Cashfree", "hint": "UPI, cards, net banking",
      "is_active": false, "order": 1, "cohorts": [], "version": 0, "updated_by": null, "updated_at": null,
      "configured": false, "mode": null }
  ] }
```

All three always come back, in display order. `version: 0` = never saved (off).

## `PATCH /api/v2/admin/payment-options/:id`

`:id` = `razorpay` | `cashfree` | `phonepe`. Send `version` plus at least one field:

```json
{ "version": 3, "is_active": false, "label": "Razorpay", "hint": "UPI, cards, net banking", "cohorts": ["vistaar_agent"] }
```

| Field | Rule |
|---|---|
| `version` | required, the one read (0 for never saved) |
| `is_active` | boolean |
| `label` | 1–40 chars, plain text |
| `hint` | ≤ 80 chars, plain text, or `null` |
| `cohorts` | cohort keys (inactive allowed); `[]` = every partner |

Returns the option with its new `version`. Errors: `400 VALIDATION_FAILED`,
`400 COHORT_NOT_FOUND`, `400 CREDENTIALS_MISSING` (switching on without keys),
`409 VERSION_CONFLICT`.

## `PUT /api/v2/admin/payment-options/order`

```json
{ "ids": ["phonepe", "razorpay", "cashfree"] }
```

Every id exactly once, first shown first. Returns `{ ids }`.

## `GET /api/v2/admin/payment-options/audit?page=1&limit=50&option_id=razorpay`

`option_id` optional. `PageResult` of
`{ _id, option_id ("*" for a reorder), action, before, after, by, at }`, newest
first. `action`: `update`, `reorder`, `credentials_submitted`, `credentials_tested`,
`credentials_approved`, `credentials_rejected`, `credentials_revoked`. `before` /
`after` hold only the fields that changed; for keys, ids and masked values only.

---

## Merchant keys

Capability `payments.credentials` — company admins only (`USR-1000` Super Admin,
`USR-1001` Admin). The Offline Head does not get it, and it is withheld by name
from `robinsingh@` (user's decision, 2026-10-14 — `WITHHELD` in
`access.domain.ts`; `/admin/me` leaves it out of his `capabilities`). Every response is
`Cache-Control: no-store`, and **no response ever holds a secret** — only
`masked` (`••••abcd`).

### The flow

1. **Submit** — admin A enters the keys. They are encrypted at once
   (AES-256-GCM, key only in the server env, bound to the row and field) and
   wait as `pending` for 24 hours. One waiting set per provider.
2. **Gateway check** — the server calls the gateway with the keys (no money
   moves): Razorpay lists payments, Cashfree reads a made-up order, PhonePe mints
   a token. Approval needs a pass. The webhook secret cannot be checked this way.
3. **Approve** — admin **B, not A** (`403 APPROVER_IS_SUBMITTER`). The keys go
   live; the previous live keys are **wiped**, not kept.

Production accepts only `live` keys; every other server only `test` keys.
Every step is in the audit log and sent to Slack (`PAYMENTS_ALERT_WEBHOOK_URL`).

### Routes

| Method | Route | Body | Returns |
|---|---|---|---|
| GET | `/admin/payment-credentials` | — | `{ storage_ready, required_mode, providers: [{ provider, fields[], active, pending }] }` |
| GET | `/admin/payment-credentials/:provider/history` | `?page&limit` | `PageResult<CredentialView>` |
| POST | `/admin/payment-credentials/:provider` | `{ mode, fields, note? }` | `CredentialView` (pending) |
| POST | `/admin/payment-credentials/requests/:id/test` | — | `CredentialView` with `test` |
| POST | `/admin/payment-credentials/requests/:id/approve` | — | `CredentialView` (active) |
| POST | `/admin/payment-credentials/requests/:id/reject` | `{ reason }` | `CredentialView` (rejected, wiped) |
| POST | `/admin/payment-credentials/:provider/revoke` | `{ reason }` | `{ revoked: true }` — emergency stop |

`fields` per provider (exactly these, no others):

| Provider | Ids (shown) | Secrets (masked) |
|---|---|---|
| razorpay | `key_id` (`rzp_test_…` / `rzp_live_…`, must match `mode`) | `key_secret`, `webhook_secret` |
| cashfree | `app_id` | `secret_key` |
| phonepe | `client_id`, `client_version` | `client_secret` |

`CredentialView`: `{ id, provider, mode, status, public_fields, masked, note,
submitted_by, submitted_at, expires_at, test: {ok, message, by, at} | null,
decided_by, decided_at, reason, activated_at, retired_at, retired_by }`.
`status`: `pending` → `approved` (a moment) → `active` → `superseded` / `revoked`;
or `rejected` / `expired`.

Errors: `400 VALIDATION_FAILED` (`details[]` lists each bad field), `403
APPROVER_IS_SUBMITTER`, `409 CREDENTIALS_PENDING` / `CREDENTIALS_NOT_PENDING` /
`CREDENTIALS_EXPIRED` / `CREDENTIALS_NOT_TESTED`, `503
CREDENTIALS_NOT_CONFIGURED` (no `PAYMENTS_CREDENTIALS_KEY`) /
`CREDENTIALS_UNREADABLE` (sealed with another key — submit again). Submit is
limited to 10 an hour per admin, the check to 20.
