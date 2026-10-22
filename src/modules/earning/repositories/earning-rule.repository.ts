import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, type QueryFilter } from 'mongoose';

import type { EarningStatus, EarningTrigger } from '../earning.domain';
import {
  EarningRule,
  type EarningRuleDocument,
} from '../schemas/earning-rule.schema';

export type EarningRuleRecord = EarningRule;

export type EarningRulePatch = Partial<
  Pick<EarningRule, 'name' | 'conditions' | 'reward' | 'enabled'>
>;

export interface EarningRuleFilter {
  cohort_id?: string;
  trigger?: EarningTrigger;
  status?: EarningStatus;
  /** `true` also takes rules from before the switch (no field = on). */
  enabled?: boolean;
}

/** Far above what HO would write; only a bound on a runaway read. */
const LIST_CAP = 2000;

@Injectable()
export class EarningRuleRepository {
  constructor(
    @InjectModel(EarningRule.name)
    private readonly model: Model<EarningRuleDocument>,
  ) {}

  list(filter: EarningRuleFilter): Promise<EarningRuleRecord[]> {
    const query: QueryFilter<EarningRule> = {};
    if (filter.cohort_id) query.cohort_id = filter.cohort_id;
    if (filter.trigger) query.trigger = filter.trigger;
    if (filter.status) query.status = filter.status;
    if (filter.enabled !== undefined) {
      query.enabled = filter.enabled ? { $ne: false } : false;
    }
    return this.model
      .find(query)
      .sort({ cohort_id: 1, order: 1, _id: 1 })
      .limit(LIST_CAP)
      .lean<EarningRuleRecord[]>()
      .exec();
  }

  find(id: string): Promise<EarningRuleRecord | null> {
    return this.model.findById(id).lean<EarningRuleRecord | null>().exec();
  }

  /** A cohort's active rules, in HO's order; one trigger's when given. */
  active(
    cohortId: string,
    trigger?: EarningTrigger,
  ): Promise<EarningRuleRecord[]> {
    return this.model
      .find({
        cohort_id: cohortId,
        ...(trigger && { trigger }),
        status: 'active',
      })
      .sort({ order: 1, _id: 1 })
      .lean<EarningRuleRecord[]>()
      .exec();
  }

  async maxOrder(cohortId: string): Promise<number> {
    const top = await this.model
      .findOne({ cohort_id: cohortId, status: 'active' })
      .sort({ order: -1 })
      .select({ order: 1 })
      .lean<{ order: number } | null>()
      .exec();
    return top?.order ?? 0;
  }

  async create(
    row: Omit<EarningRule, 'created_at' | 'updated_at'>,
  ): Promise<EarningRuleRecord> {
    const doc = await this.model.create(row);
    return doc.toObject<EarningRuleRecord>();
  }

  /** Writes only an active rule still at `version`; `null` otherwise. */
  save(
    id: string,
    version: number,
    set: EarningRulePatch,
    by: string,
  ): Promise<EarningRuleRecord | null> {
    return this.model
      .findOneAndUpdate(
        { _id: id, version, status: 'active' },
        { $set: { ...set, updated_by: by }, $inc: { version: 1 } },
        { returnDocument: 'after' },
      )
      .lean<EarningRuleRecord | null>()
      .exec();
  }

  archive(id: string, by: string): Promise<EarningRuleRecord | null> {
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
      .lean<EarningRuleRecord | null>()
      .exec();
  }

  /** `ids[0]` gets order 1, within the one cohort. */
  async setOrder(
    cohortId: string,
    ids: readonly string[],
    by: string,
  ): Promise<void> {
    if (ids.length === 0) return;
    await this.model.bulkWrite(
      ids.map((id, i) => ({
        updateOne: {
          filter: { _id: id, cohort_id: cohortId, status: 'active' },
          update: { $set: { order: i + 1, updated_by: by } },
        },
      })),
    );
  }
}
