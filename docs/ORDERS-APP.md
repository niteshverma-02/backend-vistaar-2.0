# Orders — mobile app contract

The partner's placed orders, for the Flutter app's **Orders**, **Order
details** and **Order tracking** screens. Replaces the device-local
`OrdersRepository` seed.

Orders live in Stockship's `orders_v2`, the same collection every channel
sells through. A Vistaar order is one with `source: 'vistaar'` and the
partner's `VST-` id in `agent`. This module reads orders and hands out
order numbers; placing an order (checkout) is not built yet.

All routes are under `/api/v2/orders` and answer `{ "success": true, "data": … }`.
Header: `Authorization: Bearer <Vistaar access token>` — that decides whose
orders come back. No `x-b2b-token` is needed.

## Routes

| Method | Path | Returns |
|---|---|---|
| `GET` | `/orders?page=1&limit=50&status=shipped&customer=PII-123&from=2026-09-01&to=2026-09-30` | `PageResult<OrderView>`, newest first. `limit` ≤ 200; all filters optional: `status`, `customer` (one farmer's `pii_id` — a customer's Orders tab), `from` / `to` (IST days placed, **both included**; Reports → Order history) |
| `GET` | `/orders/:id` | `OrderView` |
| `POST` | `/orders/id` | `OrderIdView` — the order number for one checkout attempt (below) |

`:id` is the order's `order_id` (`KSK-341382`); case does not matter. An id with `/` (`ORD/K0-150/41350`) is sent URL-encoded: `/orders/ORD%2FK0-150%2F41350`.

`status` is one of `placed`, `punched`, `shipped`, `delivered`, `cancelled`,
`returned` — the app's `OrderStatus` minus `draft` (drafts are
`/draft-orders`).

## Order number — `POST /orders/id`

Vistaar's order numbers are `KSV-1`, `KSV-2`, … from `app_counters`
(`_id: 'vistaar_orders'`). The old Vistaar already used some `KSV-` numbers;
those are stepped over, so the series has gaps — never assume `KSV-n+1`
follows `KSV-n`.

```json
// request
{ "request_id": "3f2a7c1e-9b4d-4e8a-a1c2-5d6e7f809a1b" }
// 200
{ "success": true, "data": {
  "order_id": "KSV-272",
  "request_id": "3f2a7c1e-9b4d-4e8a-a1c2-5d6e7f809a1b",
  "issued_at": "2026-10-16T07:30:00.000Z"
} }
```

- Make **one UUID per checkout attempt** and send the same one on every retry
  (timeout, double tap, app restart). The same `request_id` always gets the
  same number back; a new one spends a new number.
- A new attempt (the partner changes the cart and pays again) = a new UUID.
- The number is the partner's alone: another partner's `request_id` never
  returns it.
- COD: ask for the number when the partner taps **Place order**. Prepaid: the
  number comes from the payment webhook, once payment is confirmed (checkout
  is not built yet), so a failed payment spends nothing.



```json
{
  "id": "KSK-341382",
  "status": "shipped",
  "order_status": "in_transit",
  "customer_id": "PII-273762",
  "customer_name": "Kondappa",
  "customer_phone": "8712404712",
  "items": [
    {
      "sku": "K-489", "product_name": "AZODHARMA (AZOXYSTROBIN 18.2 % + DIFENOCONAZOLE 11.4 %)",
      "product_image": "https://…/Azozolenew.webp", "size_label": "250 ML",
      "quantity": 1, "unit_price": 545, "line_total": 545, "is_free": false
    }
  ],
  "item_count": 1,
  "subtotal": 545,
  "discount": 0,
  "coins_used": 0,
  "delivery_charge": 0,
  "total": 545,
  "payment_mode": "cod",
  "cod_amount": 545,
  "prepaid_amount": 0,
  "delivery_address": "7/40/1 Bc colony, Kanaganapalle, ANDHRA PRADESH 515641",
  "awb": "1234567890",
  "courier": "Delhivery Surface",
  "tracking_steps": [
    { "status": "Order placed", "description": "Order received by Katyayani", "timestamp": "2026-10-12T08:56:44.994Z", "completed": true },
    { "status": "Confirmed", "description": "Order punched at warehouse", "timestamp": "…", "completed": true },
    { "status": "Shipped", "description": "Handed to courier", "timestamp": "…", "completed": true },
    { "status": "Out for delivery", "description": "With delivery partner", "timestamp": null, "completed": false },
    { "status": "Delivered", "description": "Delivered to customer", "timestamp": null, "completed": false }
  ],
  "created_at": "2026-10-12T08:56:40.000Z",
  "delivered_at": null,
  "commission": {
    "base": 462, "rate": 5, "amount": 23, "status": "pending",
    "confirms_at": null, "confirmed_at": null, "paid_at": null,
    "withdrawal_id": null, "reversed_reason": null
  }
}
```

