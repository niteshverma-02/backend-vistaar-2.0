import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, type QueryFilter } from 'mongoose';

import type { CropSeason } from '../crop-calendar.domain';
import {
  CropCalendarEntry,
  type CropCalendarDocument,
} from '../schemas/crop-calendar.schema';

/** Far above any real crop list; only a bound on a runaway read. */
const ACTIVE_READ_CAP = 300;

export interface CropFilter {
  season?: CropSeason;
  is_active?: boolean;
}

@Injectable()
export class CropCalendarRepository {
  constructor(
    @InjectModel(CropCalendarEntry.name)
    private readonly model: Model<CropCalendarDocument>,
  ) {}

  listActive(): Promise<CropCalendarEntry[]> {
    return this.model
      .find({ is_active: true })
      .sort({ order: 1, _id: 1 })
      .limit(ACTIVE_READ_CAP)
      .lean<CropCalendarEntry[]>()
      .exec();
  }

  async page(
    filter: CropFilter,
    skip: number,
    limit: number,
    sort: Record<string, 1 | -1>,
  ): Promise<{ rows: CropCalendarEntry[]; total: number }> {
    const query: QueryFilter<CropCalendarEntry> = {};
    if (filter.season) query.season = filter.season;
    if (filter.is_active !== undefined) query.is_active = filter.is_active;
    const [rows, total] = await Promise.all([
      this.model
        .find(query)
        .sort({ ...sort, _id: 1 })
        .skip(skip)
        .limit(limit)
        .lean<CropCalendarEntry[]>()
        .exec(),
      this.model.countDocuments(query).exec(),
    ]);
    return { rows, total };
  }

  find(key: string): Promise<CropCalendarEntry | null> {
    return this.model.findById(key).lean<CropCalendarEntry | null>().exec();
  }

  async create(
    row: Omit<CropCalendarEntry, 'created_at' | 'updated_at'>,
  ): Promise<CropCalendarEntry> {
    const doc = await this.model.create(row);
    return doc.toObject<CropCalendarEntry>();
  }

  update(
    key: string,
    set: Partial<CropCalendarEntry>,
  ): Promise<CropCalendarEntry | null> {
    return this.model
      .findOneAndUpdate(
        { _id: key },
        { $set: set },
        { returnDocument: 'after' },
      )
      .lean<CropCalendarEntry | null>()
      .exec();
  }

  async remove(key: string): Promise<boolean> {
    return (await this.model.deleteOne({ _id: key }).exec()).deletedCount === 1;
  }
}
