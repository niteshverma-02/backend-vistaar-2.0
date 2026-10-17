import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, mongo } from 'mongoose';

import {
  DEFAULT_COHORT_ID,
  DEFAULT_COHORT_NAME,
  NO_FILTERS,
} from '../earning.domain';
import {
  EarningCohort,
  type EarningCohortDocument,
} from '../schemas/earning-cohort.schema';

export type EarningCohortRecord = EarningCohort;

/** What an edit may set (`filters` only as the view derived from `conditions`). */
export type EarningCohortPatch = Partial<
  Pick<
    EarningCohort,
    'name' | 'description' | 'conditions' | 'filters' | 'meeting_gig_payout'
  >
>;

const isDuplicateKey = (error: unknown): boolean =>
  error instanceof mongo.MongoServerError && error.code === 11000;

@Injectable()
export class EarningCohortRepository {
  constructor(
    @InjectModel(EarningCohort.name)
    private readonly model: Model<EarningCohortDocument>,
  ) {}

  /** Every cohort, archived ones too — a few dozen rows. */
  all(): Promise<EarningCohortRecord[]> {
    return this.model.find().lean<EarningCohortRecord[]>().exec();
  }

  find(id: string): Promise<EarningCohortRecord | null> {
    return this.model.findById(id).lean<EarningCohortRecord | null>().exec();
  }

  /** The built-in default, written once by whichever process reads first. */
  async ensureDefault(): Promise<void> {
    try {
      await this.model
        .updateOne(
          { _id: DEFAULT_COHORT_ID },
          {
            $setOnInsert: {
              name: DEFAULT_COHORT_NAME,
              description: 'Every partner no other cohort takes.',
              conditions: [],
              filters: NO_FILTERS,
              priority: 0,
              status: 'active',
              meeting_gig_payout: null,
              version: 1,
              created_by: 'system',
              updated_by: 'system',
              archived_by: null,
              archived_at: null,
            },
          },
          { upsert: true },
        )
        .exec();
    } catch (error) {
      // Two processes upserting at once: one inserted it, which is all we need.
      if (!isDuplicateKey(error)) throw error;
    }
  }

  /** `false` when the id is taken. */
  async create(
    row: Omit<EarningCohort, 'created_at' | 'updated_at'>,
  ): Promise<boolean> {
    try {
      await this.model.create(row);
      return true;
    } catch (error) {
      if (isDuplicateKey(error)) return false;
      throw error;
    }
  }

  /** Writes only an active cohort still at `version`; `null` otherwise. */
  save(
    id: string,
    version: number,
    set: EarningCohortPatch,
    by: string,
  ): Promise<EarningCohortRecord | null> {
    return this.model
      .findOneAndUpdate(
        { _id: id, version, status: 'active' },
        { $set: { ...set, updated_by: by }, $inc: { version: 1 } },
        { returnDocument: 'after' },
      )
      .lean<EarningCohortRecord | null>()
      .exec();
  }

  archive(id: string, by: string): Promise<EarningCohortRecord | null> {
    return this.model
      .findOneAndUpdate(
        { _id: id, status: 'active' },
        {
          $set: {
            status: 'archived',
            archived_by: by,
            archived_at: new Date(),
            updated_by: by,
          },
          $inc: { version: 1 },
        },
        { returnDocument: 'after' },
      )
      .lean<EarningCohortRecord | null>()
      .exec();
  }

  /** `ids[0]` gets priority 1. Only active cohorts move. */
  async setPriorities(ids: readonly string[], by: string): Promise<void> {
    if (ids.length === 0) return;
    await this.model.bulkWrite(
      ids.map((id, i) => ({
        updateOne: {
          filter: { _id: id, status: 'active' },
          update: { $set: { priority: i + 1, updated_by: by } },
        },
      })),
    );
  }
}
