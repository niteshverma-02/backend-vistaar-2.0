import { istDate } from '@common/utils/ist-day.util';
/**
 * The app's Feedback screen (`/feedback`): an NPS score with reason chips, a
 * comment and an app rating, plus "Suggest a product" for what farmers ask
 * for and Katyayani does not sell.
 */

export const NPS_BUCKETS = ['detractor', 'passive', 'promoter'] as const;
export type NpsBucket = (typeof NPS_BUCKETS)[number];

/** The app's `npsBucket`: 0–6 detractor, 7–8 passive, 9–10 promoter. */
export function npsBucket(score: number): NpsBucket {
  if (score <= 6) return 'detractor';
  return score <= 8 ? 'passive' : 'promoter';
}

/** % promoters − % detractors, rounded; `null` with no answers yet. */
export function npsScore(counts: Record<NpsBucket, number>): number | null {
  const total = counts.detractor + counts.passive + counts.promoter;
  if (total === 0) return null;
  return Math.round(((counts.promoter - counts.detractor) * 100) / total);
}

export const COMMENT_MAX = 500;
export const REASON_MAX = 60;
export const REASONS_PER_ANSWER_MAX = 10;

export const SUGGESTION_PRODUCT_MAX = 80;
export const SUGGESTION_CROP_MAX = 40;
export const SUGGESTION_QTY_MAX = 30;
export const SUGGESTION_NOTE_MAX = 300;

/**
 * A partner's answers per IST day. "Give more feedback" is a real button, so
 * a few is normal; this only stops a looping client from filling the desk.
 */
export const FEEDBACK_PER_DAY_MAX = 10;
export const SUGGESTIONS_PER_DAY_MAX = 20;

export interface NpsReasons {
  question: string;
  chips: string[];
}
export type NpsReasonSet = Record<NpsBucket, NpsReasons>;

export const CHIPS_PER_BUCKET_MAX = 12;
export const QUESTION_MAX = 120;

/** The app's own copy (`help_seed.dart` `npsReasons`), until HO changes it. */
export const DEFAULT_NPS_REASONS: NpsReasonSet = {
  detractor: {
    question: 'What went wrong?',
    chips: [
      'Late delivery',
      'Commission delayed',
      'Stock not available',
      'Price too high',
      'App is confusing',
      'No support from officer',
    ],
  },
  passive: {
    question: 'What would make it a 10?',
    chips: [
      'Faster delivery',
      'Higher commission',
      'More products',
      'Better app',
      'More training',
      'Quicker payouts',
    ],
  },
  promoter: {
    question: 'What do you like most?',
    chips: [
      'Product quality',
      'Timely commission',
      'Fast delivery',
      'Helpful officer',
      'Easy app',
      'Farmer results',
    ],
  },
};

/**
 * A bucket HO never saved (or saved broken) falls back to the app's copy, so
 * the screen always has a question and chips for every score.
 */
export function withDefaults(
  stored: Record<string, { question?: unknown; chips?: unknown }> | null,
): NpsReasonSet {
  const out = { ...DEFAULT_NPS_REASONS };
  for (const bucket of NPS_BUCKETS) {
    const r = stored?.[bucket];
    if (
      r &&
      typeof r.question === 'string' &&
      Array.isArray(r.chips) &&
      r.chips.every((c) => typeof c === 'string')
    ) {
      out[bucket] = { question: r.question, chips: r.chips };
    }
  }
  return out;
}

/**
 * The reasons as stored: trimmed, blanks and repeats dropped (first spelling
 * kept). Not checked against today's chips — HO may have edited them while
 * the phone still shows the old ones, and the partner's words still count.
 */
export function cleanReasons(reasons: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of reasons ?? []) {
    const r = raw.trim();
    const key = r.toLowerCase();
    if (!r || seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/** HO's chip list for one bucket: same cleaning, so the app never shows a repeat. */
export const cleanChips = cleanReasons;

export const FOLLOW_UP_STATUSES = ['open', 'done'] as const;
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];

/** "Your Prasar Officer will call you within 2 working days." */
export const FOLLOW_UP_WORKING_DAYS = 2;

const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

/**
 * End of the Nth working day after `from` (IST): Monday to Saturday count,
 * Sunday does not — the field week. Due at 23:59:59.999 IST that day.
 */
export function followUpDueAt(
  from: Date,
  workingDays = FOLLOW_UP_WORKING_DAYS,
): Date {
  // Midnight IST of `from`'s day, expressed as a UTC instant.
  let dayStart = Date.parse(`${istDate(from)}T00:00:00Z`) - IST_OFFSET_MS;
  let left = workingDays;
  while (left > 0) {
    dayStart += DAY_MS;
    const weekday = new Date(dayStart + IST_OFFSET_MS).getUTCDay();
    if (weekday !== 0) left -= 1;
  }
  return new Date(dayStart + DAY_MS - 1);
}

export const SUGGESTION_STATUSES = [
  'new',
  'reviewed',
  'planned',
  'declined',
] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

/** `SUG-000001` — what the partner's toast quotes and the desk searches. */
export const formatSuggestionRef = (n: number): string =>
  `SUG-${String(n).padStart(6, '0')}`;

export const SUGGESTION_REF = /^SUG-\d{6,}$/;

/**
 * The key suggestions are grouped by on the desk: "Emamectin  Benzoate 5% sg"
 * and "emamectin benzoate 5% SG" are the same ask.
 */
export const productKey = (product: string): string =>
  product.trim().toLowerCase().replace(/\s+/g, ' ');

/** A HO date range is at most a year (inclusive `from`..`to`). */
export const RANGE_DAYS_MAX = 366;

export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** `[from 00:00 IST, to+1 00:00 IST)` as UTC instants; `null` when the range is not valid. */
export function istRange(
  from: string,
  to: string,
): { start: Date; end: Date } | null {
  const start = Date.parse(`${from}T00:00:00Z`) - IST_OFFSET_MS;
  const end = Date.parse(`${to}T00:00:00Z`) - IST_OFFSET_MS + DAY_MS;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (end <= start || end - start > RANGE_DAYS_MAX * DAY_MS) return null;
  return { start: new Date(start), end: new Date(end) };
}

export const OBJECT_ID = /^[0-9a-f]{24}$/i;
