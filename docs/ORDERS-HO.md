# Orders — head office (portal) contract

Every Vistaar partner's placed orders, for the HO portal's **Vistaar → Orders**
screen. The same rows and the same mapping as the app's `/orders`
(`ORDERS-APP.md`): Stockship's `orders_v2` with `source: 'vistaar'`. Read-only;
orders are placed in the app and moved in Stockship.

Capability: `orders.read` (head roles: USR-1037, USR-1000, USR-1001). Others get
`403`. Header: `Authorization: Bearer <SSO access token>`.

## Routes

| Method | Path | Returns |
|---|---|---|
| `GET` | `/admin/orders?page=1&limit=200&status=&agent_id=&from=&to=` | `PageResult<AdminOrderView>`, newest first |
| `GET` | `/admin/orders/:id` | `AdminOrderView` (404 if it is not a Vistaar order) |

| Query | Meaning |
|---|---|
| `status` | an app stage: `placed`, `punched`, `shipped`, `delivered`, `cancelled`, `returned` |
| `agent_id` | one partner (`VST-…`, case-insensitive) |
| `from`, `to` | IST days `YYYY-MM-DD`, both included (`from` ≤ `to`, else 400) |
| `limit` | ≤ 200 (clamped) |

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
