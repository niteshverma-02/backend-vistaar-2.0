# Commission, payouts and performance (HO portal)

**Base URL:** `{API_BASE}/api/v2` · header `Authorization: Bearer <SSO access token>`.
For the remade Vistaar screens: **Commission plans**, **Payouts** (withdrawals, bank file,
TDS, Form 16A), a partner's **Commission** and **Performance** tabs, and the commission
settings. The rules are in COMMISSION-LOGIC.md; the app's side in COMMISSION-APP.md and
MY-PERFORMANCE-APP.md — HO sees the same numbers the partner does.

| Capability | Who (today) | Allows |
|---|---|---|
| `commission.read` | heads (USR-1037, 1000, 1001) | plans, withdrawals, payout totals, a partner's commission and performance |
| `commission.plans` | heads | add / change / delete plans |
| `payouts.manage` | heads — until Finance has a role code | approve, reject, mark paid; bank file (full account numbers); TDS listing; Form 16A |
| `agents.edit` | heads | a partner's monthly target |
| `settings.write` | heads | the commission settings |

Others get `403 NO_ADMIN_ACCESS` (no active Vistaar HO role — head / admin — or no
`agents_v2` account) or `403 ROLE_NOT_ALLOWED` (lacks this route's capability — by role, or
withheld by email in `access.domain.ts`).

## 1. Commission plans

A plan = one cohort's slabs **from a month on**, until that cohort's next plan. A cohort
with no plan earns at the PRD's rates (shown as a draft). Past months are **locked** (they
have been paid on): a change is made from this month or a later one.

| Method | Path | |
|---|---|---|
| GET | `/admin/commission-plans?cohort=&page=&limit=` | saved plans, by cohort, latest month first |
| GET | `/admin/commission-plans/in-effect?month=2026-10` | each active cohort's slabs in a month (default this month), with `plan_id` (`null` = PRD default) |
| GET | `/admin/commission-plans/:id` | one, with its change `history` |
| POST | `/admin/commission-plans` | add |
| PATCH | `/admin/commission-plans/:id` | change slabs / notes (this month or later) or sign off (`draft`, any plan) |
| DELETE | `/admin/commission-plans/:id` | this month or later only; the cohort goes back to its earlier plan |

`:id` = `<cohort>@<YYYY-MM>`, e.g. `vistaar_agent@2026-11`.

```jsonc
// POST body
{
  "cohort": "vistaar_agent",
  "effective_from": "2026-11",            // this month or later
  "slabs": [
    { "from": 0, "to": 50000, "rate": 5 },
    { "from": 50000, "to": 100000, "rate": 7 },
    { "from": 100000, "to": null, "rate": 10 }
  ],
  "notes": ["The slab is decided by your delivered sales in the calendar month."],  // optional; shown in the app
  "draft": true                            // optional, default true; false = signed off (the app drops the "Draft" tag)
}
```

Slabs: 1–10, the first from ₹0, each starting where the last ends, the last `to: null`,
rates 0–100 with ≤ 2 decimals. A plan answers with `id`, the fields above, `created_by`,
`updated_by`, `history` (every earlier state, oldest first: `at`, `by`, `action: "created" | "updated"`,
`slabs`, `notes`, `draft`) and
the timestamps. **Editor:** a slab table per cohort + month picker + notes + "Signed off"
toggle; show `in-effect` as "Current rates".

## 2. Payouts

The partner asks (`POST /wallet/withdrawals`); HO approves, pays from the bank file and
enters the UTR. HO never creates a withdrawal and never deletes one (it is the payment
record) — those two of CRUD are deliberately not offered.

```
requested ──approve──► approved ──paid (UTR)──► paid
    │  └──partner cancels──► cancelled
    └──reject──► rejected ◄──reject── approved
```

