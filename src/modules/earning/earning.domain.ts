/**
 * Earning cohorts and the light rule engine (user + TL, 2026-10-16).
 *
 * An earning cohort is **not** the onboarding cohort (`vistaar_v2_cohorts`,
 * the partner type and its form). HO builds earning cohorts from filters on
 * where the partner is (profile state / district / pincode) and what they hold
 * now (open leads, customers). A partner is in exactly one: the first match in
 * HO's priority order, else the built-in default. The cohort fixes the
 * commission plan, the meeting-gig payout, and which coin / gig rules pay.
 *
 * Everything here is pure: the services load rows and call these.
 */

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

export interface CohortLike {
  _id: string;
  status: EarningStatus;
  priority: number;
  filters: EarningFilters;
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

const inList = (list: readonly string[], value: string | null): boolean => {
  if (!value) return false;
  const key = normText(value);
  return list.some((v) => normText(v) === key);
};

/** Every used filter holds (AND); inside one, any value does (OR). */
export function matchesFilters(f: EarningFilters, p: PartnerFacts): boolean {
  if (f.states.length && !inList(f.states, p.state)) return false;
  if (f.districts.length && !inList(f.districts, p.district)) return false;
  if (
    f.pincodes.length &&
    !(p.pincode && f.pincodes.includes(p.pincode.trim()))
  )
    return false;
  if (f.min_leads !== null && p.open_leads < f.min_leads) return false;
  if (f.min_customers !== null && p.customers < f.min_customers) return false;
  return true;
}

/** Active cohorts in HO's order, the default last; ties by id so every process agrees. */
export function cohortOrder<T extends CohortLike>(cohorts: readonly T[]): T[] {
  const rank = (c: T) =>
    c._id === DEFAULT_COHORT_ID ? Number.MAX_SAFE_INTEGER : c.priority;
  return cohorts
    .filter((c) => c.status === 'active')
    .sort((a, b) => rank(a) - rank(b) || a._id.localeCompare(b._id));
}

/** The partner's cohort: the first active one whose filters hold, else the default. */
export function pickCohort(
  cohorts: readonly CohortLike[],
  partner: PartnerFacts,
): string {
  for (const c of cohortOrder(cohorts)) {
    if (c._id === DEFAULT_COHORT_ID) break;
    if (matchesFilters(c.filters, partner)) return c._id;
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
}

export interface CatalogTrigger {
  label: string;
  description: string;
  fields: readonly CatalogField[];
}

/** Activities that complete a due follow-up (a note does not). */
export const FOLLOW_UP_ACTIVITIES = ['call', 'visit', 'whatsapp'] as const;

/**
 * Events a rule can pay on. A new trigger needs code (here, and the call that
 * fires it); conditions and rewards are HO's.
 */
export const EARNING_TRIGGERS = ['lead_created', 'follow_up_done'] as const;
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
 * The condition as stored, or why it is refused: the field must be the
 * trigger's, the operator one its type takes, the value of that type.
 */
export function checkCondition(
  trigger: EarningTrigger,
  c: { field: string; op: string; value: unknown },
): { ok: RuleCondition } | { error: string } {
  const field = fieldOf(trigger, c.field);
  if (!field) {
    return {
      error: `"${c.field}" is not a field of ${TRIGGER_CATALOG[trigger].label}.`,
    };
  }
  const ops = OPS_BY_TYPE[field.type];
  if (!(ops as readonly string[]).includes(c.op)) {
    return {
      error: `${field.label} takes ${ops.map((o) => `"${o}"`).join(', ')}, not "${c.op}".`,
    };
  }
  const op = c.op as Operator;
  const fix = (v: string) => (field.upper ? tidy(v).toUpperCase() : tidy(v));

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
    return { ok: { field: field.key, op, value } };
  }
  // `in` and `any_of`: a list.
  const list = c.value;
  if (
    !Array.isArray(list) ||
    list.length === 0 ||
    list.length > MAX_VALUES ||
    !list.every(isText)
  ) {
    return {
      error: `${field.label} needs a list of 1–${MAX_VALUES} values.`,
    };
  }
  const values = uniqueText(list, field.upper);
  if (field.values) {
    const bad = values.filter((v) => !field.values?.includes(v));
    if (bad.length)
      return { error: `${field.label} is one of ${field.values.join(', ')}.` };
  }
  return { ok: { field: field.key, op, value: values } };
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
      if (!Array.isArray(fact) || !Array.isArray(c.value)) return false;
      const wanted = new Set(c.value.map(normText));
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
}

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
  const ordered = rules
    .filter((r) => r.status === 'active' && r.trigger === trigger)
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

/** "Crops has any of Wheat, Soybean · Acreage at least 2" — for the app and HO lists. */
export function describeConditions(
  trigger: EarningTrigger,
  conditions: readonly RuleCondition[],
): string {
  if (conditions.length === 0) return 'Every time';
  return conditions
    .map((c) => {
      const label = fieldOf(trigger, c.field)?.label ?? c.field;
      const value = Array.isArray(c.value) ? c.value.join(', ') : c.value;
      return `${label} ${OPERATOR_LABELS[c.op]} ${value}`;
    })
    .join(' · ');
}
