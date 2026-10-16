/**
 * Coin and gig rewards (user + TL, 2026-10-16): what a partner earned from
 * an earning rule, recorded when the event happens, paid only once HO
 * approves it. Pure — the service loads rows and calls these.
 */
import {
  DAY_MS,
  istDayStart,
  istDaysBetween,
} from '@common/utils/ist-day.util';
import {
  FOLLOW_UP_ACTIVITIES,
  type EarningTrigger,
  type RewardKind,
} from '@modules/earning/earning.domain';

export const REWARD_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type RewardStatus = (typeof REWARD_STATUSES)[number];

/** What HO decides; a pending reward only. */
export type RewardDecision = Exclude<RewardStatus, 'pending'>;

/** `reviewed_by` when the system, not HO, closed a reward. */
export const SYSTEM_REVIEWER = 'system';
export const LEAD_REMOVED_REASON = 'lead removed';

/** HO approves or rejects at most this many in one go. */
export const BULK_MAX = 200;

const IST_OFFSET_MS = 5.5 * 3600 * 1000;

/** `YYYY-MM-DD` of the IST day `at` falls in. */
export const istDayKey = (at: Date): string =>
  new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

/**
 * The row's `_id` — one per event and reward kind, so the same event can
 * never pay twice (a retry, a double tap, another process): a farmer's lead
 * pays once ever, a follow-up once per due day.
 */
export function rewardIdOf(
  trigger: EarningTrigger,
  piiId: string,
  kind: RewardKind,
  dueDay: string | null = null,
): string {
  return trigger === 'follow_up_done'
    ? `${trigger}:${piiId}:${dueDay ?? ''}:${kind}`
    : `${trigger}:${piiId}:${kind}`;
}

/**
 * A follow-up that logging a call / visit / WhatsApp now completes: one due
 * by the end of today (IST), overdue included. `null` = nothing due, or an
 * activity that does not count (a note).
 */
export function dueFollowUp(
  nextFollowUp: Date | null,
  activityType: string,
  now: Date,
): { due_day: string; days_overdue: number } | null {
  if (!nextFollowUp) return null;
  if (!(FOLLOW_UP_ACTIVITIES as readonly string[]).includes(activityType))
    return null;
  const today = istDayStart(now).getTime();
  if (nextFollowUp.getTime() >= today + DAY_MS) return null;
  return {
    due_day: istDayKey(nextFollowUp),
    days_overdue: Math.max(0, istDaysBetween(nextFollowUp, now)),
  };
}

/** Bulk review: which ids changed, and why each other one did not. */
export function bulkOutcome(
  ids: readonly string[],
  after: readonly {
    _id: string;
    status: RewardStatus;
    reviewed_by: string | null;
    reviewed_at: Date | null;
  }[],
  decision: RewardDecision,
  stamp: { by: string; at: Date },
): {
  changed: string[];
  skipped: { id: string; status: RewardStatus | null }[];
} {
  const byId = new Map(after.map((r) => [r._id, r]));
  const changed: string[] = [];
  const skipped: { id: string; status: RewardStatus | null }[] = [];
  for (const id of new Set(ids)) {
    const row = byId.get(id);
    const ours =
      row?.status === decision &&
      row.reviewed_by === stamp.by &&
      row.reviewed_at?.getTime() === stamp.at.getTime();
    if (ours) changed.push(id);
    else skipped.push({ id, status: row?.status ?? null });
  }
  return { changed, skipped };
}
