import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, Matches } from 'class-validator';

import type { Stage } from '@modules/agents/agents.domain';
import { DATE_PATTERN } from '@modules/attendance/attendance.domain';
import type { GigStatus } from '@modules/gigs/gigs.domain';
import type { LeadStage } from '@modules/leads/leads.domain';

/** `GET /admin/overview`: Home's period, IST days. */
export class OverviewQueryDto {
  @ApiPropertyOptional({
    example: '2026-10-01',
    description: "First IST day, included. Default: the 1st of `to`'s month",
  })
  @IsOptional()
  @Matches(DATE_PATTERN, {
    message: 'Please choose a valid start date, for example 2026-10-01.',
  })
  from?: string;

  @ApiPropertyOptional({
    example: '2026-10-23',
    description: 'Last IST day, included. Default: today (IST)',
  })
  @IsOptional()
  @Matches(DATE_PATTERN, {
    message: 'Please choose a valid end date, for example 2026-10-23.',
  })
  to?: string;
}

/** `orders.read` — `/admin/orders/summary` for the period, and for `prev`. */
export interface OverviewOrders {
  orders: number;
  /** Σ what buyers pay, cancelled and returned left out. */
  value: number;
  partners: number;
  customers: number;
  prev: { orders: number; value: number };
}

/** `agents.read` — `/admin/agents/summary`: stages now, and the period's sign-ups and approvals. */
export interface OverviewPartners {
  /** Verified partners, every stage. */
  total: number;
  /** `stages.approved`: approved partners now. */
  approved: number;
  /** Verified partners signed up (`created_at`) in the period. */
  signups_in_range: number;
  /** Approved (`decided_at`) in the period, a partner blocked since included. */
  approved_in_range: number;
  stages: Record<Stage, number>;
}

/**
 * `leads.read` — `/admin/leads/summary` twice: all time, and with the
 * period as `from` / `to` for what it added and won.
 */
export interface OverviewLeads {
  /** Every farmer partners hold, all time. */
  total: number;
  today: number;
  last_7_days: number;
  /** Leads added in the period: the period's summary `total`. */
  added_in_range: number;
  /** Of those, at stage won now: the period's summary `by_stage` won (My Performance's rule). */
  won_in_range: number;
  due_today: number;
  overdue: number;
  /** Every lead's stage now, all time. */
  by_stage: { key: LeadStage; count: number }[];
}

/** `attendance.read` — `/admin/attendance`'s summary for today (IST), whatever the period. */
export interface OverviewAttendance {
  partners: number;
  on_duty: number;
  day_closed: number;
  not_started: number;
}

/** `commission.read` — `/admin/withdrawals/totals`, now. */
export interface OverviewPayouts {
  /** Withdrawals waiting for approval, and the ₹ asked. */
  requested_count: number;
  requested_amount: number;
  /** Approved and not paid yet: ₹ to send, after TDS. */
  approved_net: number;
}

/** `rewards.read` — `/admin/rewards/summary`. */
export interface OverviewRewards {
  /** Coins approved, of the rewards earned in the period. */
  coin_approved: number;
  /** Gig ₹ approved, of the rewards earned in the period. */
  gig_approved: number;
  /** Coins waiting for HO now, earned on any day. */
  coin_pending: number;
  /** Gig ₹ waiting for HO now, earned on any day. */
  gig_pending: number;
  /** Rewards waiting for HO now, both kinds — the queue's badge. */
  pending: number;
}

/** `gigs.read` — `/admin/gigs/summary` for gigs starting in the period. */
export interface OverviewGigs {
  by_status: Record<GigStatus, number>;
  partners: number;
  /** Σ payout of the approved ones, ₹. */
  approved_payout: number;
  farmers: number;
}

/** `feedback.read` — `/admin/feedback/summary` for the period's answers. */
export interface OverviewNps {
  /** −100…100; `null` with no answer in the period. */
  nps: number | null;
  /** Detractor call-backs open now, any day's. */
  open_follow_ups: number;
  overdue: number;
}

/**
 * HO Home's Vistaar numbers in one read. Each block needs the capability of
 * the route it comes from; a block the caller's role may not read — or whose
 * read failed (logged) — is `null`, and the others still answer.
 */
export interface AdminOverview {
  /** The period, IST days, both included. */
  from: string;
  to: string;
  /** The same number of days just before `from`. */
  prev: { from: string; to: string };
  orders: OverviewOrders | null;
  partners: OverviewPartners | null;
  leads: OverviewLeads | null;
  attendance_today: OverviewAttendance | null;
  payouts: OverviewPayouts | null;
  rewards: OverviewRewards | null;
  gigs: OverviewGigs | null;
  nps: OverviewNps | null;
}
