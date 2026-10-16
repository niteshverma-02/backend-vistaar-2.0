import {
  addMonths,
  DAY_MS,
  istMonthKey,
  istMonthStart,
} from '@common/utils/ist-day.util';
import { DEFAULT_COHORT_ID, cohortAtIn } from '@modules/earning/earning.domain';
import {
  SELF_LABEL,
  stageOf,
  type OrderStage,
} from '@modules/orders/orders.domain';

/**
 * Commission rules (PRD, Lovable and the app's spec; Lovable wins where they
 * differ — settled 2026-10-14). Pure: the services fetch, this decides.
 *
 * - **Base** = the order's lines after discount and coins, before GST;
 *   delivery and other charges are not part of it.
 * - **Rate** = the slab the partner's **delivered** sales in the IST calendar
 *   month reach, on the order's plan; the whole month earns that slab
 *   (retro). An order not yet delivered shows this month's slab.
 * - **Plan** (earning cohorts, user + TL 2026-10-16) = the plan of the
 *   earning cohort the partner was in when the order was placed, for the
 *   month it was placed; below that plan's minimum order value, the default
 *   cohort's. An order placed before the partner's first earning cohort — or
 *   when no earning plan is saved — keeps the partner-type plan, so past
 *   numbers never change.
 * - **Status**: `pending` from placing; `confirmed` once the return window
 *   after delivery has closed, and then final — a later return takes nothing
 *   back (user, 2026-10-14); `reversed` if cancelled or returned before;
 *   `paid` once withdrawals cover it.
 * - Nothing is stored per order: the ledger is derived from `orders_v2` on
 *   each read, so a status change at the warehouse needs no job here.
 */
export const COMMISSION_STATUSES = [
  'pending',
  'confirmed',
  'paid',
  'reversed',
] as const;
export type CommissionStatus = (typeof COMMISSION_STATUSES)[number];

export interface Slab {
  /** ₹ of delivered sales in the month, included. */
  from: number;
  /** Excluded; `null` = no top. */
  to: number | null;
  /** %. */
  rate: number;
}

/** `fixed` = one rate whatever the month's sales: stored as one slab from ₹0 with no top. */
export const PLAN_KINDS = ['slabs', 'fixed'] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];

export interface PlanTerms {
  kind: PlanKind;
  slabs: Slab[];
  /**
   * ₹ of base an order needs to earn on this plan; below it the order earns
   * the default earning cohort's plan. `null` = no minimum. Earning cohorts only.
   */
  min_order_value: number | null;
  notes: string[];
  /** Rates not signed off by HO yet — the app shows a "Draft" tag. */
  draft: boolean;
}

/** A cohort's terms for one month, and the stored plan they come from (`null` = the PRD's). */
export interface PlanInEffect extends PlanTerms {
  /** A partner type (`vistaar_agent`) or an earning cohort (`ec_…`). */
  cohort: string;
  plan_id: string | null;
  effective_from: string | null;
}

/**
 * Where an earning cohort's rates come from when it has no plan of its own
 * by that month: the default cohort's plan, or — none saved there either —
 * each partner's partner-type plan.
 */
export const PLAN_INHERITS = ['ec_default', 'partner_type'] as const;
export type PlanInherit = (typeof PLAN_INHERITS)[number];

const bands = (low: number, mid: number, top: number): Slab[] => [
  { from: 0, to: 50_000, rate: low },
  { from: 50_000, to: 100_000, rate: mid },
  { from: 100_000, to: null, rate: top },
];

/** The PRD's rates per cohort, until HO saves a plan of its own. */
export const DEFAULT_SLABS: Readonly<Record<string, Slab[]>> = {
  vistaar_agent: bands(5, 7, 10),
  ex_employee: bands(5, 7, 10),
  other_company_employee: bands(5, 7, 7),
  other: bands(5, 7, 7),
  consultant: bands(6, 8, 8),
};

/** A cohort HO added later, with no plan yet, earns as `other`. */
export const FALLBACK_COHORT = 'other';

