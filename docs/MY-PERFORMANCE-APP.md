# My Performance and standing (Vistaar app)

**Base URL:** `{API_BASE}/api/v2` · bearer = partner `access_token` (AUTH-APP.md).
The **My Performance** screen and the tier / stage / health shown on Home and Profile.
Read-only; every number is worked out from the partner's own orders, leads and attendance
when asked. Sales are **delivered** sales before GST — the same numbers commission uses
(COMMISSION-LOGIC.md).

| Method | Path | Screen |
|---|---|---|
| GET | `/performance?period=month\|3m\|fy` | My Performance |
| GET | `/performance/standing` | Home, Profile (replaces the spec's "fields on the login object") |

`period`: `month` (this month) · `3m` (the last 3 months with this one) · `fy` (April →
this month). Default `month`.

## `GET /performance/standing`

Cached up to 5 minutes; call on app open.

```json
{ "cohort": "vistaar_agent", "tier": "silver", "lifecycle_stage": "active",
  "health_score": 80, "monthly_target": 100000 }
```

## `GET /performance?period=3m`

```jsonc
{
  "period": "3m",
  "from": "2026-08-01", "to": "2026-11-01",        // first day, and the day after the end
  "first_app_order_at": "2026-06-04T04:30:00Z",    // "counts cover app orders from <month>"
  "sales":            { "value": 186000, "previous": 150000 },  // previous: same span just before; null for fy
  "target":           { "value": 300000, "achieved_pct": 62 },  // monthly_target × months; pct ≤ 100
  "orders_placed":    { "value": 21, "previous": 17 },
  "active_customers": { "value": 14, "previous": 11 },          // farmers ordered for, not cancelled
  "lead_conversion":  { "total": 10, "won": 6, "lost": 2, "pct": 60 },  // leads added in the period
  "gigs": null,                                                  // until Meetings exists
  "commission":       { "value": 12900, "draft_rate": true },
  "monthly": [                                                   // every month of this FY
    { "month": "2026-08", "sales": 54000, "rate": 7, "commission": 3780, "in_period": true }
  ],
  "by_category":  [ { "name": "Disease Control", "value": 52000, "pct": 38 } ],   // all, largest first
  "top_products": [ { "sku": "K-489", "name": "AZODHARMA …", "image": "https://…", "qty": 18, "value": 21400 } ], // top 4
  "tier": { "current": "silver", "next": "gold", "avg_3m_sales": 62000,
            "current_min": 50000, "next_min": 100000, "progress_pct": 24 },
  "health": {
    "score": 80,
    "factors": [
      { "key": "days_since_last_order", "value": 3, "good": true },
      { "key": "orders_this_month", "value": 5, "good": true },
      { "key": "training_completed", "value": 0, "total": 0, "good": true },
      { "key": "field_days_logged", "value": 6, "good": true },
      { "key": "overdue_follow_ups", "value": 1, "good": false }
    ]
  },
  "lifecycle_stage": "active",
  "monthly_target": 100000
}
```

| Number | Rule |
|---|---|
| `sales`, `monthly[].sales` | base of orders **delivered** in the month, reversed ones left out |
| `orders_placed` | live orders placed in the period (cancelled included; failed / split / merged rows are not orders) |
| `active_customers` | distinct farmers with a non-cancelled order placed in the period (shop stock is not a customer) |
| `lead_conversion.pct` | won ÷ **all** leads added in the period (the Leads tile's rule); `null` with none |
| `commission.value` | Σ month sales × that month's rate |
| `by_category`, `top_products` | lines of orders delivered in the period, by catalogue category ("Other" when the bulk has none) and by pack |
| `tier` | average delivered sales of the **3 completed months** before this one (so a tier does not drop on the 1st): Bronze 0 · Silver 50K · Gold 1L · Platinum 2.5L; `progress_pct` towards the next, ≤ 100 |
| `lifecycle_stage` | `onboarded` (no order yet) · `active` · `at_risk` (30+ days since the last order) · `lost` (90+) |
| `health` | 20 points each: last order ≤ 7 days · ≥ 4 orders this month · ≥ half of open courses done · ≥ 4 field days (attendance punch-ins) this month · no overdue follow-up |
| `monthly_target` | HO sets it per partner, else the settings default (₹1,00,000) |

**Training:** no courses exist in the backend yet, so `training_completed` is `0 / 0` and
counts as good (no open course left undone).

## Not built yet

- `POST /performance/report` (emailed PDF) — needs an email service; the screen's
  "Export PDF" stays hidden until then.
- `gigs` — comes with Meetings; `null` until then.

## Errors

`VALIDATION_FAILED` (400) for a `period` other than `month`, `3m`, `fy` (the spec's
`INVALID_PERIOD`); `401` when the token expired.
