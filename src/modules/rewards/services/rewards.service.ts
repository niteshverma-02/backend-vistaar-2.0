import { Injectable, Logger } from '@nestjs/common';

import { conflict, notFound } from '@common/errors/api-error';
import { PageResult } from '@common/http/page-result';
import { istDayRange } from '@common/utils/ist-day.util';
import {
  AgentsService,
  type PartnerCard,
} from '@modules/agents/services/agents.service';
import {
  TRIGGER_CATALOG,
  type EarningTrigger,
  type Facts,
  type RewardKind,
} from '@modules/earning/earning.domain';
import { EarningRulesService } from '@modules/earning/services/earning-rules.service';
import { SettingsService } from '@modules/settings/services/settings.service';

import type {
  AdminRewardsQueryDto,
  AdminRewardsSummaryQueryDto,
  RewardsQueryDto,
} from '../dto/reward.dto';
import { CoinAccountRepository } from '../repositories/coin-account.repository';
import {
  RewardRepository,
  type NewReward,
  type RewardRecord,
  type RewardTotals,
} from '../repositories/reward.repository';
import {
  LEAD_REMOVED_REASON,
  REWARD_STATUSES,
  SYSTEM_REVIEWER,
  bulkOutcome,
  dueFollowUp,
  rewardIdOf,
  type RewardDecision,
  type RewardStatus,
} from '../rewards.domain';

/** A reward as the partner sees it. */
export interface RewardView {
  id: string;
  kind: RewardKind;
  trigger: EarningTrigger;
  trigger_label: string;
  rule_name: string;
  /** The farmer, on a trigger about one; else `null`. */
  pii_id: string | null;
  farmer_name: string | null;
  /** The order / meeting / gig / event / story / day / agent the reward is about; else `null`. */
  ref_id: string | null;
  /** `follow_up_done`: the IST day the follow-up was due. */
  due_day: string | null;
  /** Coins, or ₹ for a gig. */
  amount: number;
  status: RewardStatus;
  /** Why it was rejected. */
  reason: string | null;
  created_at: Date;
  reviewed_at: Date | null;
}

export interface AdminRewardView extends RewardView {
  agent_id: string;
  partner: PartnerCard | null;
  rule_id: string;
  cohort_id: string;
  reviewed_by: string | null;
}

/**
 * The app's Rewards card. Coins are points, never money: spent only as ₹1 off
 * per coin on an order (`PUT /rewards/coins/:requestId`).
 */
export interface RewardsSummary {
  coins: {
    approved: number;
    pending: number;
    /** Held by orders (checkout attempts not released). */
    spent: number;
    /** What an order can still take: approved − spent. */
    available: number;
    /** At most this % of `available` one order may use (the partner's earning cohort; 100 = all). */
    max_pct: number;
    /** At most this many coins on one order; `null` = no cap (the partner's earning cohort). */
    max_per_order: number | null;
  };
  gig: {
    approved_amount: number;
    pending_amount: number;
    /** Approved gig ₹ reaches the wallet only while this is on (settings `gig_pay_enabled`). */
    pay_enabled: boolean;
  };
}

/** Coins one checkout attempt holds. */
export interface CoinSpend {
  request_id: string;
  coins: number;
  /** Approved coins not spent, after this one. */
  available: number;
}

type Totals = Record<RewardStatus, { count: number; amount: number }>;

export interface AdminRewardsSummary {
  coin: Totals;
  gig: Totals;
  /** Waiting for HO, both kinds — the queue's badge. */
  pending: number;
}

export interface BulkResult {
  changed: string[];
  /** Not pending any more (`status`), or no such reward (`null`). */
  skipped: { id: string; status: RewardStatus | null }[];
}

/** The farmer as the event carries them. */
export interface RewardFarmer {
  pii_id: string;
  name: string | null;
}

/** What a reward is about — the row's subject and its once-only key. */
interface RewardSubject {
  /** The event's once-only key: the id parts between the trigger and the kind. */
  key: readonly string[];
  pii_id?: string | null;
  farmer_name?: string | null;
  /** The non-farmer thing (order, meeting, gig, event, story, IST day, agent). */
  ref_id?: string | null;
  /** `follow_up_done`: the IST day the follow-up was due. */
  due_day?: string | null;
}

