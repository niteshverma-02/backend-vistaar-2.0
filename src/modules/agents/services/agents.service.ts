import { HttpStatus, Injectable } from '@nestjs/common';

import {
  apiError,
  conflict,
  forbidden,
  notFound,
} from '@common/errors/api-error';
import type { GeoPoint } from '@common/utils/geo.util';
import { CountersService } from '@modules/counters/services/counters.service';
import { SettingsService } from '@modules/settings/services/settings.service';

import {
  CALLABLE_STAGES,
  STAGES,
  TRANSITIONS,
  stageRefusal,
  type CallOutcome,
  type RefusedAction,
  type Stage,
  type StageAction,
} from '../agents.domain';
import {
  AgentRepository,
  type AgentListFilter,
  type AgentRecord,
  type EarningPartnerRecord,
} from '../repositories/agent.repository';
import type {
  AgentPreview,
  AgentProfile,
  EarningCohortRef,
  NameChangeResult,
  VerificationCall,
} from '../schemas/agent.schema';

export type {
  AgentRecord,
  AgentListFilter,
  EarningPartnerRecord,
} from '../repositories/agent.repository';
export type {
  EarningCohortRef,
  NameChangeResult,
  PendingName,
  VerificationCall,
} from '../schemas/agent.schema';

/** What the partner may change on their own profile (the app's Edit Profile). */
export interface ProfileEdit {
  email?: string;
  language_pref?: string;
  village?: string;
  district?: string;
  state?: string;
  pincode?: string;
  photo?: string;
}

/** Fields mirrored to `preview`, which the HO list filters and searches on. */
const PREVIEW_KEYS = ['district', 'state', 'pincode'] as const;

/** A partner as a list row names them. */
export interface PartnerCard {
  agent_id: string;
  name: string | null;
}

const COHORT_TTL_MS = 60_000;
/** ~100 bytes an entry: ~10 MB at the cap. */
const COHORT_CACHE_MAX = 100_000;

