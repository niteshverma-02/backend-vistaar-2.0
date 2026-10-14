import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, mongo, type UpdateQuery } from 'mongoose';

import {
  OPEN_STATUSES,
  Withdrawal,
  type WithdrawalDocument,
  type WithdrawalStatus,
} from '../schemas/withdrawal.schema';

export type WithdrawalRecord = Withdrawal;

export interface WithdrawalFilter {
  statuses?: readonly WithdrawalStatus[];
  agentId?: string;
  /** Paid at or after / before — the TDS reports. */
  paidFrom?: Date;
  paidTo?: Date;
}

export interface StatusSum {
  status: WithdrawalStatus;
  count: number;
  amount: number;
  tds: number;
  net: number;
}

@Injectable()
export class WithdrawalRepository {
  constructor(
    @InjectModel(Withdrawal.name)
    private readonly model: Model<WithdrawalDocument>,
  ) {}

  /** `false` when the partner already has an open one (the partial unique index). */
  async insert(
    row: Omit<WithdrawalRecord, 'created_at' | 'updated_at'>,
  ): Promise<boolean> {
    try {
      await this.model.create(row);
      return true;
    } catch (error) {
      if (error instanceof mongo.MongoServerError && error.code === 11000)
        return false;
      throw error;
    }
  }

  findById(id: string): Promise<WithdrawalRecord | null> {
    return this.model.findById(id).lean<WithdrawalRecord | null>().exec();
  }

  /** All of a partner's withdrawals, newest first — tens, not thousands. */
  forAgent(agentId: string): Promise<WithdrawalRecord[]> {
    return this.model
      .find({ agent_id: agentId })
      .sort({ requested_at: -1 })
      .lean<WithdrawalRecord[]>()
      .exec();
  }

  async list(
    filter: WithdrawalFilter,
    page: { skip: number; limit: number },
    sort: Record<string, 1 | -1> = { requested_at: -1 },
  ): Promise<{ items: WithdrawalRecord[]; total: number }> {
    const query = this.toQuery(filter);
    const [items, total] = await Promise.all([
      this.model
        .find(query)
        .sort({ ...sort, _id: 1 })
        .skip(page.skip)
        .limit(page.limit)
        .lean<WithdrawalRecord[]>()
        .exec(),
      this.model.countDocuments(query).exec(),
    ]);
    return { items, total };
  }

  /** Every match, for a bank file or a TDS listing (bounded by the caller's filter). */
  all(filter: WithdrawalFilter, cap: number): Promise<WithdrawalRecord[]> {
    return this.model
      .find(this.toQuery(filter))
      .sort({ requested_at: 1, _id: 1 })
      .limit(cap)
      .lean<WithdrawalRecord[]>()
      .exec();
  }

  /**
   * Moves a withdrawal on only from one of `from`: two desk users, or the
   * partner cancelling while HO approves, cannot both win. `null` when it
   * was not in such a status (or is not this partner's).
   */
  transition(
    id: string,
    from: readonly WithdrawalStatus[],
    to: WithdrawalStatus,
    set: Partial<WithdrawalRecord>,
    agentId?: string,
  ): Promise<WithdrawalRecord | null> {
    const update: UpdateQuery<WithdrawalDocument> = {
      $set: { ...set, status: to },
    };
    if (!OPEN_STATUSES.includes(to)) update.$unset = { open: 1 };
    return this.model
      .findOneAndUpdate(
        {
          _id: id,
          status: { $in: from },
          ...(agentId ? { agent_id: agentId } : {}),
        },
        update,
        { returnDocument: 'after' },
      )
      .lean<WithdrawalRecord | null>()
      .exec();
  }

  /** Count and ₹ per status (optionally paid in a range) — HO's payout cards. */
  sums(filter: WithdrawalFilter): Promise<StatusSum[]> {
    return this.model
      .aggregate<StatusSum>([
        { $match: this.toQuery(filter) },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            amount: { $sum: '$amount' },
            tds: { $sum: '$tds_amount' },
            net: { $sum: '$net_amount' },
          },
        },
        {
          $project: {
            _id: 0,
            status: '$_id',
            count: 1,
            amount: 1,
            tds: 1,
            net: 1,
          },
        },
      ])
      .exec();
  }

  /** Paid withdrawals summed per partner, a page of partners at a time — HO's TDS listing. */
  async paidByAgent(
    filter: WithdrawalFilter,
    page: { skip: number; limit: number },
  ): Promise<{
    items: {
      agent_id: string;
      count: number;
      amount: number;
      tds: number;
      net: number;
    }[];
    total: number;
  }> {
    const [out] = await this.model
      .aggregate<{
        items: {
          agent_id: string;
          count: number;
          amount: number;
          tds: number;
          net: number;
        }[];
        total: { n: number }[];
      }>([
        { $match: this.toQuery({ ...filter, statuses: ['paid'] }) },
        {
          $group: {
            _id: '$agent_id',
            count: { $sum: 1 },
            amount: { $sum: '$amount' },
            tds: { $sum: '$tds_amount' },
            net: { $sum: '$net_amount' },
          },
        },
        { $sort: { _id: 1 } },
        {
          $facet: {
            items: [
              { $skip: page.skip },
              { $limit: page.limit },
              {
                $project: {
                  _id: 0,
                  agent_id: '$_id',
                  count: 1,
                  amount: 1,
                  tds: 1,
                  net: 1,
                },
              },
            ],
            total: [{ $count: 'n' }],
          },
        },
      ])
      .exec();
    return { items: out?.items ?? [], total: out?.total[0]?.n ?? 0 };
  }

  private toQuery(f: WithdrawalFilter) {
    const paid: Record<string, Date> = {};
    if (f.paidFrom) paid.$gte = f.paidFrom;
    if (f.paidTo) paid.$lt = f.paidTo;
    return {
      ...(f.statuses ? { status: { $in: f.statuses } } : {}),
      ...(f.agentId ? { agent_id: f.agentId } : {}),
      ...(f.paidFrom || f.paidTo ? { paid_at: paid } : {}),
    };
  }
}