/**
 * Coin and gig rewards: recorded (pending) when an event matches an earning
 * rule of the partner's cohort at that moment, then approved or rejected by
 * HO. Approved gig ₹ joins the wallet with meeting gigs while gig pay is on;
 * coins are points — earned and counted, and spent only as ₹1 off per coin on
 * an order, never paid out.
 */
@Injectable()
export class RewardsService {
  private readonly logger = new Logger(RewardsService.name);

  constructor(
    private readonly rewards: RewardRepository,
    private readonly rules: EarningRulesService,
    private readonly agents: AgentsService,
    private readonly settings: SettingsService,
    private readonly coinAccounts: CoinAccountRepository,
  ) {}

  // ── Events — never fail the partner's request ───────────────────────

  /** A farmer the partner added (OTP verified). Answers the reward ids recorded. */
  leadCreated(
    agentId: string,
    farmer: RewardFarmer & {
      crops: readonly string[];
      acreage: number;
      district: string | null;
      state: string | null;
    },
  ): Promise<string[]> {
    return this.record(
      agentId,
      'lead_created',
      { key: [farmer.pii_id], pii_id: farmer.pii_id, farmer_name: farmer.name },
      {
        crops: farmer.crops,
        acreage: farmer.acreage,
        farmer_district: farmer.district,
        farmer_state: farmer.state,
      },
    );
  }

  /**
   * A call / visit / WhatsApp logged on a lead. Pays only when its follow-up
   * (`nextFollowUp`, as it was before this activity) is due by the end of
   * today (IST); once per due day and reward kind.
   */
  followUpDone(
    agentId: string,
    farmer: RewardFarmer,
    nextFollowUp: Date | null,
    activityType: string,
    now = new Date(),
  ): Promise<string[]> {
    const due = dueFollowUp(nextFollowUp, activityType, now);
    if (!due) return Promise.resolve([]);
    return this.record(
      agentId,
      'follow_up_done',
      {
        key: [farmer.pii_id, due.due_day],
        pii_id: farmer.pii_id,
        farmer_name: farmer.name,
        due_day: due.due_day,
      },
      { activity_type: activityType, days_overdue: due.days_overdue },
    );
  }

  /**
   * The partner moved a lead forward (prospect → contacted → interested →
   * negotiation; `won` and `lost` never come here). Once per lead per stage
   * reached, whatever path it took.
   */
  leadStageAdvanced(
    agentId: string,
    farmer: RewardFarmer,
    fromStage: string,
    toStage: string,
  ): Promise<string[]> {
    return this.record(
      agentId,
      'lead_stage_advanced',
      {
        key: [farmer.pii_id, toStage],
        pii_id: farmer.pii_id,
        farmer_name: farmer.name,
      },
      { from_stage: fromStage, to_stage: toStage },
    );
  }

  /** A customer's repeat confirmed order (the order service's call). Once per order. */
  reorder(
    agentId: string,
    farmer: RewardFarmer,
    orderId: string,
    gapDays: number,
  ): Promise<string[]> {
    return this.record(
      agentId,
      'reorder',
      {
        key: [orderId],
        pii_id: farmer.pii_id,
        farmer_name: farmer.name,
        ref_id: orderId,
      },
      { gap_days: gapDays },
    );
  }

  /** A meeting attendee the partner captured as a lead. Once per attendee per meeting. */
  meetingAttendeeCaptured(
    agentId: string,
    farmer: RewardFarmer,
    meetingId: string,
    crops: readonly string[],
    acreage: number,
  ): Promise<string[]> {
    return this.record(
      agentId,
      'meeting_attendee_captured',
      {
        key: [meetingId, farmer.pii_id],
        pii_id: farmer.pii_id,
        farmer_name: farmer.name,
        ref_id: meetingId,
      },
      { crops, acreage },
    );
  }

  /** HO approved the partner's gig work — a bonus over the gig's own ₹. Once per gig. */
  gigApproved(
    agentId: string,
    gigId: string,
    counts: { attendees: number; photos: number },
  ): Promise<string[]> {
    return this.record(
      agentId,
      'gig_approved',
      { key: [gigId], ref_id: gigId },
      counts,
    );
  }

  /** The partner took a seat at an HO event. Once per event per partner, ever. */
  eventRegistered(agentId: string, eventId: string): Promise<string[]> {
    return this.record(
      agentId,
      'event_registered',
      { key: [eventId, agentId.toUpperCase()], ref_id: eventId },
      { event_id: eventId },
    );
  }