export const DEFAULT_NOTES: readonly string[] = [
  'The slab is decided by your delivered sales in the calendar month.',
  'The whole month earns the rate of the slab you reach.',
  'Commission is on the order value after discount and coins, before GST. Delivery is not included.',
];

/** The PRD's plan for a cohort — a draft, since HO has not signed it off. */
export function defaultPlan(cohort: string): PlanTerms {
  return {
    kind: 'slabs',
    slabs: DEFAULT_SLABS[cohort] ?? DEFAULT_SLABS[FALLBACK_COHORT],
    min_order_value: null,
    notes: [...DEFAULT_NOTES],
    draft: true,
  };
}

/** A pack whose GST the catalogue does not know is taken at the highest common rate, so commission is never overpaid. */
export const UNKNOWN_GST_RATE = 18;

export const MAX_SLABS = 10;
export const MAX_MIN_ORDER_VALUE = 1_000_000;

/** `ec_…` ids are earning cohorts; anything else is a partner type (onboarding cohort). */
export const isEarningCohort = (cohort: string): boolean =>
  cohort.startsWith('ec_');

/**
 * The slabs a plan of `kind` stores, or why the terms cannot be a plan. A
 * fixed plan is sent as one `rate`; a slab plan as its `slabs`.
 */
export function planSlabs(
  kind: PlanKind,
  input: { slabs?: readonly Slab[]; rate?: number },
): { slabs: Slab[] } | { error: string } {
  if (kind === 'fixed') {
    if (input.slabs !== undefined)
      return { error: 'A fixed plan takes one `rate`, not `slabs`.' };
    if (input.rate === undefined)
      return { error: 'A fixed plan needs its `rate`.' };
    const slabs: Slab[] = [{ from: 0, to: null, rate: input.rate }];
    const problem = slabsProblem(slabs);
    return problem
      ? {
          error: problem.replace(/^Slab 1: (.)/, (_m, c: string) =>
            c.toUpperCase(),
          ),
        }
      : { slabs };
  }
  if (input.rate !== undefined)
    return {
      error: 'A slab plan takes `slabs`, not one `rate` — or choose "fixed".',
    };
  if (input.slabs === undefined)
    return { error: 'A slab plan needs its `slabs`.' };
  const slabs = input.slabs.map((s) => ({
    from: s.from,
    to: s.to ?? null,
    rate: s.rate,
  }));
  const problem = slabsProblem(slabs);
  return problem ? { error: problem } : { slabs };
}

/** Why these slabs cannot be a plan, or `null` when they can. */
export function slabsProblem(slabs: readonly Slab[]): string | null {
  if (slabs.length === 0 || slabs.length > MAX_SLABS)
    return `A plan needs 1 to ${MAX_SLABS} slabs.`;
  if (slabs[0].from !== 0) return 'The first slab must start at ₹0.';
  for (const [i, s] of slabs.entries()) {
    const last = i === slabs.length - 1;
    if (!Number.isFinite(s.rate) || s.rate < 0 || s.rate > 100)
      return `Slab ${i + 1}: the rate must be between 0 and 100%.`;
    // 1.1 × 100 is 110.00000000000001 in floating point: compare with a tolerance.
    if (Math.abs(s.rate * 100 - Math.round(s.rate * 100)) > 1e-6)
      return `Slab ${i + 1}: use at most two decimals in the rate.`;
    if (last && s.to !== null)
      return 'The last slab must have no upper limit (to: null).';
    if (!last && (s.to === null || s.to <= s.from))
      return `Slab ${i + 1}: "to" must be more than "from".`;
    if (!last && slabs[i + 1].from !== s.to)
      return `Slab ${i + 2} must start where slab ${i + 1} ends (₹${s.to}).`;
  }
  return null;
}

/** The slab `sales` falls in: `from ≤ sales < to`. */
export function slabFor(slabs: readonly Slab[], sales: number): Slab {
  return (
    slabs.find((s) => sales >= s.from && (s.to === null || sales < s.to)) ??
    slabs[slabs.length - 1]
  );
}

