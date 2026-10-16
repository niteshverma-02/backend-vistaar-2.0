# Commission, wallet and reports (Vistaar app)

**Base URL:** `{API_BASE}/api/v2` · bearer = partner `access_token` (AUTH-APP.md).
Everything is the logged-in partner's own; no partner id in any path. The rules behind
every number are in COMMISSION-LOGIC.md. Replaces the app's seed `commissionPlans` /
`monthlySales` and the phone-side commission (the backend works it out from the orders).

> **Updated 2026-10-16 — earning cohorts.** An order now earns on the plan of the
> partner's **earning cohort when it was placed** (`GET /me` → `earning_cohort`;
> EARNINGS-APP.md) — a fixed % or slabs, maybe with a minimum order value below which the
> order earns the default cohort's plan. "My plan" is the new `my_plan` in
> `GET /commission/plans`; each ledger row says which cohort and plan it earned on
> (`cohort_id`, `plan_id`, `below_min_order`). Orders placed before the partner's first
> earning cohort keep their old rate. `gig_earned` now also counts approved follow-up gig
> rewards.

Money: commission in whole ₹ (int); TDS and net to the paisa (`19.4`). Rates are % numbers
(`7`, `7.5`). Months `YYYY-MM` (IST); quarters `FY2026-Q2` (the year the FY starts; Q1 =
Apr–Jun).

`status` (commission): `pending` · `confirmed` · `paid` · `reversed`.

## Routes

| Method | Path | Screen |
|---|---|---|
| GET | `/commission/summary` | Home strip, Wallet, "Earn ~₹X" (Shop / Cart / Checkout / Pitch), Orders "Pending commission" |
| GET | `/commission/ledger?status=&page=&limit=` | Commission → Ledger |
| GET | `/commission/plans` | Commission → My plan, Compare cohorts |
| GET | `/orders`, `/orders/:id` | each order's `commission` + `delivered_at` (ORDERS-APP.md) |
| GET | `/wallet` | Wallet: balance, bank, can I withdraw |
| POST | `/wallet/withdrawals` | Withdraw |
| GET | `/wallet/withdrawals`, `/wallet/withdrawals/:id` | Withdrawal history / one |
| DELETE | `/wallet/withdrawals/:id` | Cancel a request HO has not approved |
| GET | `/reports/commission-statement?month=` | Reports → Commission statement (app builds the CSV) |
| GET | `/reports/tds?quarter=` | Reports → TDS / Form 16A |

Also for Reports: `GET /orders?from=&to=` (Order history) and `GET /customers?ordered_in=`
(Customer list) — ORDERS-APP.md, CUSTOMERS-APP.md. My Performance: MY-PERFORMANCE-APP.md.

**CRUD:** commission is read-only (it follows the orders). A withdrawal is created, read and
cancelled (`DELETE` keeps it as `cancelled`); it is never edited (cancel and ask again) and
never erased — it is the payment record.

## `GET /commission/summary`

Refresh on app open, after an order, on pull-to-refresh.

```jsonc
{
  "month": "2026-10",
  "month_delivered_sales": 62000,          // base (before GST) delivered this month
  "monthly_target": 100000,
  "current_rate": 7,                       // my plan now, at this month's slab — use for every "Earn ~₹X" (price ÷ (1+GST) × rate)
  "next_slab": { "rate": 10, "gap": 38000 },   // null on the top slab (always null on a fixed plan)
  "month_commission_estimate": 4340,       // Σ commission of this month's delivered orders, each at its own rate
  "totals": {
    "pending":   { "count": 3, "amount": 1520 },
    "confirmed": { "count": 2, "amount": 970 },   // amount = confirmed and not yet paid out
    "paid":      { "count": 9, "amount": 6210 },
    "reversed":  { "count": 1, "amount": 140 }
  },
  "earned": 7180,                          // confirmed + paid, all time (+ gig_earned)
  "gig_earned": 0,                         // approved meeting gigs + follow-up gig rewards inside earned; 0 while gig pay is off
  "withdrawable": 970,                     // what Withdraw can ask for now
  "plan_draft": true                       // rates not signed off by HO → "Draft" tag
}
```

## `GET /commission/ledger`

`status` optional; newest order first; `limit` ≤ 200.

