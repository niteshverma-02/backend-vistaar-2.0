import { addMonths, fyStart } from '@common/utils/ist-day.util';

/**
 * My Performance rules (PRD, Lovable `MyPerformance`, the app's spec —
 * settled 2026-10-14). Pure; the service fetches.
 */

export const PERIODS = ['month', '3m', 'fy'] as const;
export type Period = (typeof PERIODS)[number];

/** IST months a period covers, oldest first: this month · the last 3 with this · April to now. */
export function periodMonths(period: Period, thisMonth: string): string[] {
  const first =
    period === 'month'
      ? thisMonth
      : period === '3m'
        ? addMonths(thisMonth, -2)
        : fyStart(thisMonth);
  const out: string[] = [];
  for (let m = first; m <= thisMonth; m = addMonths(m, 1)) out.push(m);
  return out;
}

export const ACTIVITY_PERIODS = [
  'day',
  'week',
  'month',
  'quarter',
  'year',
  'custom',
] as const;
export type ActivityPeriod = (typeof ACTIVITY_PERIODS)[number];

/** The lists behind My Activity's cards (`GET /performance/activity/items?kind=`). */
export const ACTIVITY_KINDS = [
  'leads',
  'customers',
  'orders',
  'delivered',
  'visits',
  'attendance',
  'meetings',
  'gigs',
  'coins',
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/**
 * IST days `[from, to)` (`YYYY-MM-DD`) of the day, week (Monday first), month,
 * quarter (Jan / Apr / Jul / Oct) or Indian FY (April) that `date` falls in;
 * `custom` = `date` to `last` (both included; `last` left out = that day).
 */
export function activityRange(
  period: ActivityPeriod,
  date: string,
  last?: string,
): { from: string; to: string } {
  const day = (n: number, from = date) => {
    const d = new Date(`${from}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const month = date.slice(0, 7);
  const months = (first: string, n: number) => ({
    from: `${first}-01`,
    to: `${addMonths(first, n)}-01`,
  });
  switch (period) {
    case 'day':
      return { from: date, to: day(1) };
    case 'week': {
      const back = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
      return { from: day(-back), to: day(7 - back) };
    }
    case 'month':
      return months(month, 1);
    case 'quarter':
      return months(addMonths(month, -((Number(date.slice(5, 7)) - 1) % 3)), 3);
    case 'year':
      return months(fyStart(month), 12);
    case 'custom':
      return { from: date, to: day(1, last ?? date) };
  }
}

/** The same number of months just before; `null` for a financial year (no "previous" shown). */
export function previousMonths(
  period: Period,
  months: readonly string[],
): string[] | null {
  if (period === 'fy') return null;
  return months.map((m) => addMonths(m, -months.length));
}

export const TIERS = [
  { key: 'bronze', min: 0 },
  { key: 'silver', min: 50_000 },
  { key: 'gold', min: 100_000 },
  { key: 'platinum', min: 250_000 },
] as const;
export type Tier = (typeof TIERS)[number]['key'];

export interface TierStanding {
  current: Tier;
  next: Tier | null;
  avg_3m_sales: number;
  current_min: number;
  next_min: number | null;
  /** Of the way from this tier's floor to the next one's, capped at 100. */
  progress_pct: number;
}

/**
 * The tier a 3-month average of delivered sales earns. The average is over
 * the three **completed** months before this one, so a tier does not drop on
 * the 1st of every month while the new month is still empty.
 */
export function tierOf(avg: number): TierStanding {
  const i = TIERS.reduce((at, t, n) => (avg >= t.min ? n : at), 0);
  const current = TIERS[i];
  const next = TIERS[i + 1] ?? null;
  return {
    current: current.key,
    next: next?.key ?? null,
    avg_3m_sales: Math.round(avg),
    current_min: current.min,
    next_min: next?.min ?? null,
    progress_pct: next
      ? Math.min(
          100,
          Math.max(
            0,
            Math.round(((avg - current.min) * 100) / (next.min - current.min)),
          ),
        )
      : 100,
  };
}

export const LIFECYCLE_STAGES = [
  'onboarded',
  'active',
  'at_risk',
  'lost',
] as const;
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

export const AT_RISK_DAYS = 30;
export const LOST_DAYS = 90;

/** No order yet · ordered within 30 days · 30–89 days without · 90+ days without. */
export function lifecycleOf(daysSinceLastOrder: number | null): LifecycleStage {
  if (daysSinceLastOrder === null) return 'onboarded';
  if (daysSinceLastOrder >= LOST_DAYS) return 'lost';
  if (daysSinceLastOrder >= AT_RISK_DAYS) return 'at_risk';
  return 'active';
}

export interface HealthInput {
  days_since_last_order: number | null;
  orders_this_month: number;
  training: { done: number; total: number };
  field_days: number;
  overdue_follow_ups: number;
}

export interface HealthFactor {
  key:
    | 'days_since_last_order'
    | 'orders_this_month'
    | 'training_completed'
    | 'field_days_logged'
    | 'overdue_follow_ups';
  value: number | null;
  total?: number;
  good: boolean;
}

/** Lovable's five checks, 20 points each. */
export function healthOf(h: HealthInput): {
  score: number;
  factors: HealthFactor[];
} {
  const factors: HealthFactor[] = [
    {
      key: 'days_since_last_order',
      value: h.days_since_last_order,
      good: h.days_since_last_order !== null && h.days_since_last_order <= 7,
    },
    {
      key: 'orders_this_month',
      value: h.orders_this_month,
      good: h.orders_this_month >= 4,
    },
    {
      key: 'training_completed',
      value: h.training.done,
      total: h.training.total,
      // No open course is nothing left undone.
      good: h.training.done * 2 >= h.training.total,
    },
    {
      key: 'field_days_logged',
      value: h.field_days,
      good: h.field_days >= 4,
    },
    {
      key: 'overdue_follow_ups',
      value: h.overdue_follow_ups,
      good: h.overdue_follow_ups === 0,
    },
  ];
  return { score: factors.filter((f) => f.good).length * 20, factors };
}

/** Value and share of each name, largest first. */
export function shares(
  values: Map<string, number>,
): { name: string; value: number; pct: number }[] {
  const total = [...values.values()].reduce((a, b) => a + b, 0);
  return [...values]
    .map(([name, value]) => ({
      name,
      value: Math.round(value),
      pct: total ? Math.round((value * 100) / total) : 0,
    }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}
