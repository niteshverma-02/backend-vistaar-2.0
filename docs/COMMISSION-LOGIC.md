# Commission: how it works

Shared ground for the app (COMMISSION-APP.md), HO (COMMISSION-HO.md) and Finance.
Settled 2026-10-14 from the PRD, the Lovable screens and the app's spec (Lovable wins
where they differ), plus the decisions below. Code: `src/modules/commission/commission.domain.ts`.

## In 30 seconds

- A partner earns a **% of each order** they place in the app — for a farmer or for their
  own shop stock. Farmers' own app / KKD orders earn nothing.
- The % comes from a **slab**: the more the partner's orders **delivered in the IST calendar
  month**, the higher the %, and the **whole month earns the slab reached**.
- Whose slabs: the plan of the partner's **earning cohort when the order was placed**
  (EARNINGS-HO.md) — a fixed % or slabs, optionally with a minimum order value. Orders placed
  before the partner's first earning cohort keep the partner-type plan, so past numbers
  never change.
- Money moves **Pending** (placed) → **Confirmed** (7 days after delivery) → **Paid**
  (withdrawn). Cancelled or returned before it is confirmed → **Reversed**.
- Once confirmed it is **final**: a later return takes nothing back.
- The partner withdraws confirmed money (≥ ₹500); HO pays from a bank file; TDS 194H is
  cut — 2% with a verified PAN, else 20%.

## The rules

