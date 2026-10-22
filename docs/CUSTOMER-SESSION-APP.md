# ko-sales customer pass (Customer Session Phase 2) — Vistaar app

**Base URL:** `{API_BASE}/api/v2` · envelope as in AUTH-APP.md.

ko-sales has one login for every customer-facing platform (sales-operations → User Management →
**Customer Session**). Vistaar is platform **`vistaar`** on **path 2**: our own OTP proves the
phone, so this server — never the app — holds the platform key and asks ko-sales for the
partner's pass. The pass is the partner's own: it names their `pii_id` and nobody else's.

```
 App   ── POST /auth/otp/verify ─────────────────────────────▶ Vistaar session (AUTH-APP.md)
 App   ── POST /auth/customer-session  (Vistaar Bearer) ─────▶ this server
                this server ── POST {B2B_API_URL}/customer/auth/temp-code   x-platform-key ─▶ ko-sales
                this server ── POST {B2B_API_URL}/customer/auth/token  grant temp_code ─────▶ ko-sales
                pass for another pii_id / a new customer → ended on ko-sales, 409
       ◀── { access_token, refresh_token, expires_in, refresh_expires_in, pii_id, phone }
 App   ── ko-sales customer routes   Authorization: Bearer <access_token>
 App   ── 401 → POST {B2B_API_URL}/customer/auth/token { grant_type: "refresh_token", phone, refresh_token }
          refresh 401 (30 days unused / admin ended it / platform off) → POST /auth/customer-session again
 Logout ── POST {B2B_API_URL}/customer/auth/logout { refresh_token }
```

## 1. `POST /auth/customer-session`

| Auth | Body | Answer |
|---|---|---|
| partner Bearer | `{ device_id?, device_name? }` | `CustomerSession` (below) |

- `device_id` — a random id made once per install; a new pass for the same device ends that
  device's old one on ko-sales. `device_name` (≤ 90 chars) is what the admin sees in Logins.
- Throttled to 10 a minute per caller. Ask after every sign-in, and again only when ko-sales
  refuses the long pass — never on a timer.

```jsonc
{
  "access_token": "eyJ…",              // ko-sales short pass, default 1 h
  "refresh_token": "hFZIfA3azat4UqflvWWDRQ.k8Fq…",  // ko-sales long pass, 30 days, renews on use
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_expires_in": 2592000,
  "pii_id": "PII-54018",               // always the partner's own
  "phone": "9876543210"                // send exactly this as `phone` when refreshing on ko-sales
}
```

## 2. Using the pass on ko-sales (MASTER Part D)

- Every ko-sales customer call: `Authorization: Bearer <access_token>`.
- **Refresh only on a 401** (never by the phone clock), **one at a time**:
  `POST {B2B_API_URL}/customer/auth/token { grant_type: "refresh_token", phone, refresh_token }` →
  ko-sales' TokenPair; store both new passes.
- 5xx / no connection: do not refresh — retry after 1 s → 2 s → 4 s.
- Refresh answered 401: the long pass is dead — call `POST /auth/customer-session` once.
- Logout: `POST {B2B_API_URL}/customer/auth/logout { refresh_token }`, then delete both passes.
- Keep the passes in Keystore / Keychain; never log them or put them in a URL.

Today ko-sales has only `GET /customer/me` behind the pass (MASTER §19, Part A2). Each data
screen needs its own ko-sales customer API before it can move off the shared staff login.

## 3. Errors

| Code | HTTP | Meaning / what to do |
|---|---|---|
| `CUSTOMER_SESSION_OFF` | 503 | no platform key on this server, or the admin switched Vistaar off — try at the next app open |
| `CUSTOMER_SESSION_UNAVAILABLE` | 503 | ko-sales down / not deployed, or it refused our key (ops alert) — retry later |
| `CUSTOMER_SESSION_BUSY` | 429 | over the platform's temp codes a minute — retry in a minute |
| `CUSTOMER_SESSION_MISMATCH` | 409 | ko-sales named another person, made a new one, or the phone is on two customer records — support |
| `ACCOUNT_BLOCKED` | 403 | as at login |
| `SESSION_INVALID` | 401 | the partner's own login is gone — AUTH-APP.md |

## 4. Server setup

`KATYAYANI_PLATFORM_KEY` = the key from Customer Session → Platforms → `vistaar` → **Generate
key** (shown once). Empty = this route answers `CUSTOMER_SESSION_OFF`. ko-sales is reached at
`B2B_API_URL`. Regenerating the key in the portal kills the old one at once — update this env
the same moment.