- `status` is the app's stage; `order_status` is Stockship's raw value (about
  50 of them, e.g. `in transit` / `in_transit`), for support only. An unknown
  raw value reads as `placed`.
- `customer_id: null` = the partner's own shop stock; `customer_name` is then
  `"Self (shop stock)"`.
- `tracking_steps` are the app's `initialTrackingSteps`. A step is done when
  the order reached it or anything after it; a done step can have
  `timestamp: null` when Stockship skipped it. A cancelled or returned order
  shows only the steps it reached, then a final `Cancelled` / `Returned` step.
- `payment_mode` is Stockship's: `cod`, `prepaid`, `partial`, `credit`. The
  app's `online` = `prepaid`.
- `product_name` / `product_image` / `size_label` come from `products_v2`; a sku
  not found there shows the sku as its name and no image.
- `delivered_at` — when it was delivered (`null` until then).
- `commission` — what the order earns the partner; the fields and their rules are in
  COMMISSION-APP.md (*An order's commission*). `null` = show nothing (it could not be
  worked out just now, or it is not a live order). The backend works it out from the
  order — the app no longer computes or stores it on the phone.
- Reports → Order history: `GET /orders?from=…&to=…`, paging through `has_more`. Note
  `to` is the **last day included** (`from=2026-09-01&to=2026-09-30` for September).

### Maps to the app's `Order`

| App field | API |
|---|---|
| `id` | `id` |
| `customerId` / `customerName` | `customer_id` / `customer_name` |
| `lines[]` `productId, name, image, size, quantity, price` | `items[]` `sku, product_name, product_image, size_label, quantity, unit_price` |
| `subtotal`, `discount`, `coinsUsed`, `total` | same, snake_case |
| `paymentMode` | `payment_mode` (`prepaid` → `online`) |
| `status` | `status` |
| `createdAt`, `deliveryAddress`, `awb`, `courier`, `trackingSteps` | same, snake_case |

## Errors (`error.code`)

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_FAILED` | bad `status`, `page`, `from` / `to` (or `from` after `to`), or an `:id` that is not an order id |
| 401 | `UNAUTHORIZED` | no or expired Vistaar token |
| 404 | `NOT_FOUND` | no such order, or it is another partner's |
| 400 | `VALIDATION_FAILED` | `POST /orders/id`: `request_id` missing or not a UUID, or an extra field |
| 403 | `PARTNER_NOT_APPROVED` / `ACCOUNT_BLOCKED` | `POST /orders/id`: the account is not approved yet, or is blocked — show `message` |
| 429 | `TOO_MANY_REQUESTS` | `POST /orders/id`: more than 10 in a minute |
| 503 | `ORDER_ID_UNAVAILABLE` | `POST /orders/id`: no number could be issued — retry later with the **same** `request_id` |
| 5xx | `DATABASE_UNAVAILABLE` / `INTERNAL_ERROR` | `POST /orders/id`: retry with the **same** `request_id` — a number already issued comes back, none is spent twice |