| # | Rule |
|---|---|
| R1 | **Base** = the order's lines after discount and coins, **before GST**. Delivery and other charges are not part of it. Discount and coins come off each line by its share of the value; then each line's own GST (its bulk's `gst_rate`) is taken out. A pack whose GST the catalogue does not know is taken at 18%, so commission is never overpaid |
| R2 | **Month sales** = Σ base of the partner's orders **delivered** in the IST month, not counting reversed ones |
| R3 | **Rate** = the slab month sales reach on the **order's plan** (R3a); **every** order delivered that month is at the slab its month reached (retro). An order not delivered yet shows **this month's** slab |
| R3a | **The order's plan** — see *Earning cohorts* below. In short: the plan of the earning cohort the partner was in **when the order was placed**, for the **month it was placed**; below that plan's `min_order_value` → the default cohort's (`ec_default`) plan; placed before the partner's first earning cohort → the **partner-type** plan of the rate month (the rule before 2026-10-16) |
| R4 | **Amount** = round(base × rate ÷ 100), whole ₹ |
| R5 | **Pending** from placing · **Confirmed** at delivery + `return_window_days` (7) · **Reversed** if cancelled / returned before that · **Paid** once withdrawals cover it |
| R6 | Confirmed is **final** — a return after the window changes nothing (user, 2026-10-14) |
| R7 | Not counted at all: Stockship's `failed` / `pseudo` rows, a `split` parent (its `-S1` / `-S2` children carry the lines) and an order `merged` into another |
| R8 | Shop stock (the partner's own `pii_id`) earns the normal rate |

### Partner-type slabs (PRD; drafts until HO signs them off)

| Partner type | ₹0 – 50K | ₹50K – 1L | > ₹1L |
|---|---|---|---|
| `vistaar_agent`, `ex_employee` | 5% | 7% | 10% |
| `other_company_employee`, `other` | 5% | 7% | 7% |
| `consultant` | 6% | 8% | 8% |

A partner type HO adds later earns as `other` until it has a plan. HO changes rates by adding a
plan from a month on (this month or later — past months are locked). Since 2026-10-16 these
partner-type plans set only orders placed **before** the partner's first earning cohort.

## Example — the retro slab (Vistaar Agent, October)

| Event | Oct delivered sales | Every Oct order's rate |
|---|---|---|
| A delivered, base ₹30,000 | 30,000 | 5% → A ₹1,500 |
| B delivered, base ₹40,000 | 70,000 | 7% → A ₹2,100, B ₹2,800 |
| C placed, not delivered | 70,000 | C shows 7% (this month's), pending |

A rate that rises after a payout owes the partner the difference (it shows in
`withdrawable`). A rate that falls (a same-month return before its window) takes nothing
back: the payout is only not made twice.

## Earning cohorts (user + TL, 2026-10-16)

Every approved partner is in exactly one **earning cohort** (HO-built, EARNINGS-HO.md; not
the partner type). Commission follows the cohort they were in **when the order was placed**
(`orders_v2.date`, else `created_at`), from `vistaar_v2_earning_assignments` — so a later
move never changes an order already placed.

Each earning cohort has plans in the same `vistaar_v2_commission_plans`, keyed
`ec_<id>@<YYYY-MM>`, from a month on, locked once past, with history:

| Plan field | Rule |
|---|---|
| `kind: "fixed"` | one % on every order whatever the month's sales — stored as one slab `{ from: 0, to: null, rate }` |
| `kind: "slabs"` | slabs as for partner types; the slab is reached by the partner's **whole** delivered sales of the month (R2), whatever cohort each order was in |
| `min_order_value` | ₹ of **base** (R1, whole ₹) an order needs to earn on this plan; below it the order earns the **default cohort's** plan for that month. `null` = none. Not allowed on `ec_default` or a partner type |

**Which plan an order earns on** (`orderPlan` in `commission.domain.ts`):

1. Cohort = the stretch the partner was in at the order's placing. None (placed before their
   first assignment) → the partner-type plan of the rate month, exactly as before.
2. Plan = that cohort's plan in effect in the **month placed**; none saved by then → the
   default cohort's (`ec_default`) plan of that month.
3. `min_order_value` set and base below it → `ec_default`'s plan of that month.
4. Still no plan (no earning plan saved at all) → the partner-type plan of the rate month.
5. Rate = the slab the rate month's delivered sales reach **on that plan** (R3) — so two
   orders delivered in one month can earn different % (one in a cohort with a fixed 8 %,
   one below its minimum on the default 5 / 7 / 10 slabs).

Step 4 means **nothing changes for anyone until HO saves an earning plan**: until then
every partner keeps their own partner-type plan (5 / 7 / 10 for Vistaar Agent and
Ex-employee, 6 / 8 / 8 for Consultant, …). Save an `ec_default` plan to move everyone else
onto one plan.

The month's **headline** (summary `current_rate`, `next_slab`, `plan_draft`; My Performance
`monthly[].rate`, HO's `rate` column) is the plan a new order would earn on: the cohort the
partner is in at the month's end (now, for this month), before any minimum check. A month's
**commission** — `month_commission_estimate`, My Performance `commission`, HO's partner
table and board — is the sum of each delivered order's own commission, not sales × one rate.

Each ledger row says which: `cohort_id` (`null` = before earning cohorts), `plan_id`
(`null` = PRD built-in rates), `below_min_order`.

Example — Ravi (Vistaar Agent) in `ec_paddy` (fixed 8 %, minimum ₹2,000) from 10 Oct;
`ec_default` has 5 / 7 / 10 slabs saved; all three orders delivered in October:

| Order | Placed | Base | Plan | Rate |
|---|---|---|---|---|
| A | 3 Oct (before 10 Oct) | 10,000 | his partner-type plan, Oct sales 31,500 | 5 % |
| B | 12 Oct | 20,000 | `ec_paddy@2026-10` | 8 % |
| C | 15 Oct | 1,500 | below ₹2,000 → `ec_default@2026-10`, Oct sales 31,500 | 5 % |

## Money

| | |
|---|---|
| Earned | Σ confirmed + paid amounts, at today's rates, + approved meeting gigs and follow-up gig rewards (when gig pay is on) |
| Paid | Σ withdrawals marked paid |
| On hold | Σ withdrawals requested or approved |
| **Withdrawable** | confirmed amounts not yet covered by a payout − on hold (never below 0) |

Payouts cover confirmed orders oldest-confirmed first; an order is **paid** once covered. A
payout covers only what had confirmed by its paid date; what is left of it (a rate that fell
after it) is not netted from later orders, which stay unpaid and withdrawable in full.

**Withdrawal:** ≥ `min_withdrawal` (₹500), ≤ withdrawable, one open at a time, partner
approved, bank proof verified by HO. **TDS** at request, fixed at approval: 2% with a
verified PAN, else 20% (settings). Approved by a head (USR-1037/1000/1001) until Finance has
a role code; paid by bank file + UTR (no payout API).

## Gigs (meeting gigs and follow-up gig rewards)

Gig pay comes from two places, treated alike: approved **meeting gigs** (`vistaar_v2_gigs`,
GIGS-HO.md) and approved **follow-up gig rewards** (`vistaar_v2_rewards`, `kind: 'gig'`,
earned by the earning rules — EARNINGS-HO.md). **Coins never enter the wallet.**

**Off by default** — settings `gig_pay_enabled` (`false`) until Finance confirms the TDS
section (user, 2026-10-15); one switch for both. While off the book is exactly as above.

When on, each approved gig's (or gig reward's) pay is **earned at approval**
(`reviewed_at`; confirmed at once, no pending) and final — no reversal. It adds to `earned` and `withdrawable`, and shows as
`gig_earned`; it has no ledger row (the ledger stays orders). Payouts cover orders and
gigs together in time order — an order by its confirm date, a gig by its approval — so
a gig approved later never moves an order already paid. Gigs approved while it was off
count from the moment it was first switched on (`gig_pay_enabled_at`, set once), so a
payout made while it was off stays on the orders it paid. A withdrawal carries the
**same TDS** as the rest (2% / 20%, 194H) until Finance says otherwise.

## How it is built

Nothing is stored per order. Each read works the book out from `orders_v2` (read-only,
marketplace MKTP-5): a status change at the warehouse needs no job, no sync and no month-end
fix-up, and there is nothing to drift.

| Piece | Where |
|---|---|
| The partner's orders | one aggregation on `{ agent, order_status, date }`, cached 60 s per partner (shared by every screen in that minute) |
| GST and categories | the catalogue in memory (`ProductFactsService`, hourly) |
| Plans | `vistaar_v2_commission_plans`, in memory (60 s) |
| Withdrawals | `vistaar_v2_withdrawals` (tens of rows per partner), cached 60 s per partner for display, read fresh before money moves (wallet, withdraw, HO approve) |
| Gig pay | `vistaar_v2_gigs` (approved) and `vistaar_v2_rewards` (approved, `kind: 'gig'`), read only while gig pay is on, cached like withdrawals |
| Earning-cohort stretches | `vistaar_v2_earning_assignments` (a few rows per partner), cached like withdrawals — an order placed in the minute after a move may show the old cohort's rate until then |
| Form 16A | `vistaar_v2_tds_certificates` + a private PDF |

## Not built (later)

- Push notifications on confirmed / reversed (`kind: commission`) — no push service yet.
- Emailed PDF of My Performance (`POST /performance/report`) — no email service yet.
- The TDS yearly threshold — the user chose "always 2% / 20%".
