# Cart — mobile app contract

The partner's cart for the Flutter app's **Cart** and **Checkout** screens.
Replaces the in-memory `CartRepository`. One cart per partner — saved / draft
carts are the draft-orders API (`docs/DRAFT-ORDER-APP.md`).

All routes are under `/api/v2/cart` and answer `{ "success": true, "data": … }`. The partner comes from the headers below —
nothing in a path or body says whose cart it is.

## Headers on every call

| Header | Value | Why |
|---|---|---|
| `Authorization` | `Bearer <Vistaar access token>` — from `POST /auth/otp/verify` (see `AUTH-APP.md`) | Says whose cart it is. 401 → refresh the session (`POST /auth/refresh`) and retry |
| `x-b2b-token` | The app's B2B access token — the same token the app's `ApiClients.b2b` sends | The server prices the cart from the B2B catalogue with it. A 401 here means the B2B token expired: renew it (as the B2B client already does) and retry |

Missing either one → **401 `UNAUTHORIZED`**.

## Lines are packs (`sku`), priced live

A line is one **pack** (`sku`, e.g. `K-350`), not a product (`product_id` =
`bulk_sku`, e.g. `BK-629`). The app's cart id `BK-629::1 L` maps to
`product_id` + `size_label`. `mrp` and `size_label` come from the catalogue on
every read (a delisted pack shows `mrp: 0`).

Prices and stock come from the same B2B marketplace (`MKTP-1`) the Shop lists.
The server never trusts a price from the client; every response re-prices each
line from the catalogue (refreshed every 60 s, with the caller's B2B token):

| Field | Meaning |
|---|---|
| `price` / `line_total` | Today's dealer price × quantity |
| `available_qty` | Stock on hand for the pack |
| `available` | `false` = no longer sold, or stock below the cart quantity |
| `price_changed` | Price moved since the line was added — worth a toast |
| `has_issues` | Any line not `available` — block checkout |

Quantities are **capped** at stock, never rejected: asking for 1000 when 360
are in stock gives 360, as the app's `Cart.add()` does.

## Routes

| Method | Path | Body | Does |
|---|---|---|---|
| `GET` | `/cart` | — | The cart (empty if none yet) |
| `POST` | `/cart/items` | `{ sku, quantity? = 1 }` | Adds to the line, capped at stock |
| `PATCH` | `/cart/items/:sku` | `{ quantity }` | Sets quantity; `0` removes |
| `DELETE` | `/cart/items/:sku` | — | Removes the line (no error if absent) |
| `PUT` | `/cart/customer` | `{ pii_id: "PII-123" \| null }` | Who it is for (the customer's `pii_id`); `null` = own stock |
| `DELETE` | `/cart` | — | Empties it and clears the customer |

Every route returns the whole cart, so the app replaces its state with the
response and never computes totals itself. The customer's name is not stored on
the cart — show it from the app's own customer list by `pii_id`.

`PUT /cart/customer` also takes an optional `location` (the phone's GPS now) — kept as a
rough place for the farmer, never over one from a visit or an add (RADAR-APP.md).

The customer must be one of the partner's own farmers: a `pii_id` from the
partner's leads (`GET /leads`, LEADS-APP.md), created or linked, in any stage —
"Place first order" on a lead sets it (*updated 2026-10-13*: this replaced the
earlier `leads_v2.lead_owner` rule, which no lead could meet). Any other `pii_id` — unknown or someone else's — is the same `404 NOT_FOUND`
("This customer could not be found."), and the cart is left as it was. The
partner's own `pii_id` is accepted and means shop stock, like `null`.

### Cart

```json
{
  "pii_id": "PII-1620388",
  "items": [{
    "sku": "K-217", "product_id": "BK-90", "product_name": "…",
    "product_image": "https://…", "size_label": "1 L",
    "price": 320, "mrp": 499, "quantity": 3, "line_total": 960,
    "available_qty": 360, "available": true, "price_changed": false
  }],
  "item_count": 3, "subtotal": 960, "has_issues": false,
  "updated_at": "2026-10-08T12:36:26.868Z"
}
```

Delivery fee, coins and commission stay in the app's `billFor()` for now and
are settled by the orders API.

## Errors (`error.code`)

| Status | Code | When | App shows |
|---|---|---|---|
| 400 | `VALIDATION_FAILED` | Bad sku, quantity outside 0–9999, bad `pii_id` | `details[0]` |
| 401 | `UNAUTHORIZED` | Vistaar token missing/expired, or B2B token missing/expired | Refresh the session or renew the B2B token, then retry |
| 403 | `PARTNER_NOT_APPROVED` / `ACCOUNT_BLOCKED` | Add, change or restore lines, or set the customer, before approval or when blocked. Reading and emptying the cart are never refused | `message` |
| 404 | `NOT_FOUND` | Pack not sold, line not in cart | `message` |
| 409 | `OUT_OF_STOCK` | Nothing left to add | `message` |
| 409 | `CART_LIMIT_REACHED` | 100 different packs already in the cart | `message` |
| 409 | `CART_BUSY` | Lost repeated write races (rare) — re-`GET` and retry | `message` |
| 503 | `CATALOG_UNAVAILABLE` | B2B catalogue down with nothing cached | Retry later |
