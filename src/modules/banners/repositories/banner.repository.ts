import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, type QueryFilter } from 'mongoose';

import { windowQuery } from '@common/utils/schedule-window.util';

import type { BannerStatus } from '../banners.domain';
import { Banner, type BannerDocument } from '../schemas/banner.schema';

export interface BannerFilter {
  status?: BannerStatus;
  cohort?: string;
}

/** Far above any real carousel; only a bound on a runaway read. */
const ACTIVE_READ_CAP = 200;

@Injectable()
export class BannerRepository {
  constructor(
    @InjectModel(Banner.name) private readonly model: Model<BannerDocument>,
  ) {}

  /** Every active banner not yet ended — scheduled ones included, so a cached copy goes live on time. */
  listActive(now: Date): Promise<Banner[]> {
    return this.model
      .find({
        is_active: true,
        $or: [{ ends_at: null }, { ends_at: { $gt: now } }],
      })
      .sort({ order: 1, created_at: -1 })
      .limit(ACTIVE_READ_CAP)
      .lean<Banner[]>()
      .exec();
  }

  async page(
    filter: BannerFilter,
    now: Date,
    skip: number,
    limit: number,
    sort: Record<string, 1 | -1>,
  ): Promise<{ rows: Banner[]; total: number }> {
    const query = queryOf(filter, now);
    const [rows, total] = await Promise.all([
      this.model
        .find(query)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean<Banner[]>()
        .exec(),
      this.model.countDocuments(query).exec(),
    ]);
    return { rows, total };
  }

  find(id: string): Promise<Banner | null> {
    return this.model.findById(id).lean<Banner | null>().exec();
  }

  async create(
    row: Omit<Banner, 'created_at' | 'updated_at'>,
  ): Promise<Banner> {
    const doc = await this.model.create(row);
    return doc.toObject<Banner>();
  }

  update(id: string, set: Partial<Banner>): Promise<Banner | null> {
    return this.model
      .findOneAndUpdate({ _id: id }, { $set: set }, { returnDocument: 'after' })
      .lean<Banner | null>()
      .exec();
  }

  async ids(): Promise<string[]> {
    const rows = await this.model
      .find({}, { _id: 1 })
      .lean<{ _id: string }[]>()
      .exec();
    return rows.map((r) => r._id);
  }

  /** `order` = position in `ids`, in one round trip. */
  async reorder(ids: string[], by: string): Promise<void> {
    await this.model.bulkWrite(
      ids.map((id, order) => ({
        updateOne: {
          filter: { _id: id },
          update: { $set: { order, updated_by: by } },
        },
      })),
    );
  }

  countByImage(path: string): Promise<number> {
    return this.model.countDocuments({ image_path: path }).exec();
  }

  async remove(id: string): Promise<boolean> {
    return (await this.model.deleteOne({ _id: id }).exec()).deletedCount === 1;
  }
}

function queryOf(filter: BannerFilter, now: Date): QueryFilter<Banner> {
  const and: QueryFilter<Banner>[] = [];
  if (filter.status) and.push(windowQuery(filter.status, now));
  // A banner for every partner is shown to this cohort too.
  if (filter.cohort) {
    and.push({ $or: [{ cohorts: filter.cohort }, { cohorts: { $size: 0 } }] });
  }
  return and.length ? { $and: and } : {};
}
