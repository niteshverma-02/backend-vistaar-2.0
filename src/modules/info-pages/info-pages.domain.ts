/**
 * The app's three info pages — About Vistaar, About Katyayani, Contact Us —
 * as one HO-edited document each. The app keeps its layout and icons; every
 * word, number and list on those pages comes from here.
 */

export const INFO_PAGES = [
  'about_program',
  'about_company',
  'contact_us',
] as const;
export type InfoPageKey = (typeof INFO_PAGES)[number];

// ── About Vistaar ────────────────────────────────────────────────────────────

/** The app owns an icon per step; HO words and orders them. */
export const LIFECYCLE_STEPS = ['pending', 'confirmed', 'withdraw'] as const;
export type LifecycleStep = (typeof LIFECYCLE_STEPS)[number];

/** "More in the app" rows; each opens a fixed screen in the app. */
export const MORE_LINKS = [
  'testimonials',
  'grievances',
  'kkd_activity',
] as const;
export type MoreLink = (typeof MORE_LINKS)[number];

/**
 * Values the app fills in at display time, because they live elsewhere and
 * change on their own (wallet settings, grievance SLA). Any other `{…}` in
 * HO's text would show raw on a partner's phone, so it is refused.
 */
export const PLACEHOLDERS = ['min_withdrawal', 'grievance_sla_hours'] as const;

export interface TitleBody {
  title: string;
  body: string;
}

export interface ProgrammeRule {
  text: string;
  /** A cohort key; `null` = applies to everyone. */
  cohort: string | null;
}

export interface AboutProgramContent {
  hero: { title: string; tagline: string; intro: string };
  who_can_join: { heading: string };
  earn: {
    heading: string;
    commission: TitleBody;
    gigs: TitleBody;
    no_payout: TitleBody;
    referral: TitleBody;
  };
  lifecycle: {
    heading: string;
    steps: ({ key: LifecycleStep } & TitleBody)[];
    reversed_note: string;
  };
  payouts: { heading: string; points: string[] };
  rules: {
    heading: string;
    items: ProgrammeRule[];
    sop: { label: string; sop_id: string } | null;
  };
  coins: { heading: string; headline: string; body: string };
  more: { heading: string; items: ({ key: MoreLink } & TitleBody)[] };
  footer: string;
}

// ── About Katyayani ──────────────────────────────────────────────────────────

export interface CompanyTile {
  title: string;
  text: string;
  emoji: string;
}

export interface AboutCompanyContent {
  name: string;
  tagline: string;
  story: string[];
  mission: string;
  stats: { label: string; value: string }[];
  what_we_make: CompanyTile[];
  quality_points: string[];
  ecosystem: CompanyTile[];
  contact: { helpline: string; email: string; website: string };
  social: { label: string; url: string }[];
}

// ── Contact Us ───────────────────────────────────────────────────────────────

/** Head Office hours in IST. `days` are ISO weekdays: 1 = Monday … 7 = Sunday. */
export interface OfficeHours {
  days: number[];
  /** `HH:mm`, 24-hour. */
  opens: string;
  /** `HH:mm`, 24-hour, after `opens`. */
  closes: string;
  /** What the app prints, e.g. "Mon – Sat, 10 AM – 7 PM · Sunday closed". */
  label: string;
}

export interface ContactUsContent {
  /** 10 digits, dialled as `tel:+91<number>`; `label` is how it is printed. */
  helpline: { number: string; label: string };
  /** 10 digits, opened as `https://wa.me/91<number>`. */
  whatsapp: { number: string; label: string };
  support_email: string;
  privacy_email: string;
  play_store_url: string;
  hours: OfficeHours;
  ticket_categories: string[];
  ticket_reply_note: string;
}

export type InfoPageContent = {
  about_program: AboutProgramContent;
  about_company: AboutCompanyContent;
  contact_us: ContactUsContent;
};

// ── Rules ────────────────────────────────────────────────────────────────────

export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const IST_OFFSET_MIN = 330;

const minutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** Open on one of `days`, from `opens` up to (not including) `closes`, IST. */
export function isOpenAt(hours: OfficeHours, now: Date): boolean {
  const ist = new Date(now.getTime() + IST_OFFSET_MIN * 60_000);
  const weekday = ist.getUTCDay() === 0 ? 7 : ist.getUTCDay();
  if (!hours.days.includes(weekday)) return false;
  const at = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return at >= minutes(hours.opens) && at < minutes(hours.closes);
}

/** What class-validator cannot say about the hours: their order. */
export function hoursProblems(hours: OfficeHours): string[] {
  const problems: string[] = [];
  if (minutes(hours.closes) <= minutes(hours.opens)) {
    problems.push('The closing time must be after the opening time.');
  }
  if (new Set(hours.days).size !== hours.days.length) {
    problems.push('A working day is listed twice.');
  }
  return problems;
}

/** Every string anywhere inside `value`, depth-first. */
function* strings(value: unknown): Generator<string> {
  if (typeof value === 'string') yield value;
  else if (Array.isArray(value)) for (const v of value) yield* strings(v);
  else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) yield* strings(v);
  }
}

/** `{name}` tokens the app would not fill. */
export function unknownPlaceholders(content: unknown): string[] {
  const known = new Set<string>(PLACEHOLDERS);
  const found = new Set<string>();
  for (const s of strings(content)) {
    for (const [, name] of s.matchAll(/\{([^{}]*)\}/g)) {
      if (!known.has(name)) found.add(name);
    }
  }
  return [...found];
}

/** A key listed twice would draw the same step or row twice. */
export function duplicateKeys(items: { key: string }[]): string[] {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const { key } of items) (seen.has(key) ? twice : seen).add(key);
  return [...twice];
}

/** The distinct cohort keys the rules name, to check they exist. */
export const ruleCohorts = (rules: ProgrammeRule[]): string[] => [
  ...new Set(rules.map((r) => r.cohort).filter((c): c is string => !!c)),
];

/** Everything wrong with a page's content that its DTO cannot see. */
export function contentProblems<K extends InfoPageKey>(
  page: K,
  content: InfoPageContent[K],
): string[] {
  const problems: string[] = [];
  const unknown = unknownPlaceholders(content);
  if (unknown.length) {
    problems.push(
      `The app cannot fill {${unknown.join('}, {')}}. Use only {${PLACEHOLDERS.join('} or {')}}.`,
    );
  }
  if (page === 'about_program') {
    const c = content as AboutProgramContent;
    const steps = duplicateKeys(c.lifecycle.steps);
    if (steps.length)
      problems.push(`Lifecycle step ${steps.join(', ')} is listed twice.`);
    const rows = duplicateKeys(c.more.items);
    if (rows.length)
      problems.push(
        `"More in the app" row ${rows.join(', ')} is listed twice.`,
      );
  }
  if (page === 'contact_us') {
    problems.push(...hoursProblems((content as ContactUsContent).hours));
  }
  return problems;
}
