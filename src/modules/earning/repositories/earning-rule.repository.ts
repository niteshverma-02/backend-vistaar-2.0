import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, type PipelineStage, type QueryFilter } from 'mongoose';

import {
  MAX_RULES_PER_COHORT,
  type EarningStatus,
  type EarningTrigger,
} from '../earning.domain';
import {
  EarningCohort,
  type EarningCohortDocument,
} from '../schemas/earning-cohort.schema';
import type { EarningRule } from '../schemas/earning-rule.schema';

/** A rule as read: the embedded row plus the cohort it lives in. */
export type EarningRuleRecord = EarningRule & { cohort_id: string };

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

/** The one rule in `rules`, positionally — the arrayFilters identifier. */
const AT = 'rules.$[rule]';

/**
 * The rules embedded in `vistaar_v2_earning_cohorts.rules[]`. Every write
 * changes one rule's own fields by its id, guarded by its own `version` /
 * `status` in the filter and the arrayFilter; the cohort's `version`,
 * `updated_by` and `updated_at` are never touched (`timestamps: false`).
 */
@Injectable()
export class EarningRuleRepository {
  constructor(
    @InjectModel(EarningCohort.name)
    private readonly model: Model<EarningCohortDocument>,
  ) {}

  list(filter: EarningRuleFilter): Promise<EarningRuleRecord[]> {
    const rule: Record<string, unknown> = {};
    if (filter.trigger) rule['rules.trigger'] = filter.trigger;
    if (filter.status) rule['rules.status'] = filter.status;
    if (filter.enabled !== undefined) {
      rule['rules.enabled'] = filter.enabled ? { $ne: false } : false;
    }
    const pipeline: PipelineStage[] = [
      { $match: filter.cohort_id ? { _id: filter.cohort_id } : {} },
      { $unwind: '$rules' },
      { $match: rule },
      {
        $replaceRoot: {
          newRoot: { $mergeObjects: ['$rules', { cohort_id: '$_id' }] },
        },
      },
      { $sort: { cohort_id: 1, order: 1, _id: 1 } },
      { $limit: LIST_CAP },
    ];
    return this.model.aggregate<EarningRuleRecord>(pipeline).exec();
  }

  async find(id: string): Promise<EarningRuleRecord | null> {
    const row = await this.model
      .findOne({ 'rules._id': id }, { 'rules.$': 1 })
      .lean<Pick<EarningCohort, '_id' | 'rules'> | null>()
      .exec();
    return ruleIn(row, id);
  }

  /**
   * Appends to an active cohort holding fewer than `MAX_RULES_PER_COHORT`
   * rules; `null` otherwise (the caller reads again to say why).
   */
  async add(
    cohortId: string,
    row: Omit<EarningRule, 'created_at' | 'updated_at'>,
  ): Promise<EarningRuleRecord | null> {
    const now = new Date();
    const saved = await this.model
      .findOneAndUpdate(
        {
          _id: cohortId,
          status: 'active',
          [`rules.${MAX_RULES_PER_COHORT - 1}`]: { $exists: false },
        },
        { $push: { rules: { ...row, created_at: now, updated_at: now } } },
        {
          returnDocument: 'after',
          projection: { rules: 1 },
          timestamps: false,
        },
      )
      .lean<Pick<EarningCohort, '_id' | 'rules'> | null>()
      .exec();
    return ruleIn(saved, row._id);
  }

  /** Writes only an active rule still at `version`; `null` otherwise. */
  save(
    id: string,
    version: number,
    set: EarningRulePatch,
    by: string,
  ): Promise<EarningRuleRecord | null> {
    const fields = Object.fromEntries(
      Object.entries({ ...set, updated_by: by, updated_at: new Date() }).map(
        ([k, v]) => [`${AT}.${k}`, v],
      ),
    );
    return this.updateOne(
      id,
      { version, status: 'active' },
      {
        $set: fields,
        $inc: { [`${AT}.version`]: 1 },
      },
    );
  }

  archive(id: string, by: string): Promise<EarningRuleRecord | null> {
    const now = new Date();
    return this.updateOne(
      id,
      { status: 'active' },
      {
        $set: {
          [`${AT}.status`]: 'archived',
          [`${AT}.archived_by`]: by,
          [`${AT}.archived_at`]: now,
          [`${AT}.updated_by`]: by,
          [`${AT}.updated_at`]: now,
        },
        $inc: { [`${AT}.version`]: 1 },
      },
    );
  }

  /** `ids[0]` gets order 1, within the one cohort; one write for them all. */
  async setOrder(
    cohortId: string,
    ids: readonly string[],
    by: string,
  ): Promise<void> {
    if (ids.length === 0) return;
    const now = new Date();
    const set: Record<string, unknown> = {};
    const arrayFilters = ids.map((id, i) => {
      set[`rules.$[r${i}].order`] = i + 1;
      set[`rules.$[r${i}].updated_by`] = by;
      set[`rules.$[r${i}].updated_at`] = now;
      return { [`r${i}._id`]: id, [`r${i}.status`]: 'active' };
    });
    await this.model
      .updateOne(
        { _id: cohortId },
        { $set: set },
        { arrayFilters, timestamps: false },
      )
      .exec();
  }

  /** One rule, matched by id plus `guard` both to find the cohort and to pick the element. */
  private async updateOne(
    id: string,
    guard: Partial<Pick<EarningRule, 'version' | 'status'>>,
    update: { $set: Record<string, unknown>; $inc: Record<string, number> },
  ): Promise<EarningRuleRecord | null> {
    const match: QueryFilter<EarningCohort> = {
      rules: { $elemMatch: { _id: id, ...guard } },
    };
    const element = Object.fromEntries(
      Object.entries({ _id: id, ...guard }).map(([k, v]) => [`rule.${k}`, v]),
    );
    const saved = await this.model
      .findOneAndUpdate(match, update, {
        returnDocument: 'after',
        projection: { rules: 1 },
        arrayFilters: [element],
        timestamps: false,
      })
      .lean<Pick<EarningCohort, '_id' | 'rules'> | null>()
      .exec();
    return ruleIn(saved, id);
  }
}

function ruleIn(
  row: Pick<EarningCohort, '_id' | 'rules'> | null,
  id: string,
): EarningRuleRecord | null {
  if (!row) return null;
  const rule = row.rules?.find((r) => r._id === id);
  return rule ? { ...rule, cohort_id: row._id } : null;
}