/** The next slab up and the ₹ of sales still needed; `null` on the top slab. */
export function nextSlab(
  slabs: readonly Slab[],
  sales: number,
): { rate: number; gap: number } | null {
  const i = slabs.indexOf(slabFor(slabs, sales));
  const next = slabs[i + 1];
  return next ? { rate: next.rate, gap: Math.max(0, next.from - sales) } : null;
}

export const commissionOf = (base: number, rate: number): number =>
  Math.round((base * rate) / 100);

/** One order as `orders_v2` holds it, reduced to what commission reads. */
export interface OrderFact {
  order_id: string;
  placed_at: Date;
  /** The buyer; the partner's own `pii_id` (or none) = shop stock. */
  pii_id: string | null;
  customer_name: string;
  order_status: string;
  lines: { sku: string; qty: number; total: number; free: boolean }[];
  /** Σ discounts + coins: they come off the lines before GST. */
  deduction: number;
  delivered_at: Date | null;
  /** When it was cancelled or returned. */
  off_at: Date | null;
}

export interface LedgerLine {
  sku: string;
  qty: number;
  /** Before GST, after the order's discount share; not rounded. */
  base: number;
}

/**
 * Each line's base: its share of the discount and coins taken off (by value),
 * then its own GST taken out (prices include GST).
 */
export function lineBases(
  fact: Pick<OrderFact, 'lines' | 'deduction'>,
  gstOf: (sku: string) => number,
): LedgerLine[] {
  const paid = fact.lines.filter((l) => !l.free && l.total > 0);
  const gross = paid.reduce((sum, l) => sum + l.total, 0);
  const keep = gross > 0 ? Math.max(0, 1 - fact.deduction / gross) : 0;
  return paid.map((l) => ({
    sku: l.sku,
    qty: l.qty,
    base: (l.total * keep) / (1 + gstOf(l.sku) / 100),
  }));
}

export interface LedgerRow {
  order_id: string;
  placed_at: Date;
  /** `null` = the partner's own shop stock. */
  pii_id: string | null;
  customer_name: string;
  stage: OrderStage;
  order_status: string;
  /** The base, whole ₹. */
  order_value: number;
  rate: number;
  amount: number;
  /** The earning cohort the partner was in when it was placed; `null` = before their first (partner-type plan). */
  cohort_id: string | null;
  /** The saved plan the rate came from; `null` = the PRD's built-in rates. */
  plan_id: string | null;
  /** Below its cohort plan's minimum order value, so it earned the default cohort's plan. */
  below_min_order: boolean;
  status: CommissionStatus;
  delivered_at: Date | null;
  /** Delivery + the return window; `null` until delivered. */
  confirms_at: Date | null;
  confirmed_at: Date | null;
  /** Covered by withdrawals so far (whole ₹); the row is `paid` once it covers `amount`. */
  paid_amount: number;
  paid_at: Date | null;
  withdrawal_id: string | null;
  reversed_reason: 'cancelled' | 'returned' | null;
  lines: LedgerLine[];
}

export interface MonthFacts {
  month: string;
  /** Delivered sales (base) in the month, not counting reversed orders. */
  sales: number;
  /** The slab reached on the plan new orders of the month earn on (`monthPlan`). */
  rate: number;
  draft: boolean;
  slabs: Slab[];
  /**
   * Σ commission of the orders delivered in the month, not counting reversed
   * ones — each at its own rate, so exact when orders earn on different plans.
   */
  commission: number;
}

export type StatusTotals = Record<
  CommissionStatus,
  { count: number; amount: number }
>;

export interface Book {
  /** Newest order first. */
  rows: LedgerRow[];
  month: (key: string) => MonthFacts;
  current: MonthFacts & { next_slab: { rate: number; gap: number } | null };
  totals: StatusTotals;
  /** Σ confirmed and paid rows at today's rates, plus `gig_earned`. */
  earned: number;
  /** Σ approved meeting gigs' pay (0 while gig pay is off). */
  gig_earned: number;
  /** Σ withdrawals paid out. */
  paid: number;
  /** Σ withdrawals asked for and not yet paid or closed. */
  open: number;
  withdrawable: number;
}

