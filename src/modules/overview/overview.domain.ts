import { daysInRange, shiftDate } from '@modules/attendance/attendance.domain';

/** IST days `YYYY-MM-DD`, both included. */
export interface Period {
  from: string;
  to: string;
}

/**
 * Home's period: `to` defaults to today, `from` to the 1st of `to`'s month —
 * this IST month so far, as the order cards default. A day past a month's
 * end (`2026-02-31`) is read as JavaScript rolls it (`2026-03-03`), so the
 * period shown is the one counted.
 */
export function periodOf(
  from: string | undefined,
  to: string | undefined,
  today: string,
): Period {
  const end = shiftDate(to ?? today, 0);
  return { from: shiftDate(from ?? `${end.slice(0, 7)}-01`, 0), to: end };
}

/** The same number of days just before `period` — the portal's "vs previous period". */
export function previousOf(period: Period): Period {
  const days = daysInRange(period.from, period.to);
  return { from: shiftDate(period.from, days), to: shiftDate(period.from, 1) };
}
