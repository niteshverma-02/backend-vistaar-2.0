import {
  DAY_MS,
  istDayStart,
  istDaysBetween,
} from '@common/utils/ist-day.util';
import { haversineKm } from '@common/utils/geo.util';

/**
 * Meeting gigs (PRD AD14, G1/G2; Lovable Gigs / GigDetail): HO posts a paid
 * farmer meeting, a partner takes it, checks in at the venue, records who came
 * with photos, and HO approves the proof. Pure rules — services only fetch.
 */

export const GIG_STATUSES = [
  'open',
  'accepted',
  'checked_in',
  'submitted',
  'approved',
  'rejected',
  'cancelled',
] as const;
export type GigStatus = (typeof GIG_STATUSES)[number];

/** Held by a partner and not yet sent for review. */
export const HELD: readonly GigStatus[] = ['accepted', 'checked_in'];
/** Decided or withdrawn: nothing moves it again. */
export const FINAL: readonly GigStatus[] = [
  'approved',
  'rejected',
  'cancelled',
];

/** Check-in is allowed whatever these say; HO sees them at review. */
export const CHECKIN_FLAGS = ['early', 'late', 'no_gps', 'far'] as const;
export type CheckinFlag = (typeof CHECKIN_FLAGS)[number];

export const MAX_GIG_ATTENDEES = 300;
export const MAX_GIG_PHOTOS = 6;
/** A phone seen at any gig this recently is flagged to HO (PRD: duplicate farmers). */
export const REPEAT_PHONE_DAYS = 30;

export interface GigPoint {
  lat: number;
  lng: number;
}

/**
 * Whose pay a gig carries (user + TL, 2026-10-16): `gig` = HO set a payout on
 * the gig; `cohort` = HO left it empty, so the partner who takes it earns
 * their earning cohort's meeting-gig payout, fixed when they take it.
 */
export const PAYOUT_SOURCES = ['gig', 'cohort'] as const;
export type PayoutSource = (typeof PAYOUT_SOURCES)[number];

/** Gigs posted before payout sources carry HO's payout (settings' default copied at posting). */
export const payoutSourceOf = (g: {
  payout_source?: PayoutSource | null;
}): PayoutSource => g.payout_source ?? 'gig';

/** A cohort-paid gig's ₹ for one partner: their cohort's meeting-gig payout, else settings. */
export const cohortPayout = (
  cohortRate: number | null,
  settingsRate: number,
): number => cohortRate ?? settingsRate;

/** What taking a gig (accept / HO assign) sets on its pay: a cohort-paid gig fixes the taker's rate. */
export function payoutOnTake(
  g: { payout_source?: PayoutSource | null },
  takerRate: number,
): { payout?: number } {
  return payoutSourceOf(g) === 'cohort' ? { payout: takerRate } : {};
}

/** What giving a gig back (release / HO reopen) sets: a cohort-paid gig waits for the next taker's rate. */
export function payoutOnRelease(g: { payout_source?: PayoutSource | null }): {
  payout?: null;
} {
  return payoutSourceOf(g) === 'cohort' ? { payout: null } : {};
}

/**
 * Who an open gig is for (user, 2026-10-22): two independent lists, and both
 * must let the partner in. `cohorts` = partner types (the onboarding cohort,
 * e.g. `vistaar_agent`); `earning_cohorts` = HO's earning cohorts (`ec_…`,
 * built from place and holdings). An empty list lets everyone in.
 */
export interface GigAudience {
  cohorts: string[];
  /** Gigs posted before 2026-10-22 have none: read as every earning cohort. */
  earning_cohorts?: string[] | null;
}

export const earningCohortsOf = (g: {
  earning_cohorts?: string[] | null;
}): string[] => g.earning_cohorts ?? [];

/** The partner's type is on the gig's `cohorts`, or the gig names none. */
export const forCohort = (
  g: Pick<GigAudience, 'cohorts'>,
  cohort: string | null,
): boolean =>
  g.cohorts.length === 0 || (cohort !== null && g.cohorts.includes(cohort));

