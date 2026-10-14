# Today's tasks (Vistaar app)

**Base URL:** `{API_BASE}/api/v2` · bearer = partner `access_token` (AUTH-APP.md).
Home's **Today's tasks** card (PRD H5; Lovable `TodayTasks`): what the partner should do
now, in one call.

## `GET /today`

```jsonc
{
  "count": 5,                      // "5 to do"
  "counts": { "follow_up": 2, "saved_cart": 1, "event": 1, "order_to_confirm": 1 },
  "items": [ … ]                   // in the card's order, below
}
```

Every item has `type`, `ref_id` (the record to open), `urgent` (show in red) and `at` (the
time it is about), plus one block with the facts — the app writes the sentence, so Hindi
works:

| `type` | When it shows | `urgent` | Block | App line (Lovable) → opens |
|---|---|---|---|---|
| `follow_up` | an open lead's follow-up is today or overdue | overdue | `overdue_days` (0 = today), `lead { pii_id, name, phone, crops, acreage, expected_value, stage }` | "Follow up Ramesh" · crop · acres · ₹ expected · "Overdue 2d" / "Today 10:00" → `/leads/:pii_id` |
| `saved_cart` | a saved cart for a farmer, not reminded yet | idle 3+ days | `idle_days`, `cart { id, pii_id, customer_name, contact_number, item_count, subtotal }` | "Remind Ramesh about cart" · items · ₹ · "4d idle" → saved carts |
| `event` | an event you hold a seat at, today or tomorrow | today | `event { id, title, type, starts_at, location }` | title · location · "Today 18:00" / "Tomorrow 10:00" → `/events/:id` |
| `order_to_confirm` | an order placed, not yet confirmed at the warehouse | never | `order { id, customer_id, customer_name, total, payment_mode, order_status }` | "Confirm KSK-1 with Ramesh" · ₹ · COD · "awaiting warehouse confirmation" → `/orders/:id` |

**Order:** follow-ups (most overdue first), saved carts (longest idle first), events
(soonest first), orders (longest waiting first) — the card's order. `count: 0` → "All
caught up".

**Days** are IST calendar days. A saved cart for the partner's own shop stock is not a task
(nobody to remind); failed orders are not either.

## Doing a task

Tasks are read-only — each is a view of another record, nothing is stored for it. Doing
the task is acting on that record, and it then drops off the list by itself:

| Task | Done by |
|---|---|
| follow-up | set the next follow-up (or clear it, or mark the lead lost) — `PATCH /leads/:piiId`; log the call too (`POST /leads/:piiId/activities`), but a logged call alone leaves the follow-up due — LEADS-APP.md |
| saved cart | send the reminder → `POST /draft-orders/:id/reminder` (DRAFT-ORDER-APP.md), or order it |
| event | attend it — it leaves the list once it has started |
| order | Katyayani confirms it at the warehouse |

**Coming later** (new `type`s, same call): meeting gigs (Meetings), "farmer left an app
cart" (KKD & App activity). Ignore a `type` the app does not know yet.

## Errors

Only the usual login ones (`401`). If one source is down (e.g. events), the others still
come back — its tasks are just missing for that call.
