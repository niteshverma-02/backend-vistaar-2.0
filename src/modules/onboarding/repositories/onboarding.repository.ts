import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, mongo, type UpdateQuery } from 'mongoose';

import { kmToRadians, type GeoPoint } from '@common/utils/geo.util';

import type { BankChange } from '../bank-change.domain';
import type { IdHolder, IdKeys } from '../id-keys.domain';
import {
  OnboardingData,
  type AdminEdit,
  type OnboardingDataDocument,
} from '../schemas/onboarding-data.schema';

@Injectable()
export class OnboardingRepository {
  constructor(
    @InjectModel(OnboardingData.name)
    private readonly model: Model<OnboardingDataDocument>,
  ) {}

  findByAgent(agentRef: string): Promise<OnboardingData | null> {
    return this.model
      .findOne({ agent_ref: agentRef })
      .lean<OnboardingData | null>()
      .exec();
  }

  /** The partner's one onboarding record; a racing first save gets the same row. */
  async create(row: {
    agent_ref: string;
    agent_id: string;
    pii_id: string;
    cohort: string;
    config_id: string;
    config_version: number;
  }): Promise<OnboardingData> {
    try {
      const doc = await this.model.create({
        _id: randomUUID(),
        ...row,
        raw_data: {},
      });
      return doc.toObject<OnboardingData>();
    } catch (error) {
      if (!(error instanceof mongo.MongoServerError && error.code === 11000))
        throw error;
      const existing = await this.findByAgent(row.agent_ref);
      if (!existing) throw error;
      return existing;
    }
  }

  /**
   * Applies an update only if nobody wrote since `version` was read. `null`
   * means someone did — the caller re-reads and tries again.
   */
  updateIfVersion(
    id: string,
    version: number,
    update: UpdateQuery<OnboardingDataDocument>,
  ): Promise<OnboardingData | null> {
    const withVersion: UpdateQuery<OnboardingDataDocument> = {
      ...update,
      $inc: {
        ...((update.$inc as Record<string, number> | undefined) ?? {}),
        version: 1,
      },
    };
    return this.model
      .findOneAndUpdate({ _id: id, version }, withVersion, {
        returnDocument: 'after',
      })
      .lean<OnboardingData | null>()
      .exec();
  }

  near(
    point: GeoPoint,
    radiusKm: number,
    excludeAgentRef: string,
    limit: number,
  ): Promise<OnboardingData[]> {
    return this.model
      .find({
        agent_ref: { $ne: excludeAgentRef },
        location: {
          $geoWithin: {
            $centerSphere: [point.coordinates, kmToRadians(radiusKm)],
          },
        },
      })
      .select('agent_ref agent_id cohort location')
      .limit(limit)
      .lean<OnboardingData[]>()
      .exec();
  }

  /** Progress for a page of partners, in one query. */
  progressFor(
    agentRefs: string[],
  ): Promise<
    Pick<
      OnboardingData,
      'agent_ref' | 'completion_pct' | 'submitted_at' | 'cohort'
    >[]
  > {
    if (agentRefs.length === 0) return Promise.resolve([]);
    return this.model
      .find({ agent_ref: { $in: agentRefs } })
      .select('agent_ref completion_pct submitted_at cohort')
      .lean<
        Pick<
          OnboardingData,
          'agent_ref' | 'completion_pct' | 'submitted_at' | 'cohort'
        >[]
      >()
      .exec();
  }

  /** What a payout needs from each partner's form, in one read. */
  forPayout(
    agentRefs: readonly string[],
  ): Promise<
    Pick<
      OnboardingData,
      | 'agent_ref'
      | 'cohort'
      | 'config_version'
      | 'raw_data'
      | 'documents_review'
      | 'bank_change'
    >[]
  > {
    return this.model
      .find({ agent_ref: { $in: agentRefs } })
      .select(
        'agent_ref cohort config_version raw_data documents_review bank_change.status',
      )
      .lean<
        Pick<
          OnboardingData,
          | 'agent_ref'
          | 'cohort'
          | 'config_version'
          | 'raw_data'
          | 'documents_review'
          | 'bank_change'
        >[]
      >()
      .exec();
  }

  /** Starts a bank change unless one is pending; `null` when one is. */
  startBankChange(
    agentRef: string,
    change: BankChange,
  ): Promise<OnboardingData | null> {
    return this.model
      .findOneAndUpdate(
        { agent_ref: agentRef, 'bank_change.status': { $ne: 'pending' } },
        {
          $set: { bank_change: change, updated_by: 'self' },
          $inc: { version: 1 },
        },
        { returnDocument: 'after' },
      )
      .lean<OnboardingData | null>()
      .exec();
  }

  /**
   * Writes `set` only while the bank change requested at `requestedAt` is
   * still pending — `null` when it was decided or replaced meanwhile.
   */
  closeBankChange(
    agentRef: string,
    requestedAt: Date,
    version: number,
    set: Record<string, unknown>,
    audit: AdminEdit[] = [],
  ): Promise<OnboardingData | null> {
    const update: UpdateQuery<OnboardingDataDocument> = {
      $set: set,
      $inc: { version: 1 },
    };
    if (audit.length)
      update.$push = { updated_data: { $each: audit, $slice: -200 } };
    return this.model
      .findOneAndUpdate(
        {
          agent_ref: agentRef,
          'bank_change.status': 'pending',
          'bank_change.requested_at': requestedAt,
          // A form edit landing in between must not be overwritten.
          version,
        },
        update,
        { returnDocument: 'after' },
      )
      .lean<OnboardingData | null>()
      .exec();
  }

  /** Other partners' rows holding the same Aadhaar hash or PAN. */
  idHolders(
    keys: IdKeys,
    excludeAgentRef: string,
    limit: number,
  ): Promise<IdHolder[]> {
    const or: Record<string, string>[] = [];
    if (keys.aadhaar_hash)
      or.push({ 'id_keys.aadhaar_hash': keys.aadhaar_hash });
    if (keys.pan) or.push({ 'id_keys.pan': keys.pan });
    if (or.length === 0) return Promise.resolve([]);
    return this.model
      .find({ agent_ref: { $ne: excludeAgentRef }, $or: or })
      .select('agent_ref agent_id id_keys')
      .limit(limit)
      .lean<IdHolder[]>()
      .exec();
  }

  /** A page of rows by `_id`, for one-off backfills. */
  pageAfter(
    afterId: string | null,
    limit: number,
  ): Promise<
    Pick<
      OnboardingData,
      | '_id'
      | 'agent_ref'
      | 'agent_id'
      | 'cohort'
      | 'config_version'
      | 'raw_data'
      | 'id_keys'
      | 'version'
    >[]
  > {
    return this.model
      .find(afterId ? { _id: { $gt: afterId } } : {})
      .sort({ _id: 1 })
      .limit(limit)
      .select(
        'agent_ref agent_id cohort config_version raw_data id_keys version',
      )
      .lean<
        Pick<
          OnboardingData,
          | '_id'
          | 'agent_ref'
          | 'agent_id'
          | 'cohort'
          | 'config_version'
          | 'raw_data'
          | 'id_keys'
          | 'version'
        >[]
      >()
      .exec();
  }

  async countForCohort(cohort: string): Promise<number> {
    return this.model.countDocuments({ cohort }).exec();
  }
}
