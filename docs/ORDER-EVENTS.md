# Order events — for the order service

**For the team that runs Katyayani's order API** (TL). When a Vistaar order is
**confirmed**, call this once; the farmer the partner ordered for becomes their customer
(the lead moves to `won`). Vistaar trusts the call as sent — it does not look the order up
again — so the call must carry the farmer and the partner.

## The call

```
POST {VISTAAR_API}/api/v2/hooks/orders/confirmed
x-webhook-secret: <ORDER_EVENTS_SECRET>
Content-Type: application/json

{
  "order_id": "KSK-341382",                    // orders_v2.order_id
  "pii_id": "PII-1620690",                     // the farmer (orders_v2.pii_id)
  "agent_id": "VST-000006",                    // the partner who placed it (orders_v2.agent)
  "order_date": "2026-10-14T10:30:00+05:30"    // optional — when it was placed; now if left out
}
```

- **When:** once the order is confirmed. Only confirmed orders — Vistaar does not check the
  status. Sending the same order again is safe: the answer just says `updated`.
- **Which orders:** Vistaar orders only (`marketplace: "MKTP-5"`, `agent` = a `VST-` id).
- **Secret:** `ORDER_EVENTS_SECRET` on the Vistaar server (≥ 24 characters), shared with the
  order service only — it is what makes the call trusted. Not set = the route answers
  `503 ORDER_EVENTS_NOT_CONFIGURED`.

## Answers

Every answer is `{ "success": true, "data": … }`:

| `data` | Meaning |
|---|---|
| `{ "result": "won", "pii_id": "PII-…" }` | first confirmed order — the farmer is now the partner's customer |
| `{ "result": "updated", "pii_id": "PII-…" }` | already a customer; their last order moved |
| `{ "result": "ignored", "reason": "not_held" }` | shop stock (the partner's own `pii_id`), or a farmer this partner does not hold |

| Error | HTTP | Do |
|---|---|---|
| `UNAUTHORIZED` | 401 | wrong or missing `x-webhook-secret` |
| `VALIDATION_FAILED` | 400 | a field missing or malformed — `details[0]` |
| `ORDER_EVENTS_NOT_CONFIGURED` | 503 | the secret is not set on this server |
| `LEADS_UNAVAILABLE` | 503 | retry later |

## What Vistaar does with it

On the farmer's `vistaar_v2_leads` row, only if `agent_id` holds that farmer:

- first time: `stage` → `won`, `customer_at` = `last_order_at` = `order_date`, logged as
  `system`;
- after: `last_order_at` moves forward (and `customer_at` back, for an earlier order).

Vistaar never writes `orders_v2`, `customers` or `leads_v2` here.
