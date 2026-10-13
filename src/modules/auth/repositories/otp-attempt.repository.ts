import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import {
  OtpAttempt,
  type OtpAttemptDocument,
} from '../schemas/otp-attempt.schema';

/** A sliding window of hits, one atomic update per take. */
@Injectable()
export class OtpAttemptRepository {
  constructor(
    @InjectModel(OtpAttempt.name)
    private readonly model: Model<OtpAttemptDocument>,
  ) {}

  /**
   * Drops hits older than the window, then records this one only if there
   * is room — in one pipeline update, so two processes taking at once cannot
   * both slip past the limit. Returns 0, or the seconds until a slot frees.
   */
  async take(
    id: string,
    limit: number,
    windowMs: number,
    now: Date,
  ): Promise<number> {
    const cutoff = new Date(now.getTime() - windowMs);
    const row = await this.model
      .findOneAndUpdate(
        { _id: id },
        [
          {
            $set: {
              hits: {
                $filter: {
                  input: { $ifNull: ['$hits', []] },
                  cond: { $gt: ['$$this', cutoff] },
                },
              },
            },
          },
          { $set: { allowed: { $lt: [{ $size: '$hits' }, limit] } } },
          {
            $set: {
              hits: {
                $cond: [
                  '$allowed',
                  { $concatArrays: ['$hits', [now]] },
                  '$hits',
                ],
              },
              expires_at: new Date(now.getTime() + windowMs),
            },
          },
        ],
        { upsert: true, returnDocument: 'after', updatePipeline: true },
      )
      .lean<OtpAttempt>()
      .exec();
    if (!row || row.allowed) return 0;
    const oldest = row.hits[0]?.getTime() ?? now.getTime();
    const wait = Math.ceil((windowMs - (now.getTime() - oldest)) / 1000);
    return Math.min(Math.max(wait, 1), Math.ceil(windowMs / 1000));
  }

  async reset(id: string): Promise<void> {
    await this.model.deleteOne({ _id: id }).exec();
  }
}
