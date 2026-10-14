# Order events — for the order service

**For the team that runs Katyayani's order API** (TL). When Stockship **confirms** a
Vistaar order, call this once; the farmer the partner ordered for becomes their customer
(the lead moves to `won`). Nothing else is needed — Vistaar reads the order itself from
`orders_v2`.

## The call

```
POST {VISTAAR_API}/api/v2/hooks/orders/confirmed
x-webhook-secret: <ORDER_EVENTS_SECRET>
Content-Type: application/json

{ "order_id": "KSK-341382" }
```

- **When:** the order reaches `confirmed` (punched) — or any later status. Calling again,
  for the same or a later status, is safe: the answer just says `updated`.
- **Which orders:** only `orders_v2` rows with `source: "vistaar"` matter; others are
  answered `ignored`. Sending every confirmed order is fine.
- **Secret:** `ORDER_EVENTS_SECRET` on the Vistaar server (≥ 24 characters), shared with the
  order service only. Not set = the route answers `503 ORDER_EVENTS_NOT_CONFIGURED`.

## Answers

Every answer is `{ "success": true, "data": … }`:

| `data` | Meaning |
|---|---|
| `{ "result": "won", "pii_id": "PII-…" }` | first confirmed order — the farmer is now the partner's customer |
| `{ "result": "updated", "pii_id": "PII-…" }` | already a customer; their last order moved |
| `{ "result": "ignored", "reason": "not_a_vistaar_order" }` | no Vistaar order with that id |
| `{ "result": "ignored", "reason": "not_confirmed" }` | the order is not confirmed yet (placed / pending / cancelled) — call again once it is |
| `{ "result": "ignored", "reason": "no_buyer" }` | the order has no `pii_id` or no partner |
| `{ "result": "ignored", "reason": "not_held" }` | shop stock (the partner's own `pii_id`), or a farmer the partner does not hold |

| Error | HTTP | Do |
|---|---|---|
| `UNAUTHORIZED` | 401 | wrong or missing `x-webhook-secret` |
| `VALIDATION_FAILED` | 400 | `order_id` missing or malformed |
| `ORDER_EVENTS_NOT_CONFIGURED` | 503 | the secret is not set on this server |
| `LEADS_UNAVAILABLE` | 503 | retry later |

## What Vistaar does with it

Reads the order from `orders_v2` (`order_id`, `source`, `agent` = the partner's `VST-` id,
`pii_id` = the farmer, `order_status`, `date`). "Confirmed" = Stockship's `confirmed` or any
status after it (packed, shipped, delivered, even a later return). Then, on the farmer's
`vistaar_v2_leads` row, only if the partner holds that farmer:

- first time: `stage` → `won`, `customer_at` = `last_order_at` = the order date, logged as
  `system`;
- after: `last_order_at` moves forward (and `customer_at` back, for an earlier order).

Vistaar never writes `orders_v2`, `customers` or `leads_v2` here.