  /**
   * The partner punched out with an unbroken run of field days, `day` (IST
   * `YYYY-MM-DD`) included. Once per day — an `eq` rule pays the day a streak
   * is reached, a `gte` rule every day it holds.
   */
  attendanceStreak(
    agentId: string,
    day: string,
    streakDays: number,
  ): Promise<string[]> {
    return this.record(
      agentId,
      'attendance_streak',
      { key: [agentId.toUpperCase(), day], ref_id: day },
      { streak_days: streakDays },
    );
  }

  /** HO approved the partner's KYC — the welcome reward. Once per partner ever. */
  onboardingApproved(
    agentId: string,
    partnerType: string | null,
    state: string | null,
  ): Promise<string[]> {
    return this.record(
      agentId,
      'onboarding_approved',
      { key: [agentId.toUpperCase()], ref_id: agentId.toUpperCase() },
      { partner_type: partnerType, state },
    );
  }

  /**
   * The partner saved a brand-new My Story (an edit never fires it). Once per
   * story content: keyed on its signature, so one deleted and saved again
   * (a fresh `_id`) never pays twice; `ref_id` still names the row.
   */
  storyCreated(
    agentId: string,
    storyId: string,
    signature: string,
    template: string,
  ): Promise<string[]> {
    return this.record(
      agentId,
      'story_created',
      { key: [agentId, signature], ref_id: storyId },
      { template },
    );
  }

  /** The partner dropped the lead: its lead-added rewards still waiting are closed. */
  async leadRemoved(agentId: string, piiId: string): Promise<number> {
    try {
      return await this.rewards.decideMany(
        (['coin', 'gig'] as const).map((kind) =>
          rewardIdOf('lead_created', kind, piiId),
        ),
        'rejected',
        LEAD_REMOVED_REASON,
        SYSTEM_REVIEWER,
        new Date(),
        agentId.toUpperCase(),
      );
    } catch (error) {
      this.logger.error(
        `Pending rewards of removed lead ${piiId} (${agentId}) not closed: ${String(error)}`,
      );
      return 0;
    }
  }

  private async record(
    agentId: string,
    trigger: EarningTrigger,
    subject: RewardSubject,
    facts: Facts,
  ): Promise<string[]> {
    try {
      const earned = await this.rules.evaluate(agentId, trigger, facts);
      const rows: NewReward[] = earned
        .filter((e) => Number.isInteger(e.amount) && e.amount >= 1)
        .map((e) => ({
          _id: rewardIdOf(trigger, e.kind, ...subject.key),
          agent_id: agentId.toUpperCase(),
          rule_id: e.rule_id,
          rule_name: e.rule_name,
          kind: e.kind,
          trigger,
          pii_id: subject.pii_id ?? null,
          farmer_name: subject.farmer_name ?? null,
          ref_id: subject.ref_id ?? null,
          due_day: subject.due_day ?? null,
          amount: e.amount,
          cohort_id: e.cohort_id,
          status: 'pending',
          reason: null,
          reviewed_by: null,
          reviewed_at: null,
        }));
      return rows.length ? await this.rewards.insertNew(rows) : [];
    } catch (error) {
      this.logger.error(
        `Reward for ${trigger} ${subject.key.join(':')} (${agentId}) not recorded: ${String(error)}`,
      );
      return [];
    }
  }

  // ── The partner ──────────────────────────────────────────────────────

  async mine(
    agentId: string,
    query: RewardsQueryDto,
  ): Promise<PageResult<RewardView>> {
    const { items, total } = await this.rewards.page(
      {
        agent_id: agentId.toUpperCase(),
        kind: query.kind,
        status: query.status,
      },
      query.skip,
      query.limit,
    );
    return new PageResult(items.map(viewOf), total, query);
  }

  async summaryMine(agentId: string): Promise<RewardsSummary> {
    const agent = agentId.toUpperCase();
    const [totals, settings, account, limit] = await Promise.all([
      this.rewards.totals({ agent_id: agent }),
      this.settings.get(),
      this.coinAccounts.find(agent),
      this.rules.coinRedeemLimit(agent),
    ]);
    const t = byKind(totals);
    const spent = account?.spent ?? 0;
    return {
      coins: {
        approved: t.coin.approved.amount,
        pending: t.coin.pending.amount,
        spent,
        available: Math.max(0, t.coin.approved.amount - spent),
        max_pct: limit.pct,
        max_per_order: limit.max,
      },
      gig: {
        approved_amount: t.gig.approved.amount,
        pending_amount: t.gig.pending.amount,
        pay_enabled: settings.gig_pay_enabled,
      },
    };
  }

