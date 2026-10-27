# KKD & App activity (Vistaar app)

**Base URL:** `{API_BASE}/api/v2` · bearer = partner `access_token` (AUTH-APP.md).
The **KKD & App activity** screen (`/kkd-activity`; PRD C8): what the partner's own farmers
do without the partner — at a **Katyayani Krishi Kendra** store (walk-ins, store orders,
crop advice) and on the **Katyayani app / website** (orders, app opens, abandoned carts) —
so the partner knows whom to call or visit. Also a farmer's **KKD & App** tab
(`?customer=`).

Read-only: the records belong to StockShip, the franchise backend and the Katyayani app.
**No commission** is paid on any of it — follow-up only (TL).

## Whose activity

- **My farmers only:** every farmer the partner **holds now** — open leads, customers
  (won) and lost leads. A farmer transferred or released away drops out at once.
- **Only after the hold began:** a farmer's history starts at the moment this partner got
  them (`held_since`, else when they added the farmer). What the farmer did before is not
  shown.
- **Matched by the farmer's `pii_id`, else their mobile number** — many store rows carry
  only the phone; the app events carry only the phone.
- **Any store**, not just the near ones: a farmer who buys at a store 80 km away still
  shows. The 50 km ring is only for the store list (`GET /kkd-activity/stores`).

## `GET /kkd-activity?customer=&channel=&from=&to=&page=1&limit=50`

| Query | |
|---|---|
| `customer` | one farmer (`PII-…`), for Customer details → KKD & App. `404 NOT_FOUND` "This farmer is not one of yours." if the partner does not hold them |
| `channel` | `store` · `app` (the screen's tabs); omit for **All** |
| `from`, `to` | IST days `YYYY-MM-DD`, both included; omit for all time |
| `page`, `limit` | usual; `limit` clamped to 200 |

Newest first.

```jsonc
{
  "items": [
    {
      "id": "order:KSK-341382",              // stable per record — use as the list key
      "type": "app_order",                   // see Types
      "channel": "app",                      // store · app
      "customer_id": "PII-1620690",          // the farmer → /farmers/:pii_id or /leads/:pii_id
      "customer_name": "Ramesh Patel",
      "store_id": null,                      // FR-100 … for store rows
      "store": "Katyayani app",              // store rows: "Katyayani Krishi Kendra · Raisen"
      "date": "2026-10-18T06:12:00.000Z",
      "amount": 1450,                        // ₹, whole; orders and carts only, else null
      "items": ["Zinc EDTA 12% 250 G ×2", "Neem Oil 1 L"],
      "note": null,                          // walk-in notes; crop advice "crop — problem — solution"
      "order_id": "KSK-341382"               // orders only
    }
  ],
  "page": 1, "limit": 50, "total": 23, "has_more": false
}
```

The app's `KkdActivity` entity maps 1:1 (`customerId` = `customer_id`, `customerName` =
`customer_name`, …).

### Types

| `type` | `channel` | From | Shown when |
|---|---|---|---|
| `walk_in` | store | the store's walk-in register | the farmer walked into a store (walk-ins the store turned down — `rejected` — are wrong entries and are left out) |
| `store_order` | store | the store's POS (StockShip MKTP-4, plus the POS archive before StockShip) | a real sale at a store. Company orders filed on a store (`founder_office`) are not store sales and are left out. An order in both places is shown once |
| `advisory` | store | the store's crop prescriptions | the store advised the farmer: crop, problem, solution; recommended products in `items` |
| `app_order` | app | StockShip MKTP-3 (Katyayani app) and MKTP-2 (Katyayani website) | the farmer ordered on their own. `store` says which |
| `app_open` | app | the Katyayani app's events | one per farmer per IST day (the latest open that day) |
| `app_cart` | app | the Katyayani app's events | the farmer left a cart; `amount` = cart total |