```jsonc
{
  "items": [
    {
      "id": "cm-KSK-4470", "order_id": "KSK-4470",
      "customer_id": "PII-1620690",        // null = shop stock
      "customer_name": "Ramesh Patel",     // "Self (shop stock)" for shop stock
      "order_value": 11980,                // the base
      "order_status": "delivered",         // the order's stage (ORDERS-APP.md)
      "rate": 7, "amount": 838,
      "cohort_id": "ec_paddy_belt",        // earning cohort when placed; null = before earning cohorts
      "plan_id": "ec_paddy_belt@2026-10",  // the plan the rate came from; null = built-in rates
      "below_min_order": false,            // true = under the cohort's minimum → earned the default cohort's rate
      "status": "confirmed",
      "paid_amount": 0,                    // covered by payouts so far
      "created_at": "…", "delivered_at": "…",
      "confirms_at": "…", "confirmed_at": "…",
      "paid_at": null, "withdrawal_id": null,
      "reversed_reason": null              // "cancelled" | "returned"
    }
  ],
  "page": 1, "limit": 50, "total": 15, "has_more": false,
  "totals": { … }                          // the whole ledger, as in summary
}
```

## An order's commission

On every `OrderView` (`GET /orders`, `/orders/:id`), and the same fields on a ledger row:

| Field | Rule |
|---|---|
| `base` | lines after discount and coins, before GST; no delivery |
| `rate` | the order's plan (its earning cohort when placed) at the slab of the month it was delivered in; this month's slab until then — so a pending amount can still move |
| `amount` | round(base × rate ÷ 100) |
| `status` | `pending` → `confirmed` at `confirms_at` → `paid`; `reversed` if cancelled / returned first |
| `confirms_at` | delivery + 7 days; `null` until delivered |
| `paid_at`, `withdrawal_id` | the payout that covered it |
| `reversed_reason` | `cancelled` / `returned` |

`commission: null` → hide it. `cohort_id`, `plan_id`, `below_min_order` are on ledger rows
only (not on `OrderView.commission`).

**"Earn ~₹X" with a minimum:** when `my_plan.min_order_value` is set and the cart's base
(price ÷ (1+GST), after discount) is below it, estimate with `my_plan.below_min_order`'s
slabs instead of `current_rate`.

## `GET /commission/plans`

```jsonc
{
  "my_cohort": "vistaar_agent",            // the partner type picked at signup
  "month": "2026-10",
  "my_plan": {                             // NEW — "My plan": what my new orders earn on now
    "earning_cohort": { "id": "ec_paddy_belt", "name": "Paddy belt", "since": "…" },  // null before approval
    "inherits": null,                      // null = the cohort's own plan (or not approved yet) · "ec_default" = the default cohort's · "partner_type" = my partner type's
    "plan_id": "ec_paddy_belt@2026-10",    // null = built-in rates
    "kind": "fixed",                       // fixed · slabs
    "draft": false, "effective_from": "2026-10",
    "slabs": [ { "from": 0, "to": null, "rate": 8 } ],   // fixed = one slab
    "min_order_value": 2000,               // ₹ of base; null = none
    "below_min_order": {                   // what an order under min_order_value earns on; null = no minimum
      "kind": "slabs",
      "slabs": [ { "from": 0, "to": 50000, "rate": 5 }, … ]
    },
    "notes": []
  },
  "plans": [                               // every partner type (Compare); they set only orders placed before my first earning cohort
    {
      "cohort": "vistaar_agent", "label": "Vistaar Agent",
      "kind": "slabs",
      "draft": true, "effective_from": null,     // null = the PRD's rates (no HO plan yet)
      "slabs": [
        { "from": 0, "to": 50000, "rate": 5 },
        { "from": 50000, "to": 100000, "rate": 7 },
        { "from": 100000, "to": null, "rate": 10 }   // to: null = no top
      ],
      "notes": ["The slab is decided by your delivered sales in the calendar month.", "…"]
    }
  ],
  "tds": { "rate_with_pan": 2, "rate_without_pan": 20, "section": "194H" },
  "min_withdrawal": 500,                   // also fills {min_withdrawal} in info pages
  "return_window_days": 7
}
```

Slab match: `from ≤ sales < to`.

**App change:** "My plan" reads `my_plan` (not `plans` by `my_cohort`). Show a fixed plan as
one "8 % on every order" line; show `min_order_value` as "Orders under ₹2,000 earn
5–10 %" from `below_min_order`. `inherits: "partner_type"` = HO has not priced the cohort
yet — the slabs shown are the partner type's. "Compare cohorts" (`plans`) now shows rates
that apply only to orders placed before earning cohorts: hide it, or label it so.