  // ── Coins at checkout ───────────────────────────────────────────────

  /**
   * Holds `coins` (₹1 off each) for the checkout attempt `requestId` — its
   * `x-request-id`, the same UUID as `POST /orders/id`. The same attempt
   * again answers what it holds (a retry never spends twice); one released
   * is held again. 409 `NOT_ENOUGH_COINS` past the approved coins not spent;
   * 409 `COINS_OVER_LIMIT` past the cohort's % (`coin_redeem_pct`) of those
   * coins, its cap per order (`coin_redeem_max`) or the order's `subtotal`.
   */
  async spendCoins(
    agentId: string,
    requestId: string,
    coins: number,
    subtotal: number,
  ): Promise<CoinSpend> {
    const agent = agentId.toUpperCase();
    const { pct, max } = await this.rules.coinRedeemLimit(agent);
    // A second try only when another spend changed the account in between.
    for (let tries = 0; tries < 3; tries++) {
      const [account, approved] = await Promise.all([
        this.coinAccounts.find(agent),
        this.approvedCoins(agent),
      ]);
      const left = approved - (account?.spent ?? 0);
      const row = account?.redemptions.find((r) => r.id === requestId);
      if (row?.active)
        return { request_id: requestId, coins: row.coins, available: left };
      if (coins > left) throw notEnoughCoins(left);
      const limit = Math.min(
        Math.floor((left * pct) / 100),
        max ?? Number.MAX_SAFE_INTEGER,
        subtotal,
      );
      if (coins > limit) throw coinsOverLimit(limit);
      const at = new Date();
      const held = row
        ? await this.coinAccounts.rehold(agent, requestId, coins, approved, at)
        : await this.coinAccounts.hold(agent, requestId, coins, approved, at);
      if (held)
        return { request_id: requestId, coins, available: left - coins };
    }
    throw conflict(
      'NOT_ENOUGH_COINS',
      'Your coins changed just now. Please try again.',
    );
  }

  /**
   * The order of checkout attempt `requestId` was not placed: its coins go
   * back. `released: false` = it held none (never spent, or released before).
   */
  async releaseCoins(
    agentId: string,
    requestId: string,
  ): Promise<{ request_id: string; released: boolean }> {
    const agent = agentId.toUpperCase();
    const row = (await this.coinAccounts.find(agent))?.redemptions.find(
      (r) => r.id === requestId && r.active,
    );
    const released = row
      ? await this.coinAccounts.release(agent, requestId, row.coins, new Date())
      : false;
    return { request_id: requestId, released };
  }

  private async approvedCoins(agent: string): Promise<number> {
    const [row] = await this.rewards.totals({
      agent_id: agent,
      kind: 'coin',
      status: 'approved',
    });
    return row?.amount ?? 0;
  }

  // ── The wallet ───────────────────────────────────────────────────────

  /**
   * Approved gig rewards, as the commission book takes meeting gigs' pay:
   * earned at approval. Whether they count (gig pay on) is the book's call.
   */
  async gigCreditsFor(
    agentId: string,
  ): Promise<{ id: string; amount: number; approved_at: Date }[]> {
    const rows = await this.rewards.approvedGigs(agentId.toUpperCase());
    return rows.map((r) => ({
      id: r._id,
      amount: r.amount,
      approved_at: r.reviewed_at ?? new Date(0),
    }));
  }

  // ── HO ───────────────────────────────────────────────────────────────

  async list(
    query: AdminRewardsQueryDto,
  ): Promise<PageResult<AdminRewardView>> {
    const range = istDayRange(query.from, query.to);
    const { items, total } = await this.rewards.page(
      {
        agent_id: query.agent_id,
        status: query.status,
        kind: query.kind,
        trigger: query.trigger,
        from: range.from,
        to: range.to,
      },
      query.skip,
      query.limit,
    );
    return new PageResult(await this.adminViews(items), total, query);
  }

  /** Coins the partner earned in `[from, to)`: HO-approved, and still waiting for HO — My Activity. */
  async coinsBetween(
    agentId: string,
    from: Date,
    to: Date,
  ): Promise<{ approved: number; pending: number }> {
    const { coin } = byKind(
      await this.rewards.totals({ agent_id: agentId, kind: 'coin', from, to }),
    );
    return { approved: coin.approved.amount, pending: coin.pending.amount };
  }

