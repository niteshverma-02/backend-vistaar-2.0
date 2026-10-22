/** India has one time zone and no daylight saving: IST is always UTC+5:30. */
const IST_OFFSET_MS = 5.5 * 3600 * 1000;

export const DAY_MS = 24 * 3600 * 1000;

/** Midnight IST that starts the day `at` falls in. */
export function istDayStart(at: Date): Date {
  const ist = new Date(at.getTime() + IST_OFFSET_MS);
  ist.setUTCHours(0, 0, 0, 0);
  return new Date(ist.getTime() - IST_OFFSET_MS);
}

/** `YYYY-MM-DD` of the IST day `at` falls on. */
export function istDate(at: Date): string {
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Whole IST calendar days from `from` to `to` (negative when `to` is earlier). */
export function istDaysBetween(from: Date, to: Date): number {
  return Math.round(
    (istDayStart(to).getTime() - istDayStart(from).getTime()) / DAY_MS,
  );
}

/** `YYYY-MM` of the IST calendar month `at` falls in. */
export function istMonthKey(at: Date): string {
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 7);
}

/** Midnight IST on the 1st of month `YYYY-MM`, as a UTC instant. */
export function istMonthStart(key: string): Date {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1) - IST_OFFSET_MS);
}

/** Month `YYYY-MM` moved by `n` months (negative = earlier). */
export function addMonths(key: string, n: number): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

/** April of the Indian financial year `key` falls in (`YYYY-04`). */
export function fyStart(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return `${m >= 4 ? y : y - 1}-04`;
}

/**
 * IST calendar days `from`..`to` (`YYYY-MM-DD`, both included) as the
 * instants `[from, to)` a query compares against. Either may be left out.
 */
export function istDayRange(
  from?: string,
  to?: string,
): { from: Date | null; to: Date | null } {
  return {
    from: from ? new Date(`${from}T00:00:00+05:30`) : null,
    to: to
      ? new Date(new Date(`${to}T00:00:00+05:30`).getTime() + DAY_MS)
      : null,
  };
}