/** Saved plans by cohort and month: the one in effect, or `null` when none is saved by then. */
export type SavedPlans = (cohort: string, month: string) => PlanInEffect | null;

/** The partner's earning cohorts, as commission reads them. */
export interface EarningContext {
  /** Their stretches in earning cohorts, any order; empty = never placed in one. */
  stretches: readonly { cohort_id: string; from: Date }[];
  saved: SavedPlans;
}

export interface BookContext {
  now: Date;
  /** The partner's own `pii_id`: an order for it is shop stock. */
  selfPiiId: string | null;
  returnWindowDays: number;
  /** The partner-type plan for a month: orders before earning cohorts, and while no earning plan is saved. */
  planFor: (month: string) => PlanTerms & { plan_id?: string | null };
  /** Left out = no earning cohorts: every order on `planFor`, as before. */
  earning?: EarningContext;
  gstOf: (sku: string) => number;
  /** Paid withdrawals, oldest payout first. */
  payouts: readonly { id: string; amount: number; paid_at: Date }[];
  /** Σ withdrawals requested or approved. */
  open: number;
  /** Approved meeting gigs' pay; none while settings `gig_pay_enabled` is off. */
  gigCredits?: readonly GigCreditFact[];
}

/** One approved meeting gig's pay: earned (confirmed) at approval. */
export interface GigCreditFact {
  id: string;
  amount: number;
  approved_at: Date;
}

/**
 * An earning cohort's plan in `month`: its own, else the default cohort's;
 * `null` = neither saved by then — the partner keeps their partner-type
 * plan, so nothing changes for anyone until HO saves an earning plan.
 */
export function earningPlanIn(
  cohort: string,
  month: string,
  saved: SavedPlans,
): PlanInEffect | null {
  return (
    saved(cohort, month) ??
    (cohort === DEFAULT_COHORT_ID ? null : saved(DEFAULT_COHORT_ID, month))
  );
}

export interface OrderPlan {
  plan: PlanTerms & { plan_id?: string | null };
  cohort_id: string | null;
  below_min_order: boolean;
}

/**
 * The plan an order earns on: the earning cohort's at its placing, for the
 * month placed; below that plan's minimum order value, the default cohort's.
 * Placed before the partner's first earning cohort, or no earning plan
 * saved: the partner-type plan of `rateMonth` — exactly the rule before.
 */
export function orderPlan(
  order: { placed_at: Date; base: number },
  rateMonth: string,
  ctx: Pick<BookContext, 'planFor' | 'earning'>,
): OrderPlan {
  const cohort = ctx.earning
    ? cohortAtIn(ctx.earning.stretches, order.placed_at)
    : null;
  if (!ctx.earning || !cohort) {
    return {
      plan: ctx.planFor(rateMonth),
      cohort_id: null,
      below_min_order: false,
    };
  }
  const month = istMonthKey(order.placed_at);
  let plan = earningPlanIn(cohort, month, ctx.earning.saved);
  const below =
    plan !== null &&
    plan.min_order_value !== null &&
    order.base < plan.min_order_value;
  if (below) plan = earningPlanIn(DEFAULT_COHORT_ID, month, ctx.earning.saved);
  return {
    plan: plan ?? ctx.planFor(rateMonth),
    cohort_id: cohort,
    below_min_order: below,
  };
}

/**
 * The plan a new order in `month` earns on — the month's headline rate, next
 * slab and draft tag: the cohort the partner is in at the month's end (now,
 * for this month), before any minimum-order check.
 */
