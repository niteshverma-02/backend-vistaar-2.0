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
  pii_id: string;
  farmer_name: string | null;
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

/** The app's Rewards card. Coins are points only — never money. */
export interface RewardsSummary {
  coins: { approved: number; pending: number };
  gig: {
    approved_amount: number;
    pending_amount: number;
    /** Approved gig ₹ reaches the wallet only while this is on (settings `gig_pay_enabled`). */
    pay_enabled: boolean;
  };
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

/**
 * Coin and gig rewards: recorded (pending) when an event matches an earning
 * rule of the partner's cohort at that moment, then approved or rejected by
 * HO. Approved gig ₹ joins the wallet with meeting gigs while gig pay is on;
 * coins are points — earned and counted, never spent or paid.
 */
@Injectable()
export class RewardsService {
  private readonly logger = new Logger(RewardsService.name);

  constructor(
    private readonly rewards: RewardRepository,
    private readonly rules: EarningRulesService,
    private readonly agents: AgentsService,
    private readonly settings: SettingsService,
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
    return this.record(agentId, 'lead_created', farmer, null, {
      crops: farmer.crops,
      acreage: farmer.acreage,
      farmer_district: farmer.district,
      farmer_state: farmer.state,
    });
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
    return this.record(agentId, 'follow_up_done', farmer, due.due_day, {
      activity_type: activityType,
      days_overdue: due.days_overdue,
    });
  }

  /** The partner dropped the lead: its lead-added rewards still waiting are closed. */
  async leadRemoved(agentId: string, piiId: string): Promise<number> {
    try {
      return await this.rewards.decideMany(
        (['coin', 'gig'] as const).map((kind) =>
          rewardIdOf('lead_created', piiId, kind),
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
    farmer: RewardFarmer,
    dueDay: string | null,
    facts: Facts,
  ): Promise<string[]> {
    try {
      const earned = await this.rules.evaluate(agentId, trigger, facts);
      const rows: NewReward[] = earned
        .filter((e) => Number.isInteger(e.amount) && e.amount >= 1)
        .map((e) => ({
          _id: rewardIdOf(trigger, farmer.pii_id, e.kind, dueDay),
          agent_id: agentId.toUpperCase(),
          rule_id: e.rule_id,
          rule_name: e.rule_name,
          kind: e.kind,
          trigger,
          pii_id: farmer.pii_id,
          farmer_name: farmer.name,
          due_day: dueDay,
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
        `Reward for ${trigger} ${farmer.pii_id} (${agentId}) not recorded: ${String(error)}`,
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
    const [totals, settings] = await Promise.all([
      this.rewards.totals({ agent_id: agentId.toUpperCase() }),
      this.settings.get(),
    ]);
    const t = byKind(totals);
    return {
      coins: {
        approved: t.coin.approved.amount,
        pending: t.coin.pending.amount,
      },
      gig: {
        approved_amount: t.gig.approved.amount,
        pending_amount: t.gig.pending.amount,
        pay_enabled: settings.gig_pay_enabled,
      },
    };
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

function viewOf(r: RewardRecord): RewardView {
  return {
    id: r._id,
    kind: r.kind,
    trigger: r.trigger,
    trigger_label: TRIGGER_CATALOG[r.trigger].label,
    rule_name: r.rule_name,
    pii_id: r.pii_id,
    farmer_name: r.farmer_name,
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