/**
 * The partner's earning cohort now is on the gig's `earning_cohorts`, or the
 * gig names none. A partner not placed in one yet (not approved) is in none.
 */
export function forEarningCohort(
  g: Pick<GigAudience, 'earning_cohorts'>,
  earningCohortId: string | null,
): boolean {
  const ids = earningCohortsOf(g);
  return (
    ids.length === 0 ||
    (earningCohortId !== null && ids.includes(earningCohortId))
  );
}

/** Both lists at once — what the Available tab, gig detail and accept check. */
export const isForPartner = (
  g: GigAudience,
  partner: {
    cohort: string | null;
    earning_cohort?: { id: string } | null;
  },
): boolean =>
  forCohort(g, partner.cohort) &&
  forEarningCohort(g, partner.earning_cohort?.id ?? null);

/**
 * What a partner may see and take of a gig that is not theirs: `isForPartner`,
 * and the same state when both are known. Gig ids run in order, so detail and
 * accept check this too, not only the Available tab.
 */
export function mayTake(
  g: GigAudience & { state: string | null },
  partner: Parameters<typeof isForPartner>[1] & {
    profile?: { state?: string } | null;
    preview: { state?: string };
  },
): boolean {
  const state = (
    partner.profile?.state ?? partner.preview.state
  )?.toUpperCase();
  return isForPartner(g, partner) && (!state || !g.state || g.state === state);
}

/** Accepted or checked in, and the gig's IST day has passed: HO cancels or reopens it. */
export function isMissed(
  gig: { status: GigStatus; starts_at: Date },
  now: Date,
): boolean {
  return HELD.includes(gig.status) && istDaysBetween(gig.starts_at, now) > 0;
}

/** A partner may give a gig back up to the day before it. */
export function releaseError(starts_at: Date, now: Date): string | null {
  return istDaysBetween(now, starts_at) >= 1
    ? null
    : 'A gig can be given back only before its day. Ask HO to reassign it.';
}

export function checkinFlags(
  gig: { starts_at: Date; venue_point: GigPoint | null },
  at: GigPoint | null,
  now: Date,
  radiusM: number,
): { flags: CheckinFlag[]; distance_m: number | null } {
  const flags: CheckinFlag[] = [];
  const days = istDaysBetween(now, gig.starts_at);
  if (days > 0) flags.push('early');
  if (days < 0) flags.push('late');
  if (!at) flags.push('no_gps');
  const distance_m =
    at && gig.venue_point
      ? Math.round(
          haversineKm(
            at.lat,
            at.lng,
            gig.venue_point.lat,
            gig.venue_point.lng,
          ) * 1000,
        )
      : null;
  if (distance_m !== null && distance_m > radiusM) flags.push('far');
  return { flags, distance_m };
}

/** What still blocks a submit; empty when the proof is enough. */
export function submitProblems(
  gig: { min_farmers: number; photos_required: number },
  attendees: number,
  photos: number,
): string[] {
  const out: string[] = [];
  if (attendees < gig.min_farmers) {
    out.push(
      `Add ${gig.min_farmers - attendees} more farmer${gig.min_farmers - attendees === 1 ? '' : 's'} (at least ${gig.min_farmers}).`,
    );
  }
  if (photos < gig.photos_required) {
    out.push(
      `Add ${gig.photos_required - photos} more photo${gig.photos_required - photos === 1 ? '' : 's'} (at least ${gig.photos_required}).`,
    );
  }
  return out;
}

/** Distance from the partner to the venue, in km to one decimal; `null` when either is unknown. */
export function distanceKm(
  from: GigPoint | null,
  venue: GigPoint | null,
): number | null {
  if (!from || !venue) return null;
  return (
    Math.round(haversineKm(from.lat, from.lng, venue.lat, venue.lng) * 10) / 10
  );
}

/** The IST day `[start, end)` a gig falls on — for "another gig that day". */
export function istDayOf(at: Date): { from: Date; to: Date } {
  const from = istDayStart(at);
  return { from, to: new Date(from.getTime() + DAY_MS) };
}