Orders that failed, were split or merged, cancelled or returned are not shown.
`soil_test` (in the app's mock) has no source anywhere yet — never returned; keep the
chip hidden or drop it.

## `GET /kkd-activity/summary?month=2026-10&customer=`

The screen's tiles.

```jsonc
{
  "month": "2026-10",                            // IST month; default this month
  "walk_ins": 4,                                 // walk-ins this month
  "store_orders": { "count": 2, "amount": 3200 },// store orders this month
  "app_orders":   { "count": 5, "amount": 7450 },// app + website orders this month
  "open_app_carts": { "count": 1, "amount": 1299 } // any month: carts with no app order from that farmer after them
}
```

`customer` narrows the tiles to one farmer (same `404` rule).

## `GET /kkd-activity/stores`

KKD stores within **50 km of where the partner registered** (TL), nearest first — the
stores a farmer can be sent to.

```jsonc
{
  "centre": { "lat": 23.26, "lng": 77.41, "source": "signup" }, // signup GPS · pincode centre; null = neither known
  "km": 50,
  "stores": [
    {
      "id": "FR-100", "name": "Katyayani Krishi Kendra · Raisen",
      "address": "…", "city": "Raisen", "state": "Madhya Pradesh", "pincode": "464551",
      "phone": "9000000001",                     // null when the store has none
      "lat": 23.33, "lng": 77.78, "distance_km": 38.6
    }
  ]
}
```

`centre: null` (partner signed up without GPS and has no known pincode) → `stores: []`;
show "Add your pincode in Edit Profile to see stores near you". Only stores with a map
point are placed; a store still being set up shows once it has one. Same store names as
the Nearby radar (VISTAAR-RADAR-APP.md).

## Before production — no dummy data (must do)

Today the app's server build still reads the **mock seed** for KKD activity:
`RemoteCustomersRepositoryImpl.kkdActivity` → `_local.kkdActivity()`
(`customers_seed.dart`). Every screen below shows fake farmers' walk-ins, orders and carts
until it is moved to the API. Nothing from the seed may ship.

| Where (app, `vistaar-2.0-ui`) | Today (mock) | Use instead |
|---|---|---|
| KKD & App activity page (`kkd_activity_page.dart`) — list, tabs, farmer filter | seed `kkdActivity` | `GET /kkd-activity` (`channel`, `customer`, paging) |
| Same page — the 4 tiles | counted on the phone from the seed | `GET /kkd-activity/summary` |
| Customers list — "Active at KKD/app" badge (`farmers_page.dart`, last 7 days) | seed | `GET /kkd-activity?from=<IST day 7 days ago>&limit=200` → the set of `customer_id`s |
| Customer details — timeline, open app carts, pitch (`farmer_details_page.dart`, `customer_catalog.dart` `openAppCarts` / `buildPitch` `kkd ?? kkdActivity`) | seed | `GET /kkd-activity?customer=<pii_id>`; open carts = `app_cart` rows with no later `app_order` (same rule as the tile) |
| Home Today's tasks — "left an app cart" | demo build only; the server build uses `GET /today`, which has **no** KKD cart task | nothing — do not add it from the seed. (A backend KKD cart task in `/today` is not built; ask if wanted) |
| Nearby radar stores | demo build only (`kkdStores` seed); the server build uses `GET /radar` `stores` | already real — keep the seed out of the server build |

Rules:

- **No seed fallback.** When a call fails, show the error / retry state. When it returns
  nothing, show an empty state ("No KKD or app activity from your farmers yet"). Never fill
  with seed rows.
- **Hide what has no data:**
  - `soil_test` — never returned (no source anywhere). Remove its chip, filter and icon
    from the screen and the farmer timeline.
  - Store **services** and **opening hours** — not on record. Leave those lines out.
  - `amount: null` (walk-ins, advice, app opens) — show no ₹ line, never "₹0".
  - `note: null`, `items: []` — leave the line out.
  - `stores: []` / `centre: null` — show the empty line from `GET /kkd-activity/stores`
    above, no sample store.
- Remove `kkdActivity` / `kkdStores` from `customers_seed.dart` (or keep them only behind
  the demo flag, never reachable on the Vistaar API).

## Freshness and errors

- Read from the other apps on each call, kept **one minute** per partner — a walk-in just
  entered at a store shows within a minute. Pull-to-refresh after a minute reads again.
- If one source cannot be read, its rows are left out and the rest still show (no error).
- `400 VALIDATION_FAILED` for a bad `customer`, `channel`, date or month.