/** How many cohorts / states the HO summary ranks. */
const SUMMARY_TOP = 10;
@Injectable()
export class AgentsService {
  /**
   * Cohort by agent `_id` or `VST-` id. Banners, events and My Story need only
   * the cohort on every open; it changes about once in a partner's life (at
   * signup), so a minute of staleness on another instance is fine.
   */
  private readonly cohortCache = new Map<
    string,
    { cohort: string | null; at: number }
  >();

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
    if (!agent) throw notFound('This partner could not be found.');
    return agent;
  }

  /** The partner's cohort (cached ≤ 60 s); 404 when there is no such partner. */
  async cohortById(id: string): Promise<string | null> {
    return this.cachedCohort(`id:${id}`, () => this.require(id));
  }

  /** The partner's cohort by `VST-` id (cached ≤ 60 s); 404 for an unverified partner. */
  async cohortByAgentId(agentId: string): Promise<string | null> {
    return this.cachedCohort(`vst:${agentId.toUpperCase()}`, () =>
      this.requireByAgentId(agentId),
    );
  }

  private async cachedCohort(
    key: string,
    load: () => Promise<AgentRecord>,
  ): Promise<string | null> {
    const hit = this.cohortCache.get(key);
    if (hit && Date.now() - hit.at < COHORT_TTL_MS) return hit.cohort;
    const cohort = (await load()).cohort ?? null;
    this.cohortCache.delete(key);
    this.cohortCache.set(key, { cohort, at: Date.now() });
    if (this.cohortCache.size > COHORT_CACHE_MAX) {
      const oldest = this.cohortCache.keys().next().value;
      if (oldest !== undefined) this.cohortCache.delete(oldest);
    }
    return cohort;
  }

  async requireByAgentId(agentId: string): Promise<AgentRecord> {
    const agent = await this.agents.findByAgentId(agentId.toUpperCase());
    if (!agent || !agent.otp_verified)
      throw notFound('This partner could not be found.');
    return agent;
  }

  /**
   * Approved and active, else refused: the app hides selling to others, but
   * the server must refuse it too. `doing` finishes "You can … once your
   * account is approved."
   */
  async requireWorkingPartner(
    agentId: string,
    doing: string,
  ): Promise<AgentRecord> {
    const agent = await this.requireByAgentId(agentId);
    if (agent.stage === 'blocked' || !agent.is_active) {
      throw forbidden(
        'ACCOUNT_BLOCKED',
        'This account is blocked. Contact Katyayani support.',
      );
    }
    if (agent.stage !== 'approved') {
      throw forbidden(
        'PARTNER_NOT_APPROVED',
        `You can ${doing} once your account is approved.`,
      );
    }
    return agent;
  }

  /** Blocked, switched off or gone: the partner's farmers are free for others. */
  async isOutOfWork(agentId: string): Promise<boolean> {
    const agent = await this.agents.findByAgentId(agentId.toUpperCase());
    return !agent || agent.stage === 'blocked' || !agent.is_active;
  }

  /** Every approved partner with only the fields HO's board needs (newest approval first). */
  approvedBrief(): Promise<AgentRecord[]> {
    return this.agents.approvedBrief();
  }

  // ── Earning cohorts (written only by the earning module) ─────────────

  /** A verified partner's place and current earning cohort; `null` = no such partner. */
  earningPartner(agentId: string): Promise<EarningPartnerRecord | null> {
    return this.agents.earningPartner(agentId.toUpperCase());
  }

  /** Every approved partner's place and current earning cohort. */
  earningPartners(): Promise<EarningPartnerRecord[]> {
    return this.agents.earningPartners();
  }

  setEarningCohorts(
    rows: readonly { agent_id: string; cohort: EarningCohortRef }[],
  ): Promise<void> {
    return this.agents.setEarningCohorts(rows);
  }

  /** Earning cohort id → approved partners in it now. */
  async earningCohortCounts(): Promise<Map<string, number>> {
    const rows = await this.agents.countByEarningCohort();
    return new Map(rows.map((r) => [r.id, r.count]));
  }

  /** Every verified partner's `VST-` id (ids only — ~15 bytes a partner). */
  verifiedAgentIds(): Promise<string[]> {
    return this.agents.verifiedAgentIds();
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
    // The `VST-` key for this partner expires within the minute on its own.
    this.cohortCache.delete(`id:${id}`);
    return this.agents.setPreview(id, cohort, preview);
  }

  setPlace(
    agent: AgentRecord,
    place: { state?: string; district?: string },
  ): Promise<void> {
    return this.agents.setPlace(agent._id, place, agent.profile != null);
  }

  async setOwner(
    agent: AgentRecord,
    ownerAgentId: string,
    by: string,
  ): Promise<AgentRecord> {
    const updated = await this.agents.setOwner(agent._id, ownerAgentId, by);
    if (!updated) throw notFound('This partner could not be found.');
    return updated;
  }

  /** HO logs a verification call; refused once the partner is decided. */
  async logVerificationCall(
    agentId: string,
    outcome: CallOutcome,
    note: string | undefined,
    by: string,
  ): Promise<{ agent_id: string; verification_calls: VerificationCall[] }> {
    const agent = await this.requireByAgentId(agentId);
    if (!CALLABLE_STAGES.includes(agent.stage)) {
      throw this.stageError('verification_call', agent.stage);
    }
    const updated = await this.agents.addVerificationCall(
      agent._id,
      CALLABLE_STAGES,
      { at: new Date(), by, outcome, note: note?.trim() || null },
    );
    if (!updated) {
      const fresh = await this.require(agent._id);
      throw this.stageError('verification_call', fresh.stage);
    }
    return {
      agent_id: updated.agent_id ?? agentId,
      verification_calls: updated.verification_calls ?? [],
    };
  }

  /**
   * Writes only the keys sent, as dotted `$set`s, so nothing else on the
   * profile moves; a new name only waits in `pending_name` for HO. 403
   * `PARTNER_NOT_APPROVED` when the partner stopped being approved meanwhile.
   */
  /** The profile's copy of the bank account, after HO approved a change; no profile = nothing to keep. */
  async setProfileBankAccount(
    agent: AgentRecord,
    account: { account_holder: string; account_number: string; ifsc: string },
  ): Promise<void> {
    if (!agent.profile?.details) return;
    await this.agents.editProfile(agent._id, {
      'profile.details.bank_account': account,
    });
  }

  async editProfile(
    agent: AgentRecord,
    edit: ProfileEdit,
    pendingName: string | null,
  ): Promise<AgentRecord> {
    const set: Record<string, unknown> = {};
    const { language_pref, ...rest } = edit;
    const flat = Object.fromEntries(
      Object.entries(rest).filter(([, v]) => v !== undefined),
    );
    const profile = agent.profile;
    if (!profile) {
      // Dotted paths cannot be written under a `null` profile.
      if (Object.keys(flat).length > 0 || language_pref !== undefined)
        set.profile = {
          ...flat,
          ...(language_pref !== undefined
            ? { details: { language_pref } }
            : {}),
        };
    } else {
      for (const [key, value] of Object.entries(flat))
        set[`profile.${key}`] = value;
      if (language_pref !== undefined) {
        if (profile.details)
          set['profile.details.language_pref'] = language_pref;
        else set['profile.details'] = { language_pref };
      }
    }
    for (const key of PREVIEW_KEYS)
      if (edit[key] !== undefined) set[`preview.${key}`] = edit[key];
    if (pendingName)
      set.pending_name = { value: pendingName, requested_at: new Date() };
    if (Object.keys(set).length === 0) return agent;

    const updated = await this.agents.editProfile(agent._id, set);
    if (!updated) {
      throw forbidden(
        'PARTNER_NOT_APPROVED',
        'You can edit your profile once your account is approved.',
      );
    }
    return updated;
  }

  /** HO approves or refuses the name the partner asked for. 409 when none waits. */
  async decideNameChange(
    agentId: string,
    approved: boolean,
    by: string,
    reason?: string,
  ): Promise<AgentRecord> {
    const agent = await this.requireByAgentId(agentId);
    const value = agent.pending_name?.value;
    if (!value) throw this.noPendingName();
    const result: NameChangeResult = {
      value,
      approved,
      reason: approved ? null : (reason?.trim() ?? null),
      by,
      at: new Date(),
    };
    const updated = await this.agents.decideNameChange(agent._id, value, {
      pending_name: null,
      name_change: result,
      updated_by: by,
      ...(approved ? { 'profile.name': value, 'preview.name': value } : {}),
    });
    if (!updated) throw this.noPendingName();
    return updated;
  }

  private noPendingName() {
    return conflict(
      'NAME_CHANGE_NOT_PENDING',
      'This partner has no name change waiting. Please refresh the page.',
    );
  }

  /** A partner's own monthly target; `null` puts them back on the settings default. */
  async setMonthlyTarget(
    agentId: string,
    target: number | null,
    by: string,
  ): Promise<AgentRecord> {
    const updated = await this.agents.setMonthlyTarget(
      agentId.toUpperCase(),
      target,
      by,
    );
    if (!updated) throw notFound('This partner could not be found.');
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

  /** Partners signed up and partners approved in `[from, to)` — the HO summary's window. */
  rangeCounts(
    from: Date,
    to?: Date,
  ): Promise<{ signed_up: number; approved: number }> {
    return this.agents.rangeCounts(from, to);
  }

  near(
    point: GeoPoint,
    radiusKm: number,
    excludeId: string,
    limit: number,
  ): Promise<AgentRecord[]> {
    return this.agents.near(point, radiusKm, excludeId, limit);
  }

  private stageError(action: RefusedAction, stage: Stage) {
    return apiError(
      HttpStatus.CONFLICT,
      'STAGE_NOT_ALLOWED',
      stageRefusal(action, stage),
    );
  }
}