| Method | Path | |
|---|---|---|
| GET | `/admin/withdrawals?status=&agent_id=&page=&limit=` | a queue (`requested`, `approved`) oldest first; anything else newest first |
| GET | `/admin/withdrawals/totals` | cards: requested, approved (to pay), paid this month, paid this FY |
| GET | `/admin/withdrawals/:id` | one |
| POST | `/admin/withdrawals/:id/approve` | balance and bank proof checked again; TDS rate fixed |
| POST | `/admin/withdrawals/:id/reject` | `{ "reason": "…" }` (shown to the partner); requested or approved |
| GET | `/admin/withdrawals/payout-file` | approved withdrawals as a bank CSV |
| POST | `/admin/withdrawals/:id/paid` | `{ "utr": "SBIN526287123456", "paid_at": "…" }` (`paid_at` optional, not in the future) |
| POST | `/admin/withdrawals/paid` | many at once: `{ "items": [ { "id": "WD-000012", "utr": "…" } ], "paid_at": "…" }` (≤ 200) |

**Withdrawal (HO):** the app's Withdrawal (COMMISSION-APP.md) plus `agent_id`,
`partner { name, phone, cohort }`, `approved_by`, `paid_by`, `rejected_by`.

**Totals:** `{ requested: { count, amount }, approved: { count, amount, tds, net },
paid_this_month: {…}, paid_this_fy: {…} }` — `amount` is before TDS, `net` is what the
bank sends.

**Bank file** (`payout-file`): `{ file_name, content_type: "text/csv", rows, total_net,
content, skipped[] }` — save `content` as `file_name`. Columns: `withdrawal_id, agent_id,
partner_name, account_holder, account_number, ifsc, amount, tds, net_amount, requested_at`
(generic; send the bank's own template when Finance picks a bank and it is mapped). An
approved withdrawal whose form has no account number / IFSC is in `skipped` with the
reason, not in the file. At most 500 per file. The file holds full account numbers: keep it
behind `payouts.manage` and do not store it in the browser.

**Batch paid** answers `{ paid, results: [ { id, ok, error } ] }` — each line succeeds or
fails on its own (e.g. already paid).

## 3. TDS and Form 16A

| Method | Path | |
|---|---|---|
| GET | `/admin/tds?quarter=FY2026-Q2&agent_id=&page=&limit=` | per partner: `name`, `pan_number`, `payouts`, `gross`, `tds`, `net`, `form16a { uploaded_at, url } \| null` — plus `quarter`, `deductor`, `section` — for the TDS return |
| GET | `/admin/tds/certificates?quarter=FY2026-Q2&agent_id=&page=&limit=` | `quarter` required; `PageResult` of `{ agent_id, quarter, url: string \| null, uploaded_by, uploaded_at }` (`url` signed, 1 h) |
| PUT | `/admin/tds/certificates/:agentId/:quarter` | upload or replace — multipart `file`, **PDF ≤ 5 MB** |
| DELETE | `/admin/tds/certificates/:agentId/:quarter` | remove |

TDS counts by the month a withdrawal was **paid**. The partner sees their Form 16A in
`GET /reports/tds` once uploaded. Files are private under `KO-documents/<pii_id>/form16a/`.

## 4. Partners table (Commission, Sales Summary)

`GET /admin/performance?month=2026-10&cohort=&state=&district=&q=&page=&limit=`
(`commission.read`) — approved partners, newest approval first, one row each for the
month (default this month):

```ts
interface PartnerMonthRow {
  agent_id: string; name: string | null; cohort: string;
  district: string | null; state: string | null;
  month: string;              // YYYY-MM
  sales: number;              // delivered sales before GST in the month
  rate: number;               // slab % reached
  commission: number;         // sales × rate
  orders_placed: number;      // in the month
  monthly_target: number; achieved_pct: number;   // pct ≤ 100
  earned: number;             // all-time confirmed + paid commission (+ approved gigs when gig pay is on)
  withdrawable: number; pending: number;
  last_order_at: string | null;
  lifecycle_stage: "onboarded" | "active" | "at_risk" | "lost";
  tier: "bronze" | "silver" | "gold" | "platinum";
}
```

Each row is the partner's own commission book (the app's numbers), so `limit` is
capped at 50. Totals across partners: `GET /admin/orders/summary?from=&to=` (orders, value,
partners ordering) and `GET /admin/agents/summary` (partners by stage) — not the sum of
a page.

