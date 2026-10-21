# Orders — head office (portal) contract

Every Vistaar partner's placed orders, for the HO portal's **Vistaar → Orders**
screen. The same rows and the same mapping as the app's `/orders`
(`ORDERS-APP.md`): Stockship's `orders_v2` with `marketplace: 'MKTP-5'`. Read-only;
orders are placed in the app and moved in Stockship.

Capability: `orders.read` (head roles: USR-1037, USR-1000, USR-1001). Others get
`403`. Header: `Authorization: Bearer <SSO access token>`.

## Routes

| Method | Path | Returns |
|---|---|---|
| `GET` | `/admin/orders?page=1&limit=200&status=&agent_id=&customer=&from=&to=&payment_mode=&state=&q=` | `PageResult<AdminOrderView>`, newest first |
| `GET` | `/admin/orders/summary?…same filters…` | `AdminOrderSummary` — the screen's cards |
| `GET` | `/admin/orders/breakdown?…same filters…` | `AdminOrderBreakdown` — the sales panels |
| `GET` | `/admin/orders/:id` | `AdminOrderView` (404 if it is not a Vistaar order) |

| Query | Meaning |
|---|---|
| `status` | an app stage: `placed`, `punched`, `shipped`, `delivered`, `cancelled`, `returned` |
| `agent_id` | one partner (`VST-…`, case-insensitive) |
| `customer` | one buyer's `pii_id` (`PII-…`) — a customer's Orders tab |
| `from`, `to` | IST days `YYYY-MM-DD`, both included (`from` ≤ `to`, else 400) |
| `payment_mode` | `cod` · `prepaid` · `partial` · `credit` |
| `state` | shipping state, any case |
| `q` | an order id (exact, any case), or 4+ digits of the buyer's phone (matched at its end); anything else = 400 |
| `limit` | ≤ 200 (clamped) |

```ts
// /summary: same filters as the list; with no from/to it covers this IST month,
// and a range longer than 366 days = 400 (the sums read every matching order).
interface AdminOrderSummary {
  orders: number;
  value: number;                       // Σ total, cancelled + returned left out
  partners: number;                    // distinct partners
  customers: number;                   // distinct buyers
  by_stage: { stage: "placed" | "punched" | "shipped" | "delivered" | "cancelled" | "returned"; count: number; value: number }[];
}
```

```ts
// /breakdown: same filters and window as /summary; cancelled + returned left out
// (a status filter of cancelled / returned answers empty panels).
interface AdminOrderBreakdown {
  from: string; to: string;                                  // IST days covered
  by_day: { day: string; orders: number; value: number }[];  // YYYY-MM-DD, IST, oldest first; days with no orders absent
  by_partner: { agent_id: string; name: string | null; orders: number; value: number }[];  // top 10 by value
  by_state: { state: string; orders: number; value: number }[];   // shipping state, upper case, top 15
  by_city: { city: string; orders: number; value: number }[];     // shipping city, upper case, top 15
  by_product: { sku: string; name: string | null; image: string | null; qty: number; value: number }[];  // top 10 packs by value; free items left out
  by_category: { name: string; value: number; pct: number }[];    // every pack's value by product category ("Other" if unknown)
  repeat_buyers: number;                                     // buyers with 2+ orders in the window
}
```

Cards and tables: read the list one page at a time, the cards from `/summary` and the
panels from `/breakdown` — never add up a page. For a CSV export, page through `has_more`.

Rides Stockship's `{ source, order_status, date }` index (`{ agent, … }` with a
partner), so other channels' orders are never scanned.

## `AdminOrderView`

The app's `OrderView` (see `ORDERS-APP.md`) plus:

```json
{
  "partner": { "agent_id": "VST-1001", "name": "Ramesh Patel", "phone": "9826000000",
               "cohort": "retailer", "district": "Raisen", "state": "Madhya Pradesh" },
  "ship_to": { "city": "Raisen", "state": "MADHYA PRADESH", "pincode": "464551" }
}
```

- `commission` (COMMISSION-APP.md) is filled on `GET /admin/orders/:id` only; the list
  sends `null` (a page spans many partners, each a book of their own). One partner's
  commission in full: `GET /admin/commission/partners/:agentId` (COMMISSION-HO.md).
- `partner` is looked up once per page; `name` etc. are `null` for an id the
  agents collection does not know. `partner: null` only for a row with no `agent`.
- `customer_name: "Self (shop stock)"` when the order was billed to the
  partner's own pii, exactly as the app shows it.
