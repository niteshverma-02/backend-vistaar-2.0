import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  Model,
  mongo,
  type QueryFilter,
  type UpdateQuery,
  type PipelineStage,
} from 'mongoose';

import { kmToRadians, type GeoPoint } from '@common/utils/geo.util';

import type { Stage } from '../agents.domain';
import {
  Agent,
  type AgentDocument,
  type AgentPreview,
  type AgentProfile,
  type EarningCohortRef,
  type StageHistoryEntry,
  type VerificationCall,
} from '../schemas/agent.schema';

export type AgentRecord = Agent;

/** What the earning module matches a cohort on, and the cohort it holds now. */
export type EarningPartnerRecord = Pick<
  Agent,
  '_id' | 'agent_id' | 'stage' | 'is_active' | 'earning_cohort'
> & {
  profile?: Pick<AgentProfile, 'state' | 'district' | 'pincode'> | null;
  preview?: Pick<AgentPreview, 'state' | 'district' | 'pincode'>;
};

const EARNING_FIELDS =
  '_id agent_id stage is_active earning_cohort profile.state profile.district profile.pincode preview.state preview.district preview.pincode';

export interface AgentListFilter {
  stage?: Stage;
  cohort?: string;
  state?: string;
  district?: string;
  owner_agent_id?: string;
  /** Exactly these `VST-` ids — naming the rows of another module's report. */
  agent_ids?: string[];
  /** Name (preview), phone prefix, `VST-` id or `PII-` id. */
  q?: string;
  from?: Date;
  to?: Date;
  /** Unverified numbers are noise for the desk; shown only when asked. */
  include_unverified?: boolean;
}

const isDuplicateKey = (error: unknown): boolean =>
  error instanceof mongo.MongoServerError && error.code === 11000;

const escapeRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

@Injectable()
export class AgentRepository {
  constructor(
    @InjectModel(Agent.name) private readonly model: Model<AgentDocument>,
  ) {}

  /** Partners by `VST-` id — the names beside farmer leads. */
  findByAgentIds(
    agentIds: readonly string[],
  ): Promise<Pick<AgentRecord, 'agent_id' | 'profile' | 'preview'>[]> {
    return this.model
      .find({ agent_id: { $in: agentIds } })
      .select('agent_id profile preview')
      .lean<Pick<AgentRecord, 'agent_id' | 'profile' | 'preview'>[]>()
      .exec();
  }

  /** Every verified partner's `VST-` id, and nothing else of them. */
  async verifiedAgentIds(): Promise<string[]> {
    const rows = await this.model
      .find({ otp_verified: true, agent_id: { $type: 'string' } })
      .select('-_id agent_id')
      .lean<{ agent_id: string }[]>()
      .exec();
    return rows.map((r) => r.agent_id);
  }

  /** Every approved partner, only what HO's board rows need — no history, no form. */
  approvedBrief(): Promise<AgentRecord[]> {
    return this.model
      .find({
        otp_verified: true,
        stage: 'approved',
        agent_id: { $type: 'string' },
      })
      .select(
        '_id agent_id pii_id cohort stage is_active monthly_target decided_at profile.name profile.district profile.state preview.name preview.district preview.state',
      )
      .sort({ decided_at: -1 })
      .lean<AgentRecord[]>()
      .exec();
  }

  /** One verified partner's earning facts by `VST-` id. */
  earningPartner(agentId: string): Promise<EarningPartnerRecord | null> {
    return this.model
      .findOne({ agent_id: agentId, otp_verified: true })
      .select(EARNING_FIELDS)
      .lean<EarningPartnerRecord | null>()
      .exec();
  }

  /** Every approved partner's earning facts — ~150 bytes a partner. */
  earningPartners(): Promise<EarningPartnerRecord[]> {
    return this.model
      .find({
        otp_verified: true,
        stage: 'approved',
        agent_id: { $type: 'string' },
      })
      .select(EARNING_FIELDS)
      .lean<EarningPartnerRecord[]>()
      .exec();
  }

