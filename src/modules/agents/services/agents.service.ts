import { HttpStatus, Injectable } from '@nestjs/common';

import { apiError, notFound } from '@common/errors/api-error';
import type { GeoPoint } from '@common/utils/geo.util';
import { CountersService } from '@modules/counters/services/counters.service';
import { SettingsService } from '@modules/settings/services/settings.service';

import {
  STAGES,
  TRANSITIONS,
  type Stage,
  type StageAction,
} from '../agents.domain';
import {
  AgentRepository,
  type AgentListFilter,
  type AgentRecord,
} from '../repositories/agent.repository';
import type { AgentPreview, AgentProfile } from '../schemas/agent.schema';

export type {
  AgentRecord,
  AgentListFilter,
} from '../repositories/agent.repository';

/** A partner as a list row names them. */
export interface PartnerCard {
  agent_id: string;
  name: string | null;
}

/** How many cohorts / states the HO summary ranks. */
const SUMMARY_TOP = 10;
@Injectable()
export class AgentsService {
  constructor(
    private readonly agents: AgentRepository,
    private readonly counters: CountersService,
    private readonly settings: SettingsService,
  ) {}

  registerOtpRequest(phone: string, countryCode: string): Promise<AgentRecord> {
    return this.agents.upsertForOtp(phone, countryCode);
  }

  findByPhone(phone: string, countryCode: string): Promise<AgentRecord | null> {
    return this.agents.findByPhone(phone, countryCode);
  }

  /**
   * First successful verify: the `VST-` id, the person (`pii_id`) and the
   * default owner. A second verify (another device, a retry) finds the ids
   * already set and only stamps the login.
   */
  async completeVerification(
    agent: AgentRecord,
    piiId: string,
  ): Promise<AgentRecord> {
    const now = new Date();
    if (agent.otp_verified) {
      await this.agents.touchLogin(agent._id);
      return { ...agent, last_login_at: now };
    }

    const [agentId, settings] = await Promise.all([
      this.counters.nextAgentId(),
      this.settings.get(),
    ]);
    const done = await this.agents.completeVerification(agent._id, {
      agent_id: agentId,
      pii_id: piiId,
      owner_agent_id: settings.default_owner_agent_id,
      at: now,
    });
    if (done) return done;

    // A parallel verify won the race; its ids stand (this VST number is skipped).
    return this.require(agent._id);
  }

  touchLogin(id: string): Promise<void> {
    return this.agents.touchLogin(id);
  }

  async require(id: string): Promise<AgentRecord> {
    const agent = await this.agents.findById(id);
    if (!agent) throw notFound('Partner not found.');
    return agent;
  }

  async requireByAgentId(agentId: string): Promise<AgentRecord> {
    const agent = await this.agents.findByAgentId(agentId.toUpperCase());
    if (!agent || !agent.otp_verified) throw notFound(`No partner ${agentId}.`);
    return agent;
  }

  /** `VST-` id → the partner's id and name, for the farmer-lead lists. */
  async partnersByAgentIds(
    agentIds: readonly string[],
  ): Promise<Map<string, PartnerCard>> {
    if (agentIds.length === 0) return new Map();
    const rows = await this.agents.findByAgentIds(agentIds);
    const cards = new Map<string, PartnerCard>();
    for (const row of rows) {
      if (!row.agent_id) continue;
      cards.set(row.agent_id, {
        agent_id: row.agent_id,
        name: row.profile?.name ?? row.preview?.name ?? null,
      });
    }
    return cards;
  }

