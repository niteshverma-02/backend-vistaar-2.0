import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, type QueryFilter } from 'mongoose';

import type { FestivalStatus } from '../stories.domain';
import {
  StoryDesign,
  type StoryDesignDocument,
} from '../schemas/story-design.schema';

/** Far above any real design list; only a bound on a runaway read. */
const ACTIVE_READ_CAP = 100;

@Injectable()
export class StoryDesignRepository {
  constructor(
    @InjectModel(StoryDesign.name)
    private readonly model: Model<StoryDesignDocument>,
  ) {}

  /** Active and not ended — scheduled ones included, so a cached copy goes live on time. */
  listActive(now: Date): Promise<StoryDesign[]> {
    return this.model
      .find({
        is_active: true,
        $or: [{ ends_at: null }, { ends_at: { $gt: now } }],
      })
      .sort({ order: 1, created_at: 1 })
      .limit(ACTIVE_READ_CAP)
      .lean<StoryDesign[]>()
      .exec();
  }

  async page(
    status: FestivalStatus | undefined,
    now: Date,
    skip: number,
    limit: number,
    sort: Record<string, 1 | -1>,
  ): Promise<{ rows: StoryDesign[]; total: number }> {
    const query = queryOf(status, now);
    const [rows, total] = await Promise.all([
      this.model
        .find(query)
        .sort({ ...sort, _id: 1 })
        .skip(skip)
        .limit(limit)
        .lean<StoryDesign[]>()
        .exec(),
      this.model.countDocuments(query).exec(),
    ]);
    return { rows, total };
  }

  findByKey(key: string): Promise<StoryDesign | null> {
    return this.model.findOne({ key }).lean<StoryDesign | null>().exec();
  }

  find(id: string): Promise<StoryDesign | null> {
    return this.model.findById(id).lean<StoryDesign | null>().exec();
  }

  async create(
    row: Omit<StoryDesign, 'created_at' | 'updated_at'>,
  ): Promise<StoryDesign> {
    const doc = await this.model.create(row);
    return doc.toObject<StoryDesign>();
  }

  update(id: string, set: Partial<StoryDesign>): Promise<StoryDesign | null> {
    return this.model
      .findOneAndUpdate({ _id: id }, { $set: set }, { returnDocument: 'after' })
      .lean<StoryDesign | null>()
      .exec();
  }

  async remove(id: string): Promise<boolean> {
    return (await this.model.deleteOne({ _id: id }).exec()).deletedCount === 1;
  }

  /** Designs still drawing this art (a copied design shares its file). */
  countByImage(path: string): Promise<number> {
    return this.model.countDocuments({ image_path: path }).exec();
  }
}

/** The Mongo side of `festivalStatus` — keep the two in step. */
function queryOf(
  status: FestivalStatus | undefined,
  now: Date,
): QueryFilter<StoryDesign> {
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
