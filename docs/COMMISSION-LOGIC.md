# Commission: how it works

Shared ground for the app (COMMISSION-APP.md), HO (COMMISSION-HO.md) and Finance.
Settled 2026-10-14 from the PRD, the Lovable screens and the app's spec (Lovable wins
where they differ), plus the decisions below. Code: `src/modules/commission/commission.domain.ts`.

## In 30 seconds

- A partner earns a **% of each order** they place in the app — for a farmer or for their
  own shop stock. Farmers' own app / KKD orders earn nothing.
- The % comes from a **slab**: the more the partner's orders **delivered in the IST calendar
  month**, the higher the %, and the **whole month earns the slab reached**.
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
| R3 | **Rate** = the slab month sales reach on the partner's cohort plan for that month; **every** order delivered that month earns it (retro). An order not delivered yet shows **this month's** rate |
| R4 | **Amount** = round(base × rate ÷ 100), whole ₹ |
| R5 | **Pending** from placing · **Confirmed** at delivery + `return_window_days` (7) · **Reversed** if cancelled / returned before that · **Paid** once withdrawals cover it |
| R6 | Confirmed is **final** — a return after the window changes nothing (user, 2026-10-14) |
| R7 | Not counted at all: Stockship's `failed` / `pseudo` rows, a `split` parent (its `-S1` / `-S2` children carry the lines) and an order `merged` into another |
| R8 | Shop stock (the partner's own `pii_id`) earns the normal rate |

### Slabs (PRD; drafts until HO signs them off)

| Cohort | ₹0 – 50K | ₹50K – 1L | > ₹1L |
|---|---|---|---|
| `vistaar_agent`, `ex_employee` | 5% | 7% | 10% |
| `other_company_employee`, `other` | 5% | 7% | 7% |
| `consultant` | 6% | 8% | 8% |

A cohort HO adds later earns as `other` until it has a plan. HO changes rates by adding a
plan from a month on (this month or later — past months are locked).

## Example (Vistaar Agent, October)

| Event | Oct delivered sales | Every Oct order's rate |
|---|---|---|
| A delivered, base ₹30,000 | 30,000 | 5% → A ₹1,500 |
| B delivered, base ₹40,000 | 70,000 | 7% → A ₹2,100, B ₹2,800 |
| C placed, not delivered | 70,000 | C shows 7% (this month's), pending |

A rate that rises after a payout owes the partner the difference (it shows in
`withdrawable`). A rate that falls (a same-month return before its window) takes nothing
back: the payout is only not made twice.

## Money

| | |
|---|---|
| Earned | Σ confirmed + paid amounts, at today's rates, + approved meeting gigs (when gig pay is on) |
| Paid | Σ withdrawals marked paid |
| On hold | Σ withdrawals requested or approved |
| **Withdrawable** | earned − paid − on hold (never below 0) |

Payouts cover confirmed orders oldest-confirmed first; an order is **paid** once covered.

**Withdrawal:** ≥ `min_withdrawal` (₹500), ≤ withdrawable, one open at a time, partner
approved, bank proof verified by HO. **TDS** at request, fixed at approval: 2% with a
verified PAN, else 20% (settings). Approved by a head (USR-1037/1000/1001) until Finance has
a role code; paid by bank file + UTR (no payout API).

## Meeting gigs

**Off by default** — settings `gig_pay_enabled` (`false`) until Finance confirms the TDS
section (user, 2026-10-15). While off the book is exactly as above.

When on, each approved gig's pay is **earned at approval** (confirmed at once, no
pending) and final — no reversal. It adds to `earned` and `withdrawable`, and shows as
`gig_earned`; it has no ledger row (the ledger stays orders). Payouts cover orders and
gigs together in time order — an order by its confirm date, a gig by its approval — so
a gig approved later never moves an order already paid. Gigs approved while it was off
count from the moment it was first switched on (`gig_pay_enabled_at`, set once), so a
payout made while it was off stays on the orders it paid. A withdrawal carries the
**same TDS** as the rest (2% / 20%, 194H) until Finance says otherwise.
Gigs: `vistaar_v2_gigs`, read only when on, cached 60 s like withdrawals, fresh before
money moves.

## How it is built

Nothing is stored per order. Each read works the book out from `orders_v2` (read-only,
source vistaar): a status change at the warehouse needs no job, no sync and no month-end
fix-up, and there is nothing to drift.

| Piece | Where |
|---|---|
| The partner's orders | one aggregation on `{ agent, order_status, date }`, cached 60 s per partner (shared by every screen in that minute) |
| GST and categories | the catalogue in memory (`ProductFactsService`, hourly) |
| Plans | `vistaar_v2_commission_plans`, in memory (60 s) |
| Withdrawals | `vistaar_v2_withdrawals`, read fresh (tens of rows per partner) |
| Form 16A | `vistaar_v2_tds_certificates` + a private PDF |

## Not built (later)

- Push notifications on confirmed / reversed (`kind: commission`) — no push service yet.
- Emailed PDF of My Performance (`POST /performance/report`) — no email service yet.
- The TDS yearly threshold — the user chose "always 2% / 20%".
