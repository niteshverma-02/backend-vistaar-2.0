# Customers (Vistaar app)

**Base URL:** `{API_BASE}/api/v2` · bearer = partner `access_token` (AUTH-APP.md).
Screens: Customers (`/farmers`), Customer detail (`/farmers/:id`), the "Ordering for" picker
(PRD C1–C3).

## What a customer is

A **lead becomes a customer by itself** when the first order the partner placed for that
farmer is **confirmed** by Katyayani (punched at the warehouse). There is no "add customer"
and the app never sets `won` — the lead moves to `won` on its own, and the lead's log shows
"First order KSK-… confirmed — now a customer" (by `system`).

- The flow: Lead detail → **Place first order** → `PUT /cart/customer { pii_id }`
  (CART-APP.md) → checkout → Katyayani confirms the order → the lead is `won`. A placed but
  not yet confirmed order does not change the lead.
- Only orders the partner places for **their own** farmer count. Shop-stock orders (your own
  `pii_id`) never make a customer.
- A customer is the same record as the lead: same `pii_id`, still in `GET /leads` (stage
  `won`), now also in `GET /customers`. A customer cannot be lost or reopened.
- One farmer, one partner, as for leads (LEADS-APP.md). A customer with **no order for 45
  days** can be taken by another partner (`releases_at`).

## Create · read · update · delete

| | How |
|---|---|
| Create | never directly — the first confirmed order (above) |
| Read | `GET /customers`, `/customers/summary`, `/customers/:piiId` |
| Update | the Lovable **edit customer** screen → `PATCH /leads/:piiId` with the farmer's details (LEADS-APP.md); the mobile cannot change |
| Delete | not possible — orders and commission hang on a customer (`DELETE /leads/:piiId` answers `409`) |

## Routes

| Method | Path | |
|---|---|---|
| GET | `/customers?q&crop&sort&page&limit` | my customers — `PageResult<Customer>` |
| GET | `/customers/summary` | the screen's tiles and crop chips |
| GET | `/customers/:piiId` | one customer — the lead detail + business |
| GET | `/orders?customer=<pii_id>` | the customer's **Orders** tab (ORDERS-APP.md), newest first |

`GET /customers`:
- `q` — name, village, district, crop, or digits of the mobile.
- `crop` — one crop chip (any case).
- `sort` — `-last_order_at` (latest order first, the default) · `-spend` (highest first) ·
  `name` (A–Z).

## The customer

The lead (LEADS-APP.md *The lead*) plus:

```jsonc
{
  "pii_id": "PII-1620690", "stage": "won",
  "name": "Ramesh Patel", "phone": "6000000101", "village": "Rampur", "district": "BHOPAL",
  "crops": ["Wheat", "Soybean"], "acreage": 6, "found_via": "meeting",
  "customer_at": "2026-10-14T…Z",   // "Customer since" — the first confirmed order
  "last_order_at": "2026-10-20T…Z", // the latest confirmed order
  "orders": 3,                      // confirmed orders, returns and cancellations left out
  "spend": 12500,                   // ₹ of those orders
  "last_order_stage": "shipped",    // placed · punched · shipped · delivered — "shipped" = "Order in transit"
  "releases_at": "…",               // 45 days after the last order
  // GET /customers/:piiId only:
  "average_order": 4167,
  "stage_history": [ … ], "activities": [ … ]   // as the lead's, newest activity first
}
```

`GET /customers/summary`:

```jsonc
{ "total": 12, "active_30_days": 7,   // ordered in the last 30 days
  "total_business": 84500,           // Σ spend
  "crops": [{ "key": "Wheat", "count": 6 }, …] }   // chips, most customers first
```

## From the app's `Customer` model

| App (`Customer`) | API |
|---|---|
| `id` | `pii_id` |
| `name`, `phone`, `village`, `district`, `state`, `pincode`, `crops` | same names |
| `landSize` | `acreage` |
| `totalOrders` | `orders` |
| `totalSpent` | `spend` |
| `lastOrderAt` | `last_order_at` |
| `createdAt` ("Customer since") | `customer_at` |
| `source` | `found_via` |
| `notes` | the lead's `activities` (notes) |

**Detail tabs:** Overview = the customer; **Orders** = `GET /orders?customer=`; **Timeline**
= `stage_history` + `activities` + the orders, merged by date. Advice and KKD & App tabs:
not on the server yet.

**"Ordering for" picker:** list `GET /customers` and the open leads of `GET /leads` — any
`pii_id` you hold is accepted by the cart.

## Errors

| Code | HTTP | Show |
|---|---|---|
| `NOT_FOUND` | 404 | not one of your customers (a lead not won yet, or another partner's) |
| `VALIDATION_FAILED` | 400 | a bad `q` / `crop` / `sort` |
