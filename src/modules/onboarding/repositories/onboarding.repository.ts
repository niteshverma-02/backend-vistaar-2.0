import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, mongo, type UpdateQuery } from 'mongoose';

import { kmToRadians, type GeoPoint } from '@common/utils/geo.util';

import {
  OnboardingData,
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
    >[]
  > {
    return this.model
      .find({ agent_ref: { $in: agentRefs } })
      .select('agent_ref cohort config_version raw_data documents_review')
      .lean<
        Pick<
          OnboardingData,
          | 'agent_ref'
          | 'cohort'
          | 'config_version'
          | 'raw_data'
          | 'documents_review'
        >[]
      >()
      .exec();
  }

  async countForCohort(cohort: string): Promise<number> {
    return this.model.countDocuments({ cohort }).exec();
  }
}