### Board — every partner at once

`GET /admin/performance/board?month=2026-10` (`commission.read`) — for the cross-partner
widgets: wallet bands, target bands, biggest wallets, top sellers, the Activity wallet /
target columns, Payouts wallet sizes. Every approved partner's row for the month
(default this month), worked out from their own book — the same numbers as the app and
as `/admin/performance`:

```ts
interface CommissionBoard {
  month: string;              // YYYY-MM
  computed_at: string;        // when this copy was worked out
  partners: number;           // rows
  failed: number;             // partners whose book could not be read (left out)
  totals: { sales: number; commission: number; earned: number;
            withdrawable: number; pending: number; paid: number };
  rows: (PartnerMonthRow & {
    paid: number;             // all-time commission paid out
    farmers: number;          // leads they hold now
    customers: number;        // of those, at won
  })[];                       // newest approval first; sort and band on the screen
}
```

Worked out only when HO opens it and **kept 10 minutes** per month (per server process),
so a just-approved withdrawal or a new order can take up to 10 minutes to show here; the
partner's own screens (§5) are always current. Not paged — one row per approved partner.

## 5. One partner

| Method | Path | |
|---|---|---|
| GET | `/admin/commission/partners/:agentId?status=&page=&limit=` | `{ partner, summary, wallet, ledger }` — the app's summary, wallet and ledger for that partner; `summary` and `wallet` carry `gig_earned` (approved meeting gigs' pay inside `earned`, 0 while gig pay is off) |
| GET | `/admin/performance/:agentId?period=month\|3m\|fy` | their My Performance (MY-PERFORMANCE-APP.md) |
| PUT | `/admin/performance/:agentId/target` | `{ "monthly_target": 150000 }` sets their own target; `null` puts them back on the default. Answers `{ agent_id, own_target }` |

An order's commission is also on `GET /admin/orders/:id` (ORDERS-HO.md).

## 6. Settings

`PUT /admin/settings` (`settings.write`) — the commission fields:

| Field | Default | Range | Meaning |
|---|---|---|---|
| `return_window_days` | 7 | 0–30 | days after delivery before commission is confirmed |
| `min_withdrawal` | 500 | 1–1,00,000 | smallest withdrawal (₹) |
| `tds_rate_with_pan` | 2 | 0–30, ≤ 2 decimals | TDS % with a verified PAN |
| `tds_rate_without_pan` | 20 | 0–40, ≤ 2 decimals | TDS % without |
| `monthly_target` | 1,00,000 | 1–10,00,00,000 | default monthly target (₹ delivered sales) |
| `gig_pay_enabled` | false | true / false | approved meeting gigs' pay reaches the wallet (COMMISSION-LOGIC.md, *Meeting gigs*) |

Changing `return_window_days` moves the confirm date of orders not yet confirmed.

## Errors

| Code | HTTP | When |
|---|---|---|
| `VALIDATION_FAILED` | 400 | bad slabs (the message says which), month, quarter, UTR, date |
| `COHORT_NOT_FOUND` | 400 | plan for a cohort that does not exist |
| `PLAN_EXISTS` | 409 | that cohort already has a plan from that month |
| `PLAN_LOCKED` | 409 | slabs / notes / delete on a past month's plan; or a past `effective_from` |
| `VERSION_CONFLICT` | 409 | PATCH / DELETE raced another change to the same plan at that moment — reload and retry. No version is sent: a change made after the editor opened is not detected |
| `WITHDRAWAL_CHANGED` | 409 | not in a state for that action (e.g. pay a requested one, approve a paid one) |
| `NOT_ENOUGH_BALANCE` | 409 | approve: the partner's balance fell below the request (a rate fell) — reject it |
| `BANK_NOT_VERIFIED` | 409 | approve: the bank proof is not verified |
| `FILE_REQUIRED`, `FILE_TYPE_NOT_ALLOWED`, `FILE_TOO_LARGE` | 400 / 413 | Form 16A upload |
| `NOT_FOUND` | 404 | no such plan / withdrawal / partner / certificate |
