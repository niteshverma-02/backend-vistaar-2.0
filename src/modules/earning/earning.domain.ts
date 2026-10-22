/**
 * Earning cohorts and the light rule engine (user + TL, 2026-10-16).
 *
 * An earning cohort is **not** the onboarding cohort (`vistaar_v2_cohorts`,
 * the partner type and its form). HO builds earning cohorts from an ordered
 * list of conditions — the same `{ field, op, value }` shape the rules use —
 * over where the partner is (profile state / district / pincode) and what they
 * hold now (open leads, customers). A partner is in exactly one: the first
 * match in HO's priority order, else the built-in default. The cohort fixes
 * the commission plan, the meeting-gig payout, and which coin / gig rules pay.
 * The legacy `filters` object converts both ways for old callers and old rows.
 *
 * Everything here is pure: the services load rows and call these.
 */

import { addMonths } from '@common/utils/ist-day.util';

// ── Cohorts ──────────────────────────────────────────────────────────────

/** The built-in cohort that catches everyone else: no filters, always last. */
export const DEFAULT_COHORT_ID = 'ec_default';
export const DEFAULT_COHORT_NAME = 'Everyone else';

export const COHORT_ID_PATTERN = /^ec_[a-z0-9_]{1,40}$/;
/** What HO may send as `key`: with or without the `ec_` prefix. */
export const COHORT_KEY_PATTERN = /^(ec_)?[a-z0-9_]{1,40}$/;
const SLUG_MAX = 40;

export const COHORT_STATUSES = ['active', 'archived'] as const;
export type EarningStatus = (typeof COHORT_STATUSES)[number];

export const MAX_STATES = 40;
export const MAX_DISTRICTS = 800;
export const MAX_PINCODES = 2000;

/**
 * Several values in one filter = any of them; filters together = all of them;
 * an empty list or `null` = not used.
 */
export interface EarningFilters {
  /** Upper case, as partners' states are kept. */
  states: string[];
  /** Compared without case. */
  districts: string[];
  /** Six digits. */
  pincodes: string[];
  /** Open leads the partner holds now (not won, not lost) ≥ N. */
  min_leads: number | null;
  /** Customers (leads at `won`) the partner holds now ≥ N. */
  min_customers: number | null;
}

/** Filters as HO sends them: any key left out, `null` = not used. */
export type FiltersInput = {
  [K in keyof EarningFilters]?: EarningFilters[K] | null;
};

export const NO_FILTERS: EarningFilters = {
  states: [],
  districts: [],
  pincodes: [],
  min_leads: null,
  min_customers: null,
};

/** What a cohort is matched on: the partner's profile place and holdings now. */
export interface PartnerFacts {
  state: string | null;
  district: string | null;
  pincode: string | null;
  open_leads: number;
  customers: number;
}

export interface CohortLike extends CohortDates {
  _id: string;
  status: EarningStatus;
  priority: number;
  /** Authoritative; a stored row from before conditions has only `filters`. */
  conditions?: RuleCondition[] | null;
  /** The legacy shape, kept so old rows match until a migration runs. */
  filters?: EarningFilters | null;
}

/** Why a partner's assignment was looked at again. */
export const ASSIGNMENT_REASONS = [
  'partner_approved',
  'partner_unblocked',
  'profile_changed',
  'holdings_changed',
  'cohorts_changed',
  'first_assignment',
  'recompute',
  // A cohort's start or end day came (or a stored one was found outside it).
  'cohort_window',
] as const;
export type AssignmentReason = (typeof ASSIGNMENT_REASONS)[number];

/** Trimmed, single spaces, lower case — how places and words are compared. */
export const normText = (value: string): string =>
  value.trim().replace(/\s+/g, ' ').toLowerCase();

const tidy = (value: string): string => value.trim().replace(/\s+/g, ' ');

