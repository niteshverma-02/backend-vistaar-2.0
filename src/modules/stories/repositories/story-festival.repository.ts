import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, type QueryFilter } from 'mongoose';

import type { FestivalStatus } from '../stories.domain';
import {
  StoryFestival,
  type StoryFestivalDocument,
} from '../schemas/story-festival.schema';

/** Far above any real festival list; only a bound on a runaway read. */
const ACTIVE_READ_CAP = 200;

@Injectable()
export class StoryFestivalRepository {
  constructor(
    @InjectModel(StoryFestival.name)
    private readonly model: Model<StoryFestivalDocument>,
  ) {}

  /** Active and not ended — scheduled ones included, so a cached copy goes live on time. */
  listActive(now: Date): Promise<StoryFestival[]> {
    return this.model
      .find({
        is_active: true,
        $or: [{ ends_at: null }, { ends_at: { $gt: now } }],
      })
      .sort({ order: 1, created_at: -1 })
      .limit(ACTIVE_READ_CAP)
      .lean<StoryFestival[]>()
      .exec();
  }

  async page(
    status: FestivalStatus | undefined,
    now: Date,
    skip: number,
    limit: number,
    sort: Record<string, 1 | -1>,
  ): Promise<{ rows: StoryFestival[]; total: number }> {
    const query = queryOf(status, now);
    const [rows, total] = await Promise.all([
      this.model
        .find(query)
        .sort({ ...sort, _id: 1 })
        .skip(skip)
        .limit(limit)
        .lean<StoryFestival[]>()
        .exec(),
      this.model.countDocuments(query).exec(),
    ]);
    return { rows, total };
  }

  find(id: string): Promise<StoryFestival | null> {
    return this.model.findById(id).lean<StoryFestival | null>().exec();
  }

  async create(
    row: Omit<StoryFestival, 'created_at' | 'updated_at'>,
  ): Promise<StoryFestival> {
    const doc = await this.model.create(row);
    return doc.toObject<StoryFestival>();
  }

  update(
    id: string,
    set: Partial<StoryFestival>,
  ): Promise<StoryFestival | null> {
    return this.model
      .findOneAndUpdate({ _id: id }, { $set: set }, { returnDocument: 'after' })
      .lean<StoryFestival | null>()
      .exec();
  }

  async remove(id: string): Promise<boolean> {
    return (await this.model.deleteOne({ _id: id }).exec()).deletedCount === 1;
  }
}

/** The Mongo side of `festivalStatus` — keep the two in step. */
function queryOf(
  status: FestivalStatus | undefined,
  now: Date,
): QueryFilter<StoryFestival> {
  switch (status) {
    case 'inactive':
      return { is_active: false };
    case 'expired':
      return { is_active: true, ends_at: { $lte: now } };
    case 'scheduled':
      return {
        is_active: true,
        starts_at: { $gt: now },
        $or: [{ ends_at: null }, { ends_at: { $gt: now } }],
      };
    case 'live':
      return {
        $and: [
          { is_active: true },
          { $or: [{ starts_at: null }, { starts_at: { $lte: now } }] },
          { $or: [{ ends_at: null }, { ends_at: { $gt: now } }] },
        ],
      };
    case undefined:
      return {};
  }
}
