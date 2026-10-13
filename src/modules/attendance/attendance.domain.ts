import { isIndiaFix } from '@common/utils/geo.util';

/** Where a punch was made: a GPS fix, or the partner's registered village when GPS failed. */
export const LOCATION_SOURCES = ['gps', 'registered'] as const;
export type LocationSource = (typeof LOCATION_SOURCES)[number];

export interface PunchLocationData {
  lat: number | null;
  lng: number | null;
  accuracy_m: number | null;
  label: string;
  source: LocationSource;
}

export interface SessionData {
  in_at: Date;
  in_location: PunchLocationData;
  out_at: Date | null;
  out_location: PunchLocationData | null;
}

/** The fields of a day that its status and summary are read from. */
export interface DayData {
  date: string;
  sessions: SessionData[];
  punched_in: boolean;
  worked_ms: number;
}

/**
 * A day is bounded so its document stays small; ten "punch in again"s is far
 * past any real field day, and well short of a runaway client.
 */
export const MAX_SESSIONS_PER_DAY = 10;

export const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Partners work in India; their day turns over at IST midnight, not the server's. */
const IST_OFFSET_MS = 330 * 60_000;

/** `YYYY-MM-DD` of the IST calendar day `at` falls in. */
export function istDate(at: Date): string {
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** `YYYY-MM` of the IST month `at` falls in. */
export function istMonth(at: Date): string {
  return istDate(at).slice(0, 7);
}

/** First and last day keys of a `YYYY-MM` month; string order is date order. */
export function monthBounds(month: string): { from: string; to: string } {
  return { from: `${month}-01`, to: `${month}-31` };
}

/**
 * - `on_duty`: today, a session is open.
 * - `day_closed`: every session has a punch-out.
 * - `missed_punch_out`: an earlier day left open — its last session is not
 *   counted in `worked_ms`, since nobody knows when it ended.
 */
export const DAY_STATUSES = [
  'not_started',
  'on_duty',
  'day_closed',
  'missed_punch_out',
] as const;
export type DayStatus = (typeof DAY_STATUSES)[number];

export function dayStatus(day: DayData | null, today: string): DayStatus {
  if (!day || day.sessions.length === 0) return 'not_started';
  if (!day.punched_in) return 'day_closed';
  return day.date === today ? 'on_duty' : 'missed_punch_out';
}

/**
 * Why a punch location is refused, or `null` when it is fine. A GPS punch
 * must carry a fix inside India; a registered-village punch carries no
 * coordinates, so a guessed point is never stored as if it were measured.
 */
export function locationError(loc: PunchLocationData): string | null {
  if (!loc.label.trim())
    return 'Your location name is missing. Please try again.';
  if (loc.source === 'registered') {
    return loc.lat === null && loc.lng === null
      ? null
      : 'Your location could not be saved. Please try again.';
  }
  if (loc.lat === null || loc.lng === null) {
    return 'Your GPS location was not found. Please turn on GPS and try again.';
  }
  return isIndiaFix(loc.lat, loc.lng)
    ? null
    : 'Your location looks wrong (outside India). Please turn on GPS and try again.';
}

/** Milliseconds of the session being closed at `outAt`; a clock step backwards counts as zero. */
export function sessionMs(inAt: Date, outAt: Date): number {
  return Math.max(0, outAt.getTime() - inAt.getTime());
}

export interface MonthSummary {
  /** Days with at least one punch-in. */
  present_days: number;
  /** Present days whose last session has a punch-out. */
  closed_days: number;
  /** Over closed days only. */
  worked_ms: number;
  /** `worked_ms / closed_days`; 0 with no closed day. */
  avg_worked_ms: number;
}

export function summarize(days: DayData[]): MonthSummary {
  const present = days.filter((d) => d.sessions.length > 0);
  const closed = present.filter((d) => !d.punched_in);
  const worked = closed.reduce((sum, d) => sum + d.worked_ms, 0);
  return {
    present_days: present.length,
    closed_days: closed.length,
    worked_ms: worked,
    avg_worked_ms: closed.length ? Math.round(worked / closed.length) : 0,
  };
}

/** How many days the HO board's trend covers, ending on the day shown. */
export const TREND_DAYS = 14;

/** `YYYY-MM-DD` `n` days before `date` (IST day keys carry no time, so UTC arithmetic is exact). */
export function shiftDate(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export interface BoardSummary {
  partners: number;
  on_duty: number;
  day_closed: number;
  missed_punch_out: number;
  not_started: number;
  /** Closed sessions of the day, all partners. */
  worked_ms: number;
  /** Over partners who punched in at least once. */
  avg_worked_ms: number;
}

/** One day's counts across the roster, from each partner's status that day. */
export function boardSummary(
  rows: { status: DayStatus; worked_ms: number }[],
): BoardSummary {
  const count = (s: DayStatus) => rows.filter((r) => r.status === s).length;
  const present = rows.filter((r) => r.status !== 'not_started');
  const worked = present.reduce((sum, r) => sum + r.worked_ms, 0);
  return {
    partners: rows.length,
    on_duty: count('on_duty'),
    day_closed: count('day_closed'),
    missed_punch_out: count('missed_punch_out'),
    not_started: count('not_started'),
    worked_ms: worked,
    avg_worked_ms: present.length ? Math.round(worked / present.length) : 0,
  };
}

/* ── Range reads (HO: week, month, 90 days, year, custom) ────────────────── */

/** A year and a leap day; longer is a report, not a screen. */
export const RANGE_MAX_DAYS = 366;
/** A punch-in after 10:00 am IST is late — the portal draws the same line. */
export const LATE_AFTER_MIN = 10 * 60;
/** A closed day this long or more counts as a full day. */
export const FULL_DAY_MS = 6 * 3_600_000;

/**
 * One character per day of a range, so a year per partner stays a short
 * string: `.` no punch, `C` closed, `O` on duty (today), `M` left open.
 */
export const DAY_MARK: Record<DayStatus, string> = {
  not_started: '.',
  day_closed: 'C',
  on_duty: 'O',
  missed_punch_out: 'M',
};

/** Whole days from `from` to `to`, both included. */
export function daysInRange(from: string, to: string): number {
  const ms =
    new Date(`${to}T00:00:00Z`).getTime() -
    new Date(`${from}T00:00:00Z`).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

/** Minutes past IST midnight of `at`. */
export function istMinutes(at: Date): number {
  const ist = new Date(at.getTime() + IST_OFFSET_MS);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

/** Why a range is refused, or `null` when it is fine. */
export function rangeError(from: string, to: string): string | null {
  if (from > to) return 'The start date must be on or before the end date.';
  if (daysInRange(from, to) > RANGE_MAX_DAYS) {
    return `Please choose at most ${RANGE_MAX_DAYS} days.`;
  }
  return null;
}

/** The fields of a stored day a range roll-up reads. */
export interface RangeDayData extends DayData {
  first_in_at: Date;
  last_out_at: Date | null;
}

export interface RangeRollup {
  present_days: number;
  closed_days: number;
  missed_days: number;
  late_days: number;
  full_days: number;
  /** Days with a punch made from the registered village, not a GPS fix. */
  no_gps_days: number;
  /** Days with more than one session (a break). */
  break_days: number;
  /** Closed days only, as everywhere else. */
  worked_ms: number;
  avg_worked_ms: number;
  /** IST minutes past midnight, averaged over present / closed days; null with none. */
  avg_in_min: number | null;
  avg_out_min: number | null;
  first_date: string | null;
  last_date: string | null;
  /** `DAY_MARK` per day, oldest first, `days` long. */
  marks: string;
  /** Worked minutes per day, oldest first (0 = none or left open). */
  minutes: number[];
}

/** One partner's days in `[from, to]` rolled up for the HO range view. Pure. */
export function rollup(
  days: RangeDayData[],
  from: string,
  to: string,
  today: string,
): RangeRollup {
  const n = daysInRange(from, to);
  const byDate = new Map(days.map((d) => [d.date, d]));
  let marks = '';
  const minutes: number[] = [];
  const ins: number[] = [];
  const outs: number[] = [];
  const r = {
    present_days: 0,
    closed_days: 0,
    missed_days: 0,
    late_days: 0,
    full_days: 0,
    no_gps_days: 0,
    break_days: 0,
    worked_ms: 0,
    first_date: null as string | null,
    last_date: null as string | null,
  };
  for (let i = 0; i < n; i++) {
    const date = shiftDate(from, -i);
    const d = byDate.get(date) ?? null;
    const status = dayStatus(d, today);
    marks += DAY_MARK[status];
    const closed = status === 'day_closed';
    minutes.push(closed && d ? Math.round(d.worked_ms / 60_000) : 0);
    if (!d || status === 'not_started') continue;
    r.present_days += 1;
    r.first_date ??= date;
    r.last_date = date;
    const inMin = istMinutes(d.first_in_at);
    ins.push(inMin);
    if (inMin > LATE_AFTER_MIN) r.late_days += 1;
    if (status === 'missed_punch_out') r.missed_days += 1;
    if (d.sessions.length > 1) r.break_days += 1;
    if (
      d.sessions.some(
        (s) =>
          s.in_location.source === 'registered' ||
          s.out_location?.source === 'registered',
      )
    ) {
      r.no_gps_days += 1;
    }
    if (closed) {
      r.closed_days += 1;
      r.worked_ms += d.worked_ms;
      if (d.worked_ms >= FULL_DAY_MS) r.full_days += 1;
      if (d.last_out_at) outs.push(istMinutes(d.last_out_at));
    }
  }
  const avg = (xs: number[]) =>
    xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
  return {
    ...r,
    avg_worked_ms: r.closed_days ? Math.round(r.worked_ms / r.closed_days) : 0,
    avg_in_min: avg(ins),
    avg_out_min: avg(outs),
    marks,
    minutes,
  };
}