/** One entry per value (first spelling kept), blanks dropped. */
function uniqueText(values: readonly string[], upper = false): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = upper ? tidy(raw).toUpperCase() : tidy(raw);
    const key = normText(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/** HO's filters as stored: states upper case, no duplicates, `0` thresholds as unused. */
export function normalizeFilters(
  input: FiltersInput | null | undefined,
): EarningFilters {
  const positive = (n: number | null | undefined): number | null =>
    typeof n === 'number' && n > 0 ? Math.floor(n) : null;
  return {
    states: uniqueText(input?.states ?? [], true),
    districts: uniqueText(input?.districts ?? []),
    pincodes: [...new Set((input?.pincodes ?? []).map((p) => p.trim()))],
    min_leads: positive(input?.min_leads),
    min_customers: positive(input?.min_customers),
  };
}

/** Is any filter in use? A cohort other than the default needs one. */
export const hasFilters = (f: EarningFilters): boolean =>
  f.states.length > 0 ||
  f.districts.length > 0 ||
  f.pincodes.length > 0 ||
  f.min_leads !== null ||
  f.min_customers !== null;

// (Filter matching lives on as conditions: see "Cohort conditions" below.)

// ── Commission switch (user, 2026-10-22) ─────────────────────────────────

/**
 * IST months `YYYY-MM`, both included, in which the cohort's own commission
 * plan was switched off; `to: null` = still off. Its partners earn
 * `ec_default`'s plan in those months — never nothing.
 */
export interface CommissionOffRange {
  from: string;
  to: string | null;
}

/** Is the cohort's own commission plan off in `month`? */
export function commissionOffIn(
  ranges: readonly CommissionOffRange[] | null | undefined,
  month: string,
): boolean {
  return (ranges ?? []).some(
    (r) => r.from <= month && (r.to === null || month <= r.to),
  );
}

/**
 * The ranges after HO switches the cohort's commission on or off in IST
 * month `month`; `null` = it already stands as asked (nothing to write).
 * Off and on both act from `month` itself, so a month already paid on never
 * changes.
 */
export function switchCommission(
  ranges: readonly CommissionOffRange[],
  enabled: boolean,
  month: string,
): CommissionOffRange[] | null {
  const open = ranges.findIndex((r) => r.to === null);
  const before = addMonths(month, -1);
  if (enabled) {
    if (open < 0) return null;
    // Opened this month: it never covered a month that is paid on, so it goes.
    if (ranges[open].from >= month) return ranges.filter((_, i) => i !== open);
    return ranges.map((r, i) =>
      i === open ? { from: r.from, to: before } : r,
    );
  }
  if (open >= 0) return null;
  // Switched on earlier this month: off again simply carries that stretch on.
  const last = ranges.findIndex((r) => r.to === before);
  if (last >= 0) {
    return ranges.map((r, i) => (i === last ? { from: r.from, to: null } : r));
  }
  return [...ranges, { from: month, to: null }];
}

// ── Cohort dates (user, 2026-10-22) ──────────────────────────────────────

/**
 * Optional dates on a cohort: IST calendar days `YYYY-MM-DD`, both included;
 * `null` (or absent, on rows from before dates) = open on that side. A cohort
 * takes partners only while running; `ec_default` never has dates.
 */
export interface CohortDates {
  starts_on?: string | null;
  ends_on?: string | null;
}

export const COHORT_WINDOWS = ['upcoming', 'running', 'ended'] as const;
export type CohortWindow = (typeof COHORT_WINDOWS)[number];

export const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` that names a day on the calendar (no 31 February). */
export function isCalendarDay(value: string): boolean {
  if (!DAY_KEY_PATTERN.test(value)) return false;
  const at = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === value;
}

/** Where IST `today` stands against the cohort's dates; `null` = it has none. */
export function cohortWindow(
  c: CohortDates,
  today: string,
): CohortWindow | null {
  const from = c.starts_on ?? null;
  const to = c.ends_on ?? null;
  if (from === null && to === null) return null;
  // Same-length `YYYY-MM-DD` strings order as the days do.
  if (from !== null && today < from) return 'upcoming';
  if (to !== null && today > to) return 'ended';
  return 'running';
}

/** Takes partners on IST `today`: no dates, or `today` within them. */
export function isRunning(c: CohortDates, today: string): boolean {
  const state = cohortWindow(c, today);
  return state === null || state === 'running';
}

/** Why these dates cannot be saved; `null` when they can. */
export function windowError(
  starts_on: string | null,
  ends_on: string | null,
): string | null {
  if (starts_on !== null && !isCalendarDay(starts_on)) {
    return 'The start date must be a real day, like 2026-11-01.';
  }
  if (ends_on !== null && !isCalendarDay(ends_on)) {
    return 'The end date must be a real day, like 2026-11-30.';
  }
  if (starts_on !== null && ends_on !== null && ends_on < starts_on) {
    return 'The end date must be on or after the start date.';
  }
  return null;
}

/**
 * Did an active cohort start or end between `since` (the IST day the dates
 * were last looked at) and `today`? A cohort ending on day D stops on D + 1.
 * `since` = `null` (a process that just started, or woke) cannot know what it
 * slept through, so any dated active cohort counts.
 */
export function windowsCrossed(
  cohorts: readonly (CohortDates & { status: EarningStatus })[],
  since: string | null,
  today: string,
): boolean {
  if (since === today) return false;
  return cohorts.some((c) => {
    const from = c.starts_on ?? null;
    const to = c.ends_on ?? null;
    if (c.status !== 'active' || (from === null && to === null)) return false;
    if (since === null) return true;
    return (
      (from !== null && from > since && from <= today) ||
      (to !== null && to >= since && to < today)
    );
  });
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const dayLabel = (day: string): string => {
  const [y, m, d] = day.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};

/** The dates in words for the cohort's summary line; `null` when it has none. */
export function describeCohortWindow(c: CohortDates): string | null {
  const from = c.starts_on ?? null;
  const to = c.ends_on ?? null;
  if (from !== null && to !== null) {
    return `${dayLabel(from)} – ${dayLabel(to)}`;
  }
  if (from !== null) return `From ${dayLabel(from)}`;
  if (to !== null) return `Until ${dayLabel(to)}`;
  return null;
}

/** Active cohorts in HO's order, the default last; ties by id so every process agrees. */
export function cohortOrder<T extends CohortLike>(cohorts: readonly T[]): T[] {
  const rank = (c: T) =>
    c._id === DEFAULT_COHORT_ID ? Number.MAX_SAFE_INTEGER : c.priority;
  return cohorts
    .filter((c) => c.status === 'active')
    .sort((a, b) => rank(a) - rank(b) || a._id.localeCompare(b._id));
}

/**
 * The partner's cohort on IST `today`: the first active one running that day
 * whose conditions hold, else the default. `today` is passed in, so this
 * stays pure.
 */
export function pickCohort(
  cohorts: readonly CohortLike[],
  partner: PartnerFacts,
  today: string,
): string {
  const facts: Facts = { ...partner };
  for (const c of cohortOrder(cohorts)) {
    if (c._id === DEFAULT_COHORT_ID) break;
    if (!isRunning(c, today)) continue;
    if (matchesConditions(cohortConditionsOf(c), facts)) return c._id;
  }
  return DEFAULT_COHORT_ID;
}

/**
 * `ec_` + a slug of HO's name or key; `null` when nothing usable is left
 * (a name in Devanagari, say), so the caller picks a fallback.
 */
export function cohortIdOf(text: string): string | null {
  const slug = text
    .normalize('NFKD')
    .toLowerCase()
    .replace(/^ec_/, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/_+$/, '');
  return slug ? `ec_${slug}` : null;
}

/** `ec_paddy_belt` → `ec_paddy_belt_2`, cut so the id stays within the pattern. */
export function withSuffix(id: string, n: number): string {
  if (n <= 1) return id;
  const tail = `_${n}`;
  const slug = id.slice(3, 3 + SLUG_MAX - tail.length).replace(/_+$/, '');
  return `ec_${slug}${tail}`;
}

/**
 * Why a reorder cannot be applied, or `null`: it must name every id in
 * `current` exactly once — anything else means the screen is stale.
 */
export function orderError(
  ids: readonly string[],
  current: readonly string[],
): string | null {
  if (new Set(ids).size !== ids.length) return 'An id is listed twice.';
  const now = new Set(current);
  if (ids.length !== now.size || ids.some((id) => !now.has(id))) {
    return 'The list changed since you opened it. Reload and try again.';
  }
  return null;
}

/** Assignment rows of one partner → the cohort at `at`; `null` before the first. */
export function cohortAtIn(
  rows: readonly { cohort_id: string; from: Date }[],
  at: Date,
): string | null {
  let best: { cohort_id: string; from: Date } | null = null;
  for (const row of rows) {
    if (row.from.getTime() > at.getTime()) continue;
    if (!best || row.from.getTime() > best.from.getTime()) best = row;
  }
  return best?.cohort_id ?? null;
}

// ── The rule catalog (code) ──────────────────────────────────────────────

export const REWARD_KINDS = ['coin', 'gig'] as const;
export type RewardKind = (typeof REWARD_KINDS)[number];

export const OPERATORS = ['eq', 'in', 'any_of', 'gte', 'lte'] as const;
export type Operator = (typeof OPERATORS)[number];

export const FIELD_TYPES = ['string', 'number', 'string[]', 'enum'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const OPS_BY_TYPE: Record<FieldType, readonly Operator[]> = {
  string: ['eq', 'in'],
  enum: ['eq', 'in'],
  number: ['eq', 'gte', 'lte'],
  'string[]': ['any_of'],
};

export const OPERATOR_LABELS: Record<Operator, string> = {
  eq: 'is',
  in: 'is one of',
  any_of: 'has any of',
  gte: 'at least',
  lte: 'at most',
};

export interface CatalogField {
  key: string;
  label: string;
  type: FieldType;
  /** The closed set an `enum` field takes. */
  values?: readonly string[];
  /** Kept upper case (states, as partners' are). */
  upper?: boolean;
  hint?: string;
  /** Overrides the type's operators (a cohort's `state` takes any_of, not in). */
  operators?: readonly Operator[];
  /** Cap on a list value of this field (pincode pastes are long); default 200. */
  max_values?: number;
  /** Every value must match (a regex source, so the catalog stays JSON). */
  pattern?: string;
  /** The human message when `pattern` refuses a value. */
  pattern_hint?: string;
}

/** The operators a field takes: its own, else its type's. */
export const opsOf = (field: CatalogField): readonly Operator[] =>
  field.operators ?? OPS_BY_TYPE[field.type];

export interface CatalogTrigger {
  label: string;
  description: string;
  fields: readonly CatalogField[];
}

/** Activities that complete a due follow-up (a note does not). */
export const FOLLOW_UP_ACTIVITIES = ['call', 'visit', 'whatsapp'] as const;

/**
 * Stage moves a partner can make forward (`won` comes only from the first
 * order, `lost` is never an advance) — what `lead_stage_advanced` fires on.
 * The leads module asserts these match its own stage list.
 */
export const ADVANCE_FROM_STAGES = [
  'prospect',
  'contacted',
  'interested',
] as const;
export const ADVANCE_TO_STAGES = [
  'contacted',
  'interested',
  'negotiation',
] as const;

/**
 * Events a rule can pay on. A new trigger needs code (here, and the call that
 * fires it); conditions and rewards are HO's.
 */
export const EARNING_TRIGGERS = [
  'lead_created',
  'follow_up_done',
  'lead_stage_advanced',
  'reorder',
  'meeting_attendee_captured',
  'gig_approved',
  'event_registered',
  'attendance_streak',
  'onboarding_approved',
  'story_created',
] as const;
export type EarningTrigger = (typeof EARNING_TRIGGERS)[number];

export const TRIGGER_CATALOG: Record<EarningTrigger, CatalogTrigger> = {
  lead_created: {
    label: 'Farmer lead added',
    description:
      'The partner adds a new farmer, verified by the farmer’s OTP. Usually pays coins.',
    fields: [
      { key: 'crops', label: 'Crops', type: 'string[]', hint: 'Any case' },
      { key: 'acreage', label: 'Acreage', type: 'number', hint: 'Acres' },
      { key: 'farmer_district', label: 'Farmer district', type: 'string' },
      {
        key: 'farmer_state',
        label: 'Farmer state',
        type: 'string',
        upper: true,
      },
    ],
  },
  follow_up_done: {
    label: 'Follow-up done',
    description:
      'The partner logs a call, visit or WhatsApp on a lead whose follow-up is due today (IST) or overdue. One per due date. Usually pays a gig.',
    fields: [
      {
        key: 'activity_type',
        label: 'Activity',
        type: 'enum',
        values: FOLLOW_UP_ACTIVITIES,
      },
      {
        key: 'days_overdue',
        label: 'Days overdue',
        type: 'number',
        hint: '0 = due today',
      },
    ],
  },
  lead_stage_advanced: {
    label: 'Lead stage advanced',
    description:
      'The partner moves a lead forward (prospect → contacted → interested → negotiation). Once per lead per stage reached; won and lost never fire it. Usually pays coins.',
    fields: [
      {
        key: 'to_stage',
        label: 'Stage reached',
        type: 'enum',
        values: ADVANCE_TO_STAGES,
      },
      {
        key: 'from_stage',
        label: 'Stage before',
        type: 'enum',
        values: ADVANCE_FROM_STAGES,
      },
    ],
  },
  reorder: {
    label: 'Customer ordered again',
    description:
      'A customer’s repeat order is confirmed by the order service (not their first). Once per order. Usually pays coins.',
    fields: [
      {
        key: 'gap_days',
        label: 'Days since previous order',
        type: 'number',
        hint: 'IST days between this order and the one before it',
      },
    ],
  },
  meeting_attendee_captured: {
    label: 'Meeting attendee became a lead',
    description:
      'The partner captures a meeting attendee as a farmer lead (consent + crops + acreage). Once per attendee per meeting; the lead itself may also pay “Farmer lead added”. Usually pays coins.',
    fields: [
      { key: 'crops', label: 'Crops', type: 'string[]', hint: 'Any case' },
      { key: 'acreage', label: 'Acreage', type: 'number', hint: 'Acres' },
    ],
  },
  gig_approved: {
    label: 'Gig work approved',
    description:
      'HO approves the partner’s submitted meeting-gig work. The gig’s own ₹ payout is separate — a rule here is a bonus on top. Once per gig. Usually pays coins.',
    fields: [
      {
        key: 'attendees',
        label: 'Attendees recorded',
        type: 'number',
      },
      { key: 'photos', label: 'Photos uploaded', type: 'number' },
    ],
  },
  event_registered: {
    label: 'Registered for an event',
    description:
      'The partner registers for an HO event and takes a seat. Once per event per partner — leaving and registering again never pays twice. Usually pays coins.',
    fields: [
      {
        key: 'event_id',
        label: 'Event',
        type: 'string',
        hint: 'The event’s id, to reward one event in particular',
      },
    ],
  },
  attendance_streak: {
    label: 'Attendance streak',
    description:
      'The partner punches out with an unbroken run of field days (IST). Fires once per day with the run’s length: “is 7” pays the day a streak reaches 7; “at least 7” pays every day it holds. Usually pays coins.',
    fields: [
      {
        key: 'streak_days',
        label: 'Streak days',
        type: 'number',
        hint: 'Consecutive days punched in, today included (looked back 60 days at most)',
      },
    ],
  },
  onboarding_approved: {
    label: 'Partner approved',
    description:
      'HO approves the partner’s KYC — a welcome reward. Once per partner ever. Usually pays coins.',
    fields: [
      {
        key: 'partner_type',
        label: 'Partner type',
        type: 'string',
        hint: 'The onboarding cohort key picked at signup',
      },
      { key: 'state', label: 'State', type: 'string', upper: true },
    ],
  },
  story_created: {
    label: 'Story created',
    description:
      'The partner saves a new My Story image (an edit of the same story never fires it). Once per story. Usually pays coins.',
    fields: [
      {
        key: 'template',
        label: 'Template',
        type: 'string',
        hint: 'The story template’s key',
      },
    ],
  },
};

export type ConditionValue = string | number | string[];

export interface RuleCondition {
  field: string;
  op: Operator;
  value: ConditionValue;
}

export interface RuleReward {
  kind: RewardKind;
  /** Coins, or ₹ for a gig; a whole number ≥ 1. */
  amount: number;
}

export const MAX_CONDITIONS = 10;
const MAX_VALUES = 200;
const MAX_TEXT = 100;
const MAX_NUMBER = 1_000_000;

/** The facts an event carries, keyed by the catalog's field keys. */
export type Facts = Readonly<
  Record<string, string | number | readonly string[] | null | undefined>
>;

export const fieldOf = (
  trigger: EarningTrigger,
  key: string,
): CatalogField | undefined =>
  TRIGGER_CATALOG[trigger].fields.find((f) => f.key === key);

const isText = (v: unknown): v is string =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= MAX_TEXT;

/**
 * The condition as stored, or why it is refused: the field must be one of
 * `fields`, the operator one the field takes, the value of the field's type.
 * `subject` names what the fields belong to ("Farmer lead added", a cohort).
 */
export function checkConditionIn(
  fields: readonly CatalogField[],
  subject: string,
  c: { field: string; op: string; value: unknown },
): { ok: RuleCondition } | { error: string } {
  const field = fields.find((f) => f.key === c.field);
  if (!field) {
    return { error: `"${c.field}" is not a field of ${subject}.` };
  }
  const ops = opsOf(field);
  if (!(ops as readonly string[]).includes(c.op)) {
    return {
      error: `${field.label} takes ${ops.map((o) => `"${o}"`).join(', ')}, not "${c.op}".`,
    };
  }
  const op = c.op as Operator;
  const fix = (v: string) => (field.upper ? tidy(v).toUpperCase() : tidy(v));
  const fits = (v: string): boolean =>
    !field.pattern || new RegExp(field.pattern).test(v);
  const patternError = () => ({
    error: `${field.label}: ${field.pattern_hint ?? 'a value is not in the right format'}.`,
  });

  if (field.type === 'number') {
    const n = c.value;
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > MAX_NUMBER)
      return { error: `${field.label} needs a number from 0.` };
    return { ok: { field: field.key, op, value: n } };
  }
  if (op === 'eq') {
    if (!isText(c.value))
      return {
        error: `${field.label} needs one value (≤ ${MAX_TEXT} letters).`,
      };
    const value = fix(c.value);
    if (field.values && !field.values.includes(value))
      return { error: `${field.label} is one of ${field.values.join(', ')}.` };
    if (!fits(value)) return patternError();
    return { ok: { field: field.key, op, value } };
  }
  // `in` and `any_of`: a list.
  const max = field.max_values ?? MAX_VALUES;
  const list = c.value;
  if (
    !Array.isArray(list) ||
    list.length === 0 ||
    list.length > max ||
    !list.every(isText)
  ) {
    return {
      error: `${field.label} needs a list of 1–${max} values.`,
    };
  }
  const values = uniqueText(list, field.upper);
  if (field.values) {
    const bad = values.filter((v) => !field.values?.includes(v));
    if (bad.length)
      return { error: `${field.label} is one of ${field.values.join(', ')}.` };
  }
  if (!values.every(fits)) return patternError();
  return { ok: { field: field.key, op, value: values } };
}

/** A rule's condition, against its trigger's fields. */
export function checkCondition(
  trigger: EarningTrigger,
  c: { field: string; op: string; value: unknown },
): { ok: RuleCondition } | { error: string } {
  return checkConditionIn(
    TRIGGER_CATALOG[trigger].fields,
    TRIGGER_CATALOG[trigger].label,
    c,
  );
}

/** One condition against the event's facts; a missing fact never matches. */
export function matchesCondition(c: RuleCondition, facts: Facts): boolean {
  const fact = facts[c.field];
  if (fact === null || fact === undefined) return false;
  switch (c.op) {
    case 'eq':
      return typeof c.value === 'number'
        ? fact === c.value
        : typeof fact === 'string' &&
            typeof c.value === 'string' &&
            normText(fact) === normText(c.value);
    case 'in':
      return (
        typeof fact === 'string' &&
        Array.isArray(c.value) &&
        c.value.some((v) => normText(v) === normText(fact))
      );
    case 'any_of': {
      if (!Array.isArray(c.value)) return false;
      const wanted = new Set(c.value.map(normText));
      // A scalar fact (a cohort's state, district, pincode) is "is any of".
      if (typeof fact === 'string') return wanted.has(normText(fact));
      if (!Array.isArray(fact)) return false;
      return (fact as readonly string[]).some((f) => wanted.has(normText(f)));
    }
    case 'gte':
      return typeof fact === 'number' && fact >= (c.value as number);
    case 'lte':
      return typeof fact === 'number' && fact <= (c.value as number);
  }
}

export interface RuleLike {
  _id: string;
  trigger: EarningTrigger;
  conditions: RuleCondition[];
  reward: RuleReward;
  order: number;
  status: EarningStatus;
  /** HO's ON/OFF switch; absent on rules from before it (read as on). */
  enabled?: boolean;
}

/** HO's ON/OFF switch (user, 2026-10-22); a rule saved before it existed is on. */
export const ruleEnabled = (r: { enabled?: boolean }): boolean =>
  r.enabled !== false;

/** Active and switched on: the only rules that pay, and the only ones the app shows. */
export const rulePays = (r: {
  status: EarningStatus;
  enabled?: boolean;
}): boolean => r.status === 'active' && ruleEnabled(r);

/**
 * What one event pays: the cohort's active rules for the trigger in HO's
 * order; per reward kind the first rule whose conditions all hold. So a coin
 * rule and a gig rule can both pay on one event, never two coin rules.
 */
export function pickRewards<T extends RuleLike>(
  rules: readonly T[],
  trigger: EarningTrigger,
  facts: Facts,
): T[] {
  const paid = new Set<RewardKind>();
  const out: T[] = [];
  // A switched-off rule is left out as if it were not there, so the next
  // matching rule of its kind in the cohort pays instead: turning off a
  // bonus rule falls back to the catch-all after it, not to nothing.
  const ordered = rules
    .filter((r) => rulePays(r) && r.trigger === trigger)
    .sort((a, b) => a.order - b.order || a._id.localeCompare(b._id));
  for (const rule of ordered) {
    if (paid.has(rule.reward.kind)) continue;
    if (rule.conditions.every((c) => matchesCondition(c, facts))) {
      paid.add(rule.reward.kind);
      out.push(rule);
    }
  }
  return out;
}

/** A long list reads "462001, … +1,994 more", not two thousand values. */
const SUMMARY_VALUES = 8;

/** "Crops has any of Wheat, Soybean · Acreage at least 2" — for the app and HO lists. */
export function describeConditionsIn(
  fields: readonly CatalogField[],
  conditions: readonly RuleCondition[],
  empty: string,
): string {
  if (conditions.length === 0) return empty;
  return conditions
    .map((c) => {
      const label = fields.find((f) => f.key === c.field)?.label ?? c.field;
      const value = Array.isArray(c.value)
        ? c.value.slice(0, SUMMARY_VALUES).join(', ') +
          (c.value.length > SUMMARY_VALUES
            ? ` +${(c.value.length - SUMMARY_VALUES).toLocaleString('en-IN')} more`
            : '')
        : c.value;
      return `${label} ${OPERATOR_LABELS[c.op]} ${value}`;
    })
    .join(' · ');
}

export function describeConditions(
  trigger: EarningTrigger,
  conditions: readonly RuleCondition[],
): string {
  return describeConditionsIn(
    TRIGGER_CATALOG[trigger].fields,
    conditions,
    'Every time',
  );
}

// ── Cohort conditions ────────────────────────────────────────────────────
//
// A cohort is matched by the same `{ field, op, value }` conditions the rules
// use, over `PartnerFacts`. All conditions must hold; a list value holds when
// any of its entries matches. The legacy `filters` object converts both ways.

export const MAX_COHORT_CONDITIONS = 12;

/** The partner facts a cohort can condition on — what `factsOf` reads today. */
export const COHORT_FIELD_CATALOG: readonly CatalogField[] = [
  {
    key: 'state',
    label: 'State',
    type: 'string',
    upper: true,
    operators: ['eq', 'any_of'],
    max_values: MAX_STATES,
    hint: 'Profile state (kept upper case)',
  },
  {
    key: 'district',
    label: 'District',
    type: 'string',
    operators: ['eq', 'any_of'],
    max_values: MAX_DISTRICTS,
    hint: 'Profile district, any case',
  },
  {
    key: 'pincode',
    label: 'Pincode',
    type: 'string',
    operators: ['eq', 'any_of'],
    max_values: MAX_PINCODES,
    pattern: '^[1-9]\\d{5}$',
    pattern_hint: 'each pincode is 6 digits',
    hint: 'Profile pincode',
  },
  {
    key: 'open_leads',
    label: 'Open leads',
    type: 'number',
    operators: ['gte', 'lte'],
    hint: 'Leads held now, not won, not lost',
  },
  {
    key: 'customers',
    label: 'Customers',
    type: 'number',
    operators: ['gte', 'lte'],
    hint: 'Won leads held now',
  },
] as const;

/** Every condition holds; an empty list takes everyone (only the default may). */
export const matchesConditions = (
  conditions: readonly RuleCondition[],
  facts: Facts,
): boolean => conditions.every((c) => matchesCondition(c, facts));

/** A cohort's conditions, converting a pre-conditions row on the spot. */
export const cohortConditionsOf = (c: CohortLike): RuleCondition[] =>
  c.conditions ?? filtersToConditions(c.filters);

/**
 * Legacy `filters` → the conditions they mean. The order is fixed (place
 * first, thresholds last) so a round trip compares equal.
 */
export function filtersToConditions(
  input: FiltersInput | null | undefined,
): RuleCondition[] {
  const f = normalizeFilters(input);
  const out: RuleCondition[] = [];
  if (f.states.length)
    out.push({ field: 'state', op: 'any_of', value: f.states });
  if (f.districts.length)
    out.push({ field: 'district', op: 'any_of', value: f.districts });
  if (f.pincodes.length)
    out.push({ field: 'pincode', op: 'any_of', value: f.pincodes });
  if (f.min_leads !== null)
    out.push({ field: 'open_leads', op: 'gte', value: f.min_leads });
  if (f.min_customers !== null)
    out.push({ field: 'customers', op: 'gte', value: f.min_customers });
  return out;
}

/**
 * The legacy view of conditions, best effort: a condition the old shape
 * cannot say (an `lte`, say) just does not appear. First one per slot wins.
 */
export function conditionsToFilters(
  conditions: readonly RuleCondition[],
): EarningFilters {
  const f: EarningFilters = { ...NO_FILTERS };
  const asList = (v: ConditionValue): string[] =>
    Array.isArray(v) ? [...v] : typeof v === 'string' ? [v] : [];
  for (const c of conditions) {
    if (c.field === 'state' && (c.op === 'any_of' || c.op === 'eq')) {
      if (!f.states.length) f.states = asList(c.value);
    } else if (c.field === 'district' && (c.op === 'any_of' || c.op === 'eq')) {
      if (!f.districts.length) f.districts = asList(c.value);
    } else if (c.field === 'pincode' && (c.op === 'any_of' || c.op === 'eq')) {
      if (!f.pincodes.length) f.pincodes = asList(c.value);
    } else if (
      c.field === 'open_leads' &&
      c.op === 'gte' &&
      typeof c.value === 'number'
    ) {
      if (f.min_leads === null) f.min_leads = c.value;
    } else if (
      c.field === 'customers' &&
      c.op === 'gte' &&
      typeof c.value === 'number'
    ) {
      if (f.min_customers === null) f.min_customers = c.value;
    }
  }
  return f;
}

/** The cohort's conditions in words, for HO lists and the app. */
export const describeCohortConditions = (
  conditions: readonly RuleCondition[],
): string =>
  describeConditionsIn(COHORT_FIELD_CATALOG, conditions, 'Every partner');
