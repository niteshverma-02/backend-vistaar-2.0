import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { isDuplicateKey } from '@common/utils/mongo-error.util';

import {
  CoinAccount,
  type CoinAccountDocument,
} from '../schemas/coin-account.schema';

export type CoinAccountRecord = CoinAccount;

@Injectable()
export class CoinAccountRepository {
  constructor(
    @InjectModel(CoinAccount.name)
    private readonly model: Model<CoinAccountDocument>,
  ) {}

  find(agentId: string): Promise<CoinAccountRecord | null> {
    return this.model.findById(agentId).lean<CoinAccountRecord | null>().exec();
  }

  /**
   * A new redemption `id`, only while `spent + coins ≤ approved` and `id` is
   * not there yet. The caller has checked `coins ≤ approved`: the first spend
   * inserts the account. `false` = refused (balance, or `id` already there).
   */
  async hold(
    agentId: string,
    id: string,
    coins: number,
    approved: number,
    at: Date,
  ): Promise<boolean> {
    try {
      const out = await this.model
        .updateOne(
          {
            _id: agentId,
            spent: { $lte: approved - coins },
            'redemptions.id': { $ne: id },
          },
          {
            $inc: { spent: coins },
            $push: {
              redemptions: { id, coins, active: true, at, released_at: null },
            },
          },
          // No schema defaults on insert: they would clash with `$inc` / `$push` on the same paths.
          { upsert: true, setDefaultsOnInsert: false },
        )
        .exec();
      return out.modifiedCount + out.upsertedCount === 1;
    } catch (error) {
      // The account is there but the filter refused it: the upsert hit its `_id`.
      if (isDuplicateKey(error)) return false;
      throw error;
    }
  }

  /** A released redemption `id` held again, only while `spent + coins ≤ approved`. */
  async rehold(
    agentId: string,
    id: string,
    coins: number,
    approved: number,
    at: Date,
  ): Promise<boolean> {
    const out = await this.model
      .updateOne(
        {
          _id: agentId,
          spent: { $lte: approved - coins },
          redemptions: { $elemMatch: { id, active: false } },
        },
        {
          $inc: { spent: coins },
          $set: {
            'redemptions.$.coins': coins,
            'redemptions.$.active': true,
            'redemptions.$.at': at,
            'redemptions.$.released_at': null,
          },
        },
      )
      .exec();
    return out.modifiedCount === 1;
  }

  /** The active redemption `id` (of `coins`) released. `false` = not active. */
  async release(
    agentId: string,
    id: string,
    coins: number,
    at: Date,
  ): Promise<boolean> {
    const out = await this.model
      .updateOne(
        {
          _id: agentId,
          redemptions: { $elemMatch: { id, coins, active: true } },
        },
        {
          $inc: { spent: -coins },
          $set: {
            'redemptions.$.active': false,
            'redemptions.$.released_at': at,
          },
        },
      )
      .exec();
    return out.modifiedCount === 1;
  }
}
