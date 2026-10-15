import { addMonths, DAY_MS, istMonthKey } from '@common/utils/ist-day.util';
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
 *   month reach, on their cohort's plan; the whole month earns that rate
 *   (retro). An order not yet delivered shows this month's rate.
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

export interface PlanTerms {
  slabs: Slab[];
  notes: string[];
  /** Rates not signed off by HO yet — the app shows a "Draft" tag. */
  draft: boolean;
}

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
    slabs: DEFAULT_SLABS[cohort] ?? DEFAULT_SLABS[FALLBACK_COHORT],
    notes: [...DEFAULT_NOTES],
    draft: true,
  };
}

/** A pack whose GST the catalogue does not know is taken at the highest common rate, so commission is never overpaid. */
export const UNKNOWN_GST_RATE = 18;

export const MAX_SLABS = 10;

/** Why these slabs cannot be a plan, or `null` when they can. */
export function slabsProblem(slabs: readonly Slab[]): string | null {
  if (slabs.length === 0 || slabs.length > MAX_SLABS)
    return `A plan needs 1 to ${MAX_SLABS} slabs.`;
  if (slabs[0].from !== 0) return 'The first slab must start at ₹0.';
  for (const [i, s] of slabs.entries()) {
    const last = i === slabs.length - 1;
    if (!Number.isFinite(s.rate) || s.rate < 0 || s.rate > 100)
      return `Slab ${i + 1}: the rate must be between 0 and 100%.`;
    if (Math.round(s.rate * 100) !== s.rate * 100)
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
  rate: number;
  draft: boolean;
  slabs: Slab[];
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

export interface BookContext {
  now: Date;
  /** The partner's own `pii_id`: an order for it is shop stock. */
  selfPiiId: string | null;
  returnWindowDays: number;
  planFor: (month: string) => PlanTerms;
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
  const months = new Map<string, MonthFacts>();
  const month = (key: string): MonthFacts => {
    let m = months.get(key);
    if (!m) {
      const plan = ctx.planFor(key);
      const total = sales.get(key) ?? 0;
      m = {
        month: key,
        sales: total,
        rate: slabFor(plan.slabs, total).rate,
        draft: plan.draft,
        slabs: plan.slabs,
      };
      months.set(key, m);
    }
    return m;
  };

  for (const r of rows) {
    r.rate = month(
      r.delivered_at ? istMonthKey(r.delivered_at) : thisMonth,
    ).rate;
    r.amount = commissionOf(r.order_value, r.rate);
  }

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