## Wallet

### `GET /wallet`

```jsonc
{
  "withdrawable": 970, "earned": 7180, "gig_earned": 0, "paid": 6210, "on_hold": 0,
  "min_withdrawal": 500,
  "tds_rate": 2,                           // what a withdrawal now would carry
  "pan_verified": true,
  "bank": { "account_holder": "Suresh Kumar", "account_last4": "4321", "ifsc": "SBIN0001234", "verified": true },
  "open_withdrawal": null,                 // the one in progress, if any (Withdrawal below)
  "can_withdraw": true,
  "blocked_reason": null                   // not_approved · bank_not_verified · withdrawal_open · below_minimum
}
```

### `POST /wallet/withdrawals` — `{ "amount": 970 }`

Whole ₹, ≥ `min_withdrawal`, ≤ `withdrawable`; one open request at a time. Answers the
**Withdrawal**:

```jsonc
{
  "id": "WD-000012", "amount": 970,
  "status": "requested",                   // requested · approved · paid · rejected · cancelled
  "tds_rate": 2, "tds_amount": 19.4, "net_amount": 950.6,   // fixed when HO approves
  "account_last4": "4321",
  "requested_at": "…", "approved_at": null, "paid_at": null,
  "utr": null,                             // the bank reference, once paid
  "rejected_at": null, "rejection_reason": null, "cancelled_at": null
}
```

The amount leaves `withdrawable` at once (`on_hold`). Rejected or cancelled → it comes back.
`GET /wallet` is always current; the commission summary, ledger and an order's
`paid` status may take up to a minute to show a payout HO just marked.

`GET /wallet/withdrawals?status=` — newest first. `DELETE /wallet/withdrawals/:id` —
only while `requested`; answers it as `cancelled`.

## Reports

### `GET /reports/commission-statement?month=2026-09`

Orders **placed** in the month (oldest first) with their commission; the app builds the CSV.

```jsonc
{
  "month": "2026-09",
  "rows": [
    { "order_id": "KSK-4470", "order_date": "2026-09-12", "customer_name": "Ramesh Patel",
      "order_value": 11980, "order_status": "delivered", "rate": 7, "amount": 838, "status": "confirmed" }
  ],
  "earned": 970, "pending": 1520, "reversed": 140,   // earned = confirmed + paid
  "tds_rate": 2, "tds": 19.4, "net_payable": 950.6  // at my real rate (PAN verified or not)
}
```

### `GET /reports/tds?quarter=FY2026-Q2`

TDS **actually deducted** at payout, by the month it was paid.

```jsonc
{
  "quarter": "FY2026-Q2", "deductor": "Katyayani Organics", "section": "194H",
  "pan_number": "ABCDE1234F",
  "months": [ { "month": "2026-07", "gross": 2400, "tds_rate": 2, "tds": 48, "net": 2352 }, … ],
  "total": { "gross": 7100, "tds": 142, "net": 6958 },
  "form16a_url": null                      // signed link (1 h) once HO uploads it
}
```

## Errors

| Code | HTTP | When / show |
|---|---|---|
| `VALIDATION_FAILED` | 400 | bad `status` / `month` / `quarter` / amount (the app spec's `INVALID_PERIOD` is this) |
| `BELOW_MIN_WITHDRAWAL` | 400 | amount < `min_withdrawal` |
| `NOT_ENOUGH_BALANCE` | 409 | amount > `withdrawable` (message names the maximum) |
| `WITHDRAWAL_OPEN` | 409 | one is already requested / approved |
| `BANK_NOT_VERIFIED` | 409 | HO has not verified the bank proof |
| `PARTNER_NOT_APPROVED` | 403 | not approved, or blocked |
| `WITHDRAWAL_CHANGED` | 409 | cancel after HO approved / closed it |
| `NOT_FOUND` | 404 | no such withdrawal of mine |
| `UNAUTHORIZED` | 401 | token expired |

## Not built yet

- Push on confirmed / reversed (`kind: commission`) — no push service yet; refresh the
  summary on app open instead.
- Partial returns: Stockship marks a whole order returned, so a return reverses the whole
  order's commission (when inside the window).
