import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import {
  AppCounter,
  type AppCounterDocument,
} from '../schemas/app-counter.schema';

/** The `app_counters` keys Vistaar draws org ids from. */
export type OrgCounterKey = 'addresses' | 'leads' | 'contacts';

@Injectable()
export class OrgCounterRepository {
  constructor(
    @InjectModel(AppCounter.name)
    private readonly counters: Model<AppCounterDocument>,
  ) {}

  /**
   * The same `$inc` ko-sales, prasar and franchise issue, so a number taken
   * here is never handed out again. Never an upsert: the rows exist, and a
   * missing one is a wrong database, not a counter to start at 1.
   */
  async next(key: OrgCounterKey): Promise<number> {
    const doc = await this.counters
      .findOneAndUpdate(
        { _id: key },
        { $inc: { count: 1 }, $set: { updated_at: new Date() } },
        { returnDocument: 'after' },
      )
      .lean<{ count: number } | null>()
      .exec();
    if (!doc) throw new Error(`app_counters has no "${key}" row`);
    return doc.count;
  }
}
