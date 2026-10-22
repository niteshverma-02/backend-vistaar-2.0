import { badRequest } from '@common/errors/api-error';

/**
 * HO-scheduled content (banners, My Story festivals, designs and cards): an
 * on/off switch plus an optional start and end.
 */
export const WINDOW_STATUSES = [
  'live',
  'scheduled',
  'expired',
  'inactive',
] as const;
export type WindowStatus = (typeof WINDOW_STATUSES)[number];

export interface ScheduleWindow {
  is_active: boolean;
  starts_at: Date | null;
  ends_at: Date | null;
}

export function windowStatus(w: ScheduleWindow, now: Date): WindowStatus {
  if (!w.is_active) return 'inactive';
  if (w.ends_at && w.ends_at <= now) return 'expired';
  if (w.starts_at && w.starts_at > now) return 'scheduled';
  return 'live';
}

/** The Mongo side of `windowStatus` — keep the two in step. */
export function windowQuery(
  status: WindowStatus | undefined,
  now: Date,
): Record<string, unknown> {
  switch (status) {
    case 'inactive':
      return { is_active: false };
    case 'expired':
      return { is_active: true, ends_at: { $lte: now } };
    case 'scheduled':
      return {
        is_active: true,
        starts_at: { $gt: now },
        $or: [{ ends_at: null }, { ends_at: { $gt: now } }],
      };
    case 'live':
      return {
        $and: [
          { is_active: true },
          { $or: [{ starts_at: null }, { starts_at: { $lte: now } }] },
          { $or: [{ ends_at: null }, { ends_at: { $gt: now } }] },
        ],
      };
    case undefined:
      return {};
  }
}

/** The sentence the HO screen shows, or `null` when the window is fine. */
export function windowError(
  startsAt: Date | null,
  endsAt: Date | null,
): string | null {
  if (startsAt && endsAt && endsAt <= startsAt) {
    return 'The end date must be after the start date.';
  }
  return null;
}

/** A DTO's optional date string; empty or missing is no bound. */
export function toDate(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null;
}

export function checkWindow(startsAt: Date | null, endsAt: Date | null): void {
  const error = windowError(startsAt, endsAt);
  if (error) throw badRequest('VALIDATION_FAILED', error, [error]);
}
