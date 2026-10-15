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

/** Defaults from settings, HO-changeable per gig (user's decision, 2026-10-15). */
export interface GigRules {
  payout: number;
  min_farmers: number;
  photos_required: number;
  checkin_radius_m: number;
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
