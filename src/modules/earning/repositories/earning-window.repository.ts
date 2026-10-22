import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { isDuplicateKey } from '@common/utils/mongo-error.util';

import {
  EarningWindow,
  type EarningWindowDocument,
} from '../schemas/earning-window.schema';

const ROW_ID = 'earning_window_day';

@Injectable()
export class EarningWindowRepository {
  constructor(
    @InjectModel(EarningWindow.name)
    private readonly model: Model<EarningWindowDocument>,
  ) {}

  /**
   * Moves the row to `today` in one atomic write. `since` is the day it held
   * before (`null` = never set); `null` when another process got there first.
   */
  async claimDay(today: string): Promise<{ since: string | null } | null> {
    try {
      const before = await this.model
        .findOneAndUpdate(
          { _id: ROW_ID, day: { $ne: today } },
          { $set: { day: today } },
          { upsert: true, returnDocument: 'before' },
        )
        .lean<EarningWindow | null>()
        .exec();
      return { since: before?.day ?? null };
    } catch (error) {
      // The row is already at today, so the upsert's insert hit its `_id`.
      if (isDuplicateKey(error)) return null;
      throw error;
    }
  }
}
