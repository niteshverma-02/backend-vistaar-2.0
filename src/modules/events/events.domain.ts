/**
 * HO-run farmer events — Kisan Melas, trainings, webinars, field days (PRD
 * Learn · events). Partners see the ones for their cohort, register a seat,
 * and invite farmers to them with My Story's Meeting template. Pure rules.
 */
export const EVENT_TYPES = [
  'kisan_mela',
  'training',
  'webinar',
  'field_day',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_STATUSES = ['upcoming', 'past', 'inactive'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const MAX_SEATS = 100_000;

export interface EventWindow {
  is_active: boolean;
  starts_at: Date;
}

export function eventStatus(e: EventWindow, now: Date): EventStatus {
  if (!e.is_active) return 'inactive';
  return e.starts_at > now ? 'upcoming' : 'past';
}

/** An empty `cohorts` list means every partner. */
export function isForCohort(
  e: { cohorts: string[] },
  cohort: string | null,
): boolean {
  return (
    e.cohorts.length === 0 || (cohort !== null && e.cohorts.includes(cohort))
  );
}

/** Registration opens for an active event until it starts, while a seat is left. */
export function registerError(
  e: EventWindow & { seats: number; registered_count: number },
  now: Date,
): 'EVENT_CLOSED' | 'EVENT_FULL' | null {
  if (eventStatus(e, now) !== 'upcoming') return 'EVENT_CLOSED';
  if (e.registered_count >= e.seats) return 'EVENT_FULL';
  return null;
}

export const EVENT_NOT_FOUND =
  'This event could not be found. It may have been cancelled or deleted.';

/** HO may not cut seats below the partners already holding one. */
export function seatsError(seats: number, registered: number): string | null {
  if (seats < registered) {
    return `${registered} partners have already registered, so the seats cannot be less than ${registered}.`;
  }
  return null;
}

export const registrationId = (eventId: string, agentId: string): string =>
  `${eventId}:${agentId}`;