  /** The current cohort copied onto each partner; `updated_at` is not touched (not the partner's edit). */
  async setEarningCohorts(
    rows: readonly { agent_id: string; cohort: EarningCohortRef }[],
  ): Promise<void> {
    if (rows.length === 0) return;
    await this.model.bulkWrite(
      rows.map((r) => ({
        updateOne: {
          filter: { agent_id: r.agent_id },
          update: { $set: { earning_cohort: r.cohort } },
          timestamps: false,
        },
      })),
      { ordered: false },
    );
  }

  /** Approved partners per earning cohort id. */
  async countByEarningCohort(): Promise<{ id: string; count: number }[]> {
    return this.model
      .aggregate<{ id: string; count: number }>([
        {
          $match: {
            otp_verified: true,
            stage: 'approved',
            'earning_cohort.id': { $type: 'string' },
          },
        },
        { $group: { _id: '$earning_cohort.id', count: { $sum: 1 } } },
        { $project: { _id: 0, id: '$_id', count: 1 } },
      ])
      .exec();
  }

  /** The record an OTP request lands on — created once per number, then reused. */
  async upsertForOtp(phone: string, countryCode: string): Promise<AgentRecord> {
    const filter = { phone, country_code: countryCode };
    try {
      return await this.model
        .findOneAndUpdate(
          filter,
          {
            $setOnInsert: {
              _id: randomUUID(),
              phone,
              country_code: countryCode,
            },
          },
          { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
        )
        .lean<AgentRecord>()
        .exec();
    } catch (error) {
      // Two OTP requests for a new number in the same instant: one inserted.
      if (!isDuplicateKey(error)) throw error;
      const existing = await this.findByPhone(phone, countryCode);
      if (!existing) throw error;
      return existing;
    }
  }

  findByPhone(phone: string, countryCode: string): Promise<AgentRecord | null> {
    return this.model
      .findOne({ phone, country_code: countryCode })
      .lean<AgentRecord | null>()
      .exec();
  }

  findById(id: string): Promise<AgentRecord | null> {
    return this.model.findById(id).lean<AgentRecord | null>().exec();
  }

  findByAgentId(agentId: string): Promise<AgentRecord | null> {
    return this.model
      .findOne({ agent_id: agentId })
      .lean<AgentRecord | null>()
      .exec();
  }

  /** Conditional on `otp_verified: false`, so only the first verify writes ids. */
  completeVerification(
    id: string,
    set: {
      agent_id: string;
      pii_id: string;
      owner_agent_id: string | null;
      at: Date;
    },
  ): Promise<AgentRecord | null> {
    const entry: StageHistoryEntry = {
      from: null,
      to: 'signed_up',
      by: 'self',
      at: set.at,
      reason: 'otp_verified',
    };
    return this.model
      .findOneAndUpdate(
        { _id: id, otp_verified: false },
        {
          $set: {
            otp_verified: true,
            otp_verified_at: set.at,
            last_login_at: set.at,
            agent_id: set.agent_id,
            pii_id: set.pii_id,
            owner_agent_id: set.owner_agent_id,
          },
          $push: { stage_history: entry },
        },
        { returnDocument: 'after' },
      )
      .lean<AgentRecord | null>()
      .exec();
  }

  async touchLogin(id: string): Promise<void> {
    await this.model
      .updateOne(
        { _id: id },
        { $set: { last_login_at: new Date() } },
        { timestamps: false },
      )
      .exec();
  }

  /**
   * Moves the stage only if it still is one of `from` — the guard against two
   * desk users deciding the same partner at once. `null` when it was not.
   */
  transition(
    id: string,
    from: readonly Stage[],
    entry: StageHistoryEntry,
    set: Record<string, unknown> = {},
  ): Promise<AgentRecord | null> {
    const update: UpdateQuery<AgentDocument> = {
      $set: { ...set, stage: entry.to, updated_by: entry.by },
      $push: { stage_history: entry },
    };
    return this.model
      .findOneAndUpdate({ _id: id, stage: { $in: from } }, update, {
        returnDocument: 'after',
      })
      .lean<AgentRecord | null>()
      .exec();
  }

  async linkOnboarding(id: string, onboardingId: string): Promise<void> {
    await this.model
      .updateOne(
        { _id: id, onboarding_id: null },
        { $set: { onboarding_id: onboardingId } },
      )
      .exec();
  }

  async setPreview(
    id: string,
    cohort: string,
    preview: AgentPreview,
  ): Promise<void> {
    await this.model
      .updateOne({ _id: id }, { $set: { cohort, preview } })
      .exec();
  }

  /** The pincode's state / district over the typed ones; `profile` only once approved. */
  async setPlace(
    id: string,
    place: { state?: string; district?: string },
    withProfile: boolean,
  ): Promise<void> {
    const set: Record<string, string> = {};
    for (const [key, value] of Object.entries(place)) {
      if (!value) continue;
      set[`preview.${key}`] = value;
      if (withProfile) set[`profile.${key}`] = value;
    }
    if (Object.keys(set).length === 0) return;
    await this.model.updateOne({ _id: id }, { $set: set }).exec();
  }

  setOwner(
    id: string,
    ownerAgentId: string,
    by: string,
  ): Promise<AgentRecord | null> {
    return this.model
      .findOneAndUpdate(
        { _id: id },
        { $set: { owner_agent_id: ownerAgentId, updated_by: by } },
        { returnDocument: 'after' },
      )
      .lean<AgentRecord | null>()
      .exec();
  }

  /** Conditional on the stage, so a call is never logged on a decided partner. */
  addVerificationCall(
    id: string,
    stages: readonly Stage[],
    call: VerificationCall,
  ): Promise<AgentRecord | null> {
    return this.model
      .findOneAndUpdate(
        { _id: id, stage: { $in: stages } },
        {
          $push: { verification_calls: call },
          $set: { updated_by: call.by },
        },
        { returnDocument: 'after' },
      )
      .select('agent_id stage verification_calls')
      .lean<AgentRecord | null>()
      .exec();
  }

  /** The partner's own profile edit — only while still approved. */
  editProfile(
    id: string,
    set: Record<string, unknown>,
  ): Promise<AgentRecord | null> {
    return this.model
      .findOneAndUpdate(
        { _id: id, stage: 'approved' },
        { $set: { ...set, updated_by: 'self' } },
        { returnDocument: 'after' },
      )
      .lean<AgentRecord | null>()
      .exec();
  }

  /**
   * Conditional on the pending name HO saw, so a newer request the partner
   * sent meanwhile is never approved unseen.
   */
  decideNameChange(
    id: string,
    value: string,
    set: Record<string, unknown>,
  ): Promise<AgentRecord | null> {
    return this.model
      .findOneAndUpdate(
        { _id: id, 'pending_name.value': value },
        { $set: set },
        { returnDocument: 'after' },
      )
      .select('-stage_history')
      .lean<AgentRecord | null>()
      .exec();
  }

  setMonthlyTarget(
    agentId: string,
    target: number | null,
    by: string,
  ): Promise<AgentRecord | null> {
    return this.model
      .findOneAndUpdate(
        { agent_id: agentId, otp_verified: true },
        { $set: { monthly_target: target, updated_by: by } },
        { returnDocument: 'after' },
      )
      .lean<AgentRecord | null>()
      .exec();
  }

  async list(
    filter: AgentListFilter,
    page: { skip: number; limit: number; sort: Record<string, 1 | -1> },
  ): Promise<{ items: AgentRecord[]; total: number }> {
    const query = this.toQuery(filter);
    const [items, total] = await Promise.all([
      this.model
        .find(query)
        .select('-stage_history')
        .sort({ ...page.sort, _id: 1 })
        .skip(page.skip)
        .limit(page.limit)
        .lean<AgentRecord[]>()
        .exec(),
      this.model.countDocuments(query).exec(),
    ]);
    return { items, total };
  }

  /** One pass for every tab's count. */
  /**
   * The HO summary in one round trip: counts per stage (split by OTP
   * verified), and the top cohorts and states among verified partners.
   */
  async summaryCounts(top: number): Promise<{
    stages: { stage: Stage; verified: boolean; count: number }[];
    by_cohort: { key: string; count: number }[];
    by_state: { key: string; count: number }[];
  }> {
    const topBy = (field: string): PipelineStage.FacetPipelineStage[] => [
      { $match: { otp_verified: true, [field]: { $type: 'string', $ne: '' } } },
      { $group: { _id: `$${field}`, count: { $sum: 1 } } },
      { $sort: { count: -1 as const, _id: 1 as const } },
      { $limit: top },
      { $project: { _id: 0, key: '$_id', count: 1 } },
    ];
    const [row] = await this.model
      .aggregate<{
        stages: { _id: { stage: Stage; verified: boolean }; count: number }[];
        by_cohort: { key: string; count: number }[];
        by_state: { key: string; count: number }[];
      }>([
        {
          $facet: {
            stages: [
              {
                $group: {
                  _id: { stage: '$stage', verified: '$otp_verified' },
                  count: { $sum: 1 },
                },
              },
            ],
            by_cohort: topBy('cohort'),
            by_state: topBy('preview.state'),
          },
        },
      ])
      .exec();
    return {
      stages: (row?.stages ?? []).map((r) => ({
        stage: r._id.stage,
        verified: r._id.verified,
        count: r.count,
      })),
      by_cohort: row?.by_cohort ?? [],
      by_state: row?.by_state ?? [],
    };
  }

  /** Partners with a location inside the radius. `$geoWithin` needs no index. */
  near(
    point: GeoPoint,
    radiusKm: number,
    excludeId: string,
    limit: number,
  ): Promise<AgentRecord[]> {
    return this.model
      .find({
        _id: { $ne: excludeId },
        location: {
          $geoWithin: {
            $centerSphere: [point.coordinates, kmToRadians(radiusKm)],
          },
        },
      })
      .select('agent_id stage preview profile location')
      .limit(limit)
      .lean<AgentRecord[]>()
      .exec();
  }

  private toQuery(filter: AgentListFilter): QueryFilter<AgentDocument> {
    const query: Record<string, unknown> = {};
    if (!filter.include_unverified) query.otp_verified = true;
    if (filter.stage) query.stage = filter.stage;
    if (filter.cohort) query.cohort = filter.cohort;
    if (filter.owner_agent_id) query.owner_agent_id = filter.owner_agent_id;
    if (filter.agent_ids) query.agent_id = { $in: filter.agent_ids };
    if (filter.state) query['preview.state'] = filter.state.toUpperCase();
    if (filter.district)
      query['preview.district'] = new RegExp(
        `^${escapeRegex(filter.district)}$`,
        'i',
      );
    if (filter.from || filter.to) {
      query.created_at = {
        ...(filter.from ? { $gte: filter.from } : {}),
        ...(filter.to ? { $lte: filter.to } : {}),
      };
    }
    const q = filter.q?.trim();
    if (q) {
      const upper = q.toUpperCase();
      if (/^VST-\d+$/.test(upper)) query.agent_id = upper;
      else if (/^PII-\d+$/.test(upper)) query.pii_id = upper;
      else if (/^\d{3,10}$/.test(q)) query.phone = new RegExp(`^${q}`);
      else query['preview.name'] = new RegExp(escapeRegex(q), 'i');
    }
    return query;
  }
}