  /**
   * Applies one pipeline action, conditional on the stage it may start from.
   * 409 `STAGE_NOT_ALLOWED` when the partner is not in such a stage (the
   * screen is stale, or another desk user decided first).
   */
  async move(
    agent: AgentRecord,
    action: StageAction,
    by: string,
    options: { reason?: string; set?: Record<string, unknown> } = {},
  ): Promise<AgentRecord> {
    const rule = TRANSITIONS[action];
    if (!rule.from.includes(agent.stage)) {
      throw this.stageError(action, agent.stage);
    }
    const set: Record<string, unknown> = { ...(options.set ?? {}) };
    if (action === 'block') set.blocked_from = agent.stage;

    const moved = await this.agents.transition(
      agent._id,
      rule.from,
      {
        from: agent.stage,
        to: rule.to,
        by,
        at: new Date(),
        ...(options.reason ? { reason: options.reason } : {}),
      },
      set,
    );
    if (!moved) {
      const fresh = await this.require(agent._id);
      throw this.stageError(action, fresh.stage);
    }
    return moved;
  }

  /** Back to where the block found it. */
  async unblock(
    agent: AgentRecord,
    by: string,
    reason?: string,
  ): Promise<AgentRecord> {
    if (agent.stage !== 'blocked' || !agent.blocked_from) {
      throw this.stageError('unblock', agent.stage);
    }
    const moved = await this.agents.transition(
      agent._id,
      ['blocked'],
      {
        from: 'blocked',
        to: agent.blocked_from,
        by,
        at: new Date(),
        ...(reason ? { reason } : {}),
      },
      { blocked_from: null },
    );
    if (!moved)
      throw this.stageError('unblock', (await this.require(agent._id)).stage);
    return moved;
  }

  approve(
    agent: AgentRecord,
    by: string,
    profile: AgentProfile,
    location: GeoPoint | null,
  ): Promise<AgentRecord> {
    const now = new Date();
    return this.move(agent, 'approve', by, {
      set: {
        is_approved: true,
        decided_by: by,
        decided_at: now,
        rejection_reason: null,
        profile,
        ...(location ? { location } : {}),
      },
    });
  }

  reject(agent: AgentRecord, by: string, reason: string): Promise<AgentRecord> {
    return this.move(agent, 'reject', by, {
      reason,
      set: {
        is_approved: false,
        decided_by: by,
        decided_at: new Date(),
        rejection_reason: reason,
      },
    });
  }

  linkOnboarding(id: string, onboardingId: string): Promise<void> {
    return this.agents.linkOnboarding(id, onboardingId);
  }

  setPreview(id: string, cohort: string, preview: AgentPreview): Promise<void> {
    return this.agents.setPreview(id, cohort, preview);
  }

  async setOwner(
    agent: AgentRecord,
    ownerAgentId: string,
    by: string,
  ): Promise<AgentRecord> {
    const updated = await this.agents.setOwner(agent._id, ownerAgentId, by);
    if (!updated) throw notFound('Partner not found.');
    return updated;
  }

  list(
    filter: AgentListFilter,
    page: { skip: number; limit: number; sort: Record<string, 1 | -1> },
  ): Promise<{ items: AgentRecord[]; total: number }> {
    return this.agents.list(filter, page);
  }

  async stageCounts(): Promise<{
    stages: Record<Stage, number>;
    unverified: number;
    total: number;
    by_cohort: { key: string; count: number }[];
    by_state: { key: string; count: number }[];
  }> {
    const {
      stages: rows,
      by_cohort,
      by_state,
    } = await this.agents.summaryCounts(SUMMARY_TOP);
    const stages = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<
      Stage,
      number
    >;
    let unverified = 0;
    for (const row of rows) {
      if (!row.verified) unverified += row.count;
      else stages[row.stage] = (stages[row.stage] ?? 0) + row.count;
    }
    const total = Object.values(stages).reduce((a, b) => a + b, 0);
    return { stages, unverified, total, by_cohort, by_state };
  }

  near(
    point: GeoPoint,
    radiusKm: number,
    excludeId: string,
    limit: number,
  ): Promise<AgentRecord[]> {
    return this.agents.near(point, radiusKm, excludeId, limit);
  }

  private stageError(action: string, stage: Stage) {
    return apiError(
      HttpStatus.CONFLICT,
      'STAGE_NOT_ALLOWED',
      `Cannot ${action.replace('_', ' ')} a partner who is ${stage.replace('_', ' ')}.`,
    );
  }
}
