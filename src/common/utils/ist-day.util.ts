/** India has one time zone and no daylight saving: IST is always UTC+5:30. */
const IST_OFFSET_MS = 5.5 * 3600 * 1000;

export const DAY_MS = 24 * 3600 * 1000;

/** Midnight IST that starts the day `at` falls in. */
export function istDayStart(at: Date): Date {
  const ist = new Date(at.getTime() + IST_OFFSET_MS);
  ist.setUTCHours(0, 0, 0, 0);
  return new Date(ist.getTime() - IST_OFFSET_MS);
}

/** Whole IST calendar days from `from` to `to` (negative when `to` is earlier). */
export function istDaysBetween(from: Date, to: Date): number {
  return Math.round(
    (istDayStart(to).getTime() - istDayStart(from).getTime()) / DAY_MS,
  );
}