  async summary(
    query: AdminRewardsSummaryQueryDto,
  ): Promise<AdminRewardsSummary> {
    const range = istDayRange(query.from, query.to);
    const t = byKind(await this.rewards.totals(range));
    return {
      coin: t.coin,
      gig: t.gig,
      pending: t.coin.pending.count + t.gig.pending.count,
    };
  }

  async get(id: string): Promise<AdminRewardView> {
    const row = await this.rewards.find(id);
    if (!row) throw notFound('This reward could not be found.');
    const [view] = await this.adminViews([row]);
    return view;
  }

  approve(id: string, by: string): Promise<AdminRewardView> {
    return this.decide(id, 'approved', null, by);
  }

  reject(id: string, reason: string, by: string): Promise<AdminRewardView> {
    return this.decide(id, 'rejected', reason, by);
  }

  approveMany(ids: readonly string[], by: string): Promise<BulkResult> {
    return this.decideMany(ids, 'approved', null, by);
  }

  rejectMany(
    ids: readonly string[],
    reason: string,
    by: string,
  ): Promise<BulkResult> {
    return this.decideMany(ids, 'rejected', reason, by);
  }

  /** Only a pending reward moves, and only once — the status is in the update's filter. */
  private async decide(
    id: string,
    decision: RewardDecision,
    reason: string | null,
    by: string,
  ): Promise<AdminRewardView> {
    const done = await this.rewards.decide(
      id,
      decision,
      reason,
      by,
      new Date(),
    );
    if (done) {
      const [view] = await this.adminViews([done]);
      return view;
    }
    const row = await this.rewards.find(id);
    if (!row) throw notFound('This reward could not be found.');
    throw conflict(
      'REWARD_NOT_PENDING',
      `This reward is already ${row.status}.`,
      [`status=${row.status}`],
    );
  }

  private async decideMany(
    ids: readonly string[],
    decision: RewardDecision,
    reason: string | null,
    by: string,
  ): Promise<BulkResult> {
    const unique = [...new Set(ids)];
    // One instant for the whole batch: the rows carrying it are the ones this call moved.
    const at = new Date();
    await this.rewards.decideMany(unique, decision, reason, by, at);
    const after = await this.rewards.findMany(unique);
    return bulkOutcome(unique, after, decision, { by, at });
  }

  private async adminViews(
    rows: readonly RewardRecord[],
  ): Promise<AdminRewardView[]> {
    const partners = await this.agents.partnersByAgentIds([
      ...new Set(rows.map((r) => r.agent_id)),
    ]);
    return rows.map((r) => ({
      ...viewOf(r),
      agent_id: r.agent_id,
      partner: partners.get(r.agent_id) ?? null,
      rule_id: r.rule_id,
      cohort_id: r.cohort_id,
      reviewed_by: r.reviewed_by,
    }));
  }
}

function coinsOverLimit(limit: number) {
  return conflict(
    'COINS_OVER_LIMIT',
    `You can use up to ${limit} coins on this order. Use fewer coins.`,
    [`max_coins=${limit}`],
  );
}

function notEnoughCoins(left: number) {
  return conflict(
    'NOT_ENOUGH_COINS',
    `You have ${Math.max(0, left)} coins to use. Turn coins off or use fewer.`,
    [`available=${Math.max(0, left)}`],
  );
}

function viewOf(r: RewardRecord): RewardView {
  return {
    id: r._id,
    kind: r.kind,
    trigger: r.trigger,
    trigger_label: TRIGGER_CATALOG[r.trigger].label,
    rule_name: r.rule_name,
    pii_id: r.pii_id,
    farmer_name: r.farmer_name,
    ref_id: r.ref_id,
    due_day: r.due_day,
    amount: r.amount,
    status: r.status,
    reason: r.reason,
    created_at: r.created_at,
    reviewed_at: r.reviewed_at,
  };
}

/** Every kind and status present, zeros where there are none. */
function byKind(rows: readonly RewardTotals[]): Record<RewardKind, Totals> {
  const empty = (): Totals =>
    Object.fromEntries(
      REWARD_STATUSES.map((s) => [s, { count: 0, amount: 0 }]),
    ) as Totals;
  const out: Record<RewardKind, Totals> = { coin: empty(), gig: empty() };
  for (const r of rows)
    out[r.kind][r.status] = { count: r.count, amount: r.amount };
  return out;
}