export function monthPlan(
  month: string,
  now: Date,
  ctx: Pick<BookContext, 'planFor' | 'earning'>,
): PlanTerms {
  const e = ctx.earning;
  if (e && e.stretches.length > 0) {
    const end = istMonthStart(addMonths(month, 1)).getTime() - 1;
    const cohort = cohortAtIn(
      e.stretches,
      new Date(Math.min(now.getTime(), end)),
    );
    const plan = cohort ? earningPlanIn(cohort, month, e.saved) : null;
    if (plan) return plan;
  }
  return ctx.planFor(month);
}

/** The partner's whole commission book from their orders. */
export function buildBook(facts: readonly OrderFact[], ctx: BookContext): Book {
  const thisMonth = istMonthKey(ctx.now);
  const windowMs = ctx.returnWindowDays * DAY_MS;

  const rows: LedgerRow[] = facts.map((f) => {
    const stage = stageOf(f.order_status);
    const confirmsAt = f.delivered_at
      ? new Date(f.delivered_at.getTime() + windowMs)
      : null;
    const off = stage === 'cancelled' || stage === 'returned' ? stage : null;
    // Gone after the window closed: confirmed, and confirmed is final.
    const keptAfterWindow =
      !!confirmsAt && !!f.off_at && f.off_at >= confirmsAt;
    const status: CommissionStatus =
      off && !keptAfterWindow
        ? 'reversed'
        : confirmsAt && confirmsAt <= ctx.now
          ? 'confirmed'
          : 'pending';
    const lines = lineBases(f, ctx.gstOf);
    const self = !f.pii_id || f.pii_id === ctx.selfPiiId;
    return {
      order_id: f.order_id,
      placed_at: f.placed_at,
      pii_id: self ? null : f.pii_id,
      customer_name: self ? SELF_LABEL : f.customer_name,
      stage,
      order_status: f.order_status,
      order_value: Math.round(lines.reduce((sum, l) => sum + l.base, 0)),
      rate: 0,
      amount: 0,
      cohort_id: null,
      plan_id: null,
      below_min_order: false,
      status,
      delivered_at: f.delivered_at,
      confirms_at: confirmsAt,
      confirmed_at: status === 'confirmed' ? confirmsAt : null,
      paid_amount: 0,
      paid_at: null,
      withdrawal_id: null,
      reversed_reason: status === 'reversed' ? off : null,
      lines,
    };
  });

  const sales = new Map<string, number>();
  for (const r of rows) {
    if (!r.delivered_at || r.status === 'reversed') continue;
    const key = istMonthKey(r.delivered_at);
    sales.set(key, (sales.get(key) ?? 0) + r.order_value);
  }

  // Each order on its own plan, at the slab its rate month's sales reach.
  const earnedIn = new Map<string, number>();
  for (const r of rows) {
    const rateMonth = r.delivered_at ? istMonthKey(r.delivered_at) : thisMonth;
    const applied = orderPlan(
      { placed_at: r.placed_at, base: r.order_value },
      rateMonth,
      ctx,
    );
    r.rate = slabFor(applied.plan.slabs, sales.get(rateMonth) ?? 0).rate;
    r.amount = commissionOf(r.order_value, r.rate);
    r.cohort_id = applied.cohort_id;
    r.plan_id = applied.plan.plan_id ?? null;
    r.below_min_order = applied.below_min_order;
    if (r.delivered_at && r.status !== 'reversed')
      earnedIn.set(rateMonth, (earnedIn.get(rateMonth) ?? 0) + r.amount);
  }

  const months = new Map<string, MonthFacts>();
  const month = (key: string): MonthFacts => {
    let m = months.get(key);
    if (!m) {
      const plan = monthPlan(key, ctx.now, ctx);
      const total = sales.get(key) ?? 0;
      m = {
        month: key,
        sales: total,
        rate: slabFor(plan.slabs, total).rate,
        draft: plan.draft,
        slabs: plan.slabs,
        commission: earnedIn.get(key) ?? 0,
      };
      months.set(key, m);
    }
    return m;
  };

  // Payouts cover confirmed orders oldest-confirmed first.
  const confirmed = rows
    .filter((r) => r.status === 'confirmed')
    .sort(
      (a, b) =>
        a.confirms_at!.getTime() - b.confirms_at!.getTime() ||
        a.order_id.localeCompare(b.order_id),
    );
  // Approved gigs take their turn among them by approval time: a gig approved
  // after an order confirmed comes after it, so it never moves that order's
  // payout. The sort is stable — at the same instant the order goes first —
  // so with no gigs the order is exactly `confirmed`.
  const gigs = [...(ctx.gigCredits ?? [])].sort(
    (a, b) =>
      a.approved_at.getTime() - b.approved_at.getTime() ||
      a.id.localeCompare(b.id),
  );
  const due: { at: number; amount: number; row: LedgerRow | null }[] = [
    ...confirmed.map((r) => ({
      at: r.confirms_at!.getTime(),
      amount: r.amount,
      row: r,
    })),
    ...gigs.map((g) => ({
      at: g.approved_at.getTime(),
      amount: g.amount,
      row: null,
    })),
  ].sort((a, b) => a.at - b.at);
  let p = 0;
  let left = ctx.payouts[0]?.amount ?? 0;
  for (const { amount, row: r } of due) {
    let need = amount;
    while (need > 0 && p < ctx.payouts.length) {
      const take = Math.min(need, left);
      need -= take;
      left -= take;
      if (r) {
        r.paid_amount += take;
        if (need === 0) {
          r.status = 'paid';
          r.paid_at = ctx.payouts[p].paid_at;
          r.withdrawal_id = ctx.payouts[p].id;
        }
      }
      if (left <= 0) left = ctx.payouts[++p]?.amount ?? 0;
    }
  }

  const totals: StatusTotals = {
    pending: { count: 0, amount: 0 },
    confirmed: { count: 0, amount: 0 },
    paid: { count: 0, amount: 0 },
    reversed: { count: 0, amount: 0 },
  };
  let earned = 0;
  for (const r of rows) {
    totals[r.status].count += 1;
    if (r.status === 'pending' || r.status === 'reversed')
      totals[r.status].amount += r.amount;
    else earned += r.amount;
  }
  // Earned at approval; no ledger row — the ledger stays orders only.
  const gigEarned = gigs.reduce((sum, g) => sum + g.amount, 0);
  earned += gigEarned;
  const paid = ctx.payouts.reduce((sum, w) => sum + w.amount, 0);
  // A payout can run ahead of today's amounts (a rate that fell after it);
  // nothing is taken back, it is only not paid twice.
  totals.confirmed.amount = Math.max(0, earned - paid);
  totals.paid.amount = paid;

  const current = month(thisMonth);
  rows.sort(
    (a, b) =>
      b.placed_at.getTime() - a.placed_at.getTime() ||
      b.order_id.localeCompare(a.order_id),
  );
  return {
    rows,
    month,
    current: { ...current, next_slab: nextSlab(current.slabs, current.sales) },
    totals,
    earned,
    gig_earned: gigEarned,
    paid,
    open: ctx.open,
    withdrawable: Math.max(0, earned - paid - ctx.open),
  };
}

/** TDS on a payout, to the paisa. */
export function tdsOf(
  amount: number,
  rate: number,
): { tds: number; net: number } {
  const tds = Math.round(amount * rate) / 100;
  return { tds, net: Math.round((amount - tds) * 100) / 100 };
}

/** `FY2026-Q2` = Jul–Sep 2026 (the year the financial year starts; Q1 = Apr–Jun). */
export const QUARTER_PATTERN = /^FY\d{4}-Q[1-4]$/;

export function quarterMonths(quarter: string): string[] {
  const year = Number(quarter.slice(2, 6));
  const q = Number(quarter.slice(-1));
  const first = addMonths(`${year}-04`, (q - 1) * 3);
  return [0, 1, 2].map((n) => addMonths(first, n));
}

export function quarterOf(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const fy = m >= 4 ? y : y - 1;
  return `FY${fy}-Q${Math.floor(((m + 8) % 12) / 3) + 1}`;
}
