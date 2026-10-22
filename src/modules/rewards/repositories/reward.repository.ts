import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, type QueryFilter } from 'mongoose';

import { isDuplicateKey } from '@common/utils/mongo-error.util';
import type {
  EarningTrigger,
  RewardKind,
} from '@modules/earning/earning.domain';

import {
  REWARD_STATUSES,
  type RewardDecision,
  type RewardStatus,
} from '../rewards.domain';
import { Reward, type RewardDocument } from '../schemas/reward.schema';

export type RewardRecord = Reward;
export type NewReward = Omit<Reward, 'created_at' | 'updated_at'>;

export interface RewardFilter {
  agent_id?: string;
  status?: RewardStatus;
  kind?: RewardKind;
  trigger?: EarningTrigger;
  /** `created_at` ≥ from. */
  from?: Date | null;
  /** `created_at` < to. */
  to?: Date | null;
}

export interface RewardTotals {
  kind: RewardKind;
  status: RewardStatus;
  count: number;
  amount: number;
}

const NEWEST_FIRST = { created_at: -1, _id: 1 } as const;

@Injectable()
export class RewardRepository {
  constructor(
    @InjectModel(Reward.name)
    private readonly model: Model<RewardDocument>,
  ) {}

  /**
   * Inserts what is new; an `_id` already there is the same event rewarded
   * before, which is not an error. Answers the ids inserted.
   */
  async insertNew(rows: readonly NewReward[]): Promise<string[]> {
    const inserted: string[] = [];
    for (const row of rows) {
      try {
        await this.model.create(row);
        inserted.push(row._id);
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
      }
    }
    return inserted;
  }

  find(id: string): Promise<RewardRecord | null> {
    return this.model.findById(id).lean<RewardRecord | null>().exec();
  }

  findMany(ids: readonly string[]): Promise<RewardRecord[]> {
    return this.model
      .find({ _id: { $in: ids } })
      .lean<RewardRecord[]>()
      .exec();
  }

  async page(
    filter: RewardFilter,
    skip: number,
    limit: number,
  ): Promise<{ items: RewardRecord[]; total: number }> {
    const query = toQuery(filter);
    const [items, total] = await Promise.all([
      this.model
        .find(query)
        .sort(NEWEST_FIRST)
        .skip(skip)
        .limit(limit)
        .lean<RewardRecord[]>()
        .exec(),
      this.model.countDocuments(query).exec(),
    ]);
    return { items, total };
  }

  /** Count and Σ amount per kind and status. */
  totals(filter: RewardFilter): Promise<RewardTotals[]> {
    return this.model
      .aggregate<RewardTotals>([
        { $match: toQuery(filter) },
        {
          $group: {
            _id: { kind: '$kind', status: '$status' },
            count: { $sum: 1 },
            amount: { $sum: '$amount' },
          },
        },
        {
          $project: {
            _id: 0,
            kind: '$_id.kind',
            status: '$_id.status',
            count: 1,
            amount: 1,
          },
        },
      ])
      .exec();
  }

  /** The partner's approved gigs — what the wallet adds. */
  approvedGigs(
    agentId: string,
  ): Promise<Pick<RewardRecord, '_id' | 'amount' | 'reviewed_at'>[]> {
    return this.model
      .find({ agent_id: agentId, kind: 'gig', status: 'approved' })
      .select({ _id: 1, amount: 1, reviewed_at: 1 })
      .lean<Pick<RewardRecord, '_id' | 'amount' | 'reviewed_at'>[]>()
      .exec();
  }

  /** One pending reward decided; `null` = not there, or not pending any more. */
  decide(
    id: string,
    decision: RewardDecision,
    reason: string | null,
    by: string,
    at: Date,
  ): Promise<RewardRecord | null> {
    return this.model
      .findOneAndUpdate(
        { _id: id, status: 'pending' },
        {
          $set: {
            status: decision,
            reason,
            reviewed_by: by,
            reviewed_at: at,
          },
        },
        { returnDocument: 'after' },
      )
      .lean<RewardRecord | null>()
      .exec();
  }

  /** Every one of `ids` still pending (and `agent_id`'s, when given) decided at once. */
  async decideMany(
    ids: readonly string[],
    decision: RewardDecision,
    reason: string | null,
    by: string,
    at: Date,
    agentId?: string,
  ): Promise<number> {
    const out = await this.model
      .updateMany(
        {
          _id: { $in: ids },
          status: 'pending',
          ...(agentId && { agent_id: agentId }),
        },
        {
          $set: {
            status: decision,
            reason,
            reviewed_by: by,
            reviewed_at: at,
          },
        },
      )
      .exec();
    return out.modifiedCount;
  }
}

function toQuery(filter: RewardFilter): QueryFilter<Reward> {
  const query: QueryFilter<Reward> = {};
  if (filter.agent_id) query.agent_id = filter.agent_id;
  // All statuses as an `$in`: the `{status, created_at}` index then merges
  // the three ranges in order instead of sorting the whole collection.
  query.status = filter.status ?? { $in: [...REWARD_STATUSES] };
  if (filter.kind) query.kind = filter.kind;
  if (filter.trigger) query.trigger = filter.trigger;
  if (filter.from || filter.to) {
    query.created_at = {
      ...(filter.from && { $gte: filter.from }),
      ...(filter.to && { $lt: filter.to }),
    };
  }
  return query;
}
