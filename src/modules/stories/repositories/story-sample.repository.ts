import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, type QueryFilter } from 'mongoose';

import {
  StorySample,
  type StorySampleDocument,
} from '../schemas/story-sample.schema';

/** Far above any real picker; only a bound on a runaway read. */
const ACTIVE_READ_CAP = 200;

@Injectable()
export class StorySampleRepository {
  constructor(
    @InjectModel(StorySample.name)
    private readonly model: Model<StorySampleDocument>,
  ) {}

  listActive(): Promise<StorySample[]> {
    return this.model
      .find({ is_active: true })
      .sort({ order: 1, created_at: -1 })
      .limit(ACTIVE_READ_CAP)
      .lean<StorySample[]>()
      .exec();
  }

  async page(
    isActive: boolean | undefined,
    skip: number,
    limit: number,
    sort: Record<string, 1 | -1>,
  ): Promise<{ rows: StorySample[]; total: number }> {
    const query: QueryFilter<StorySample> =
      isActive === undefined ? {} : { is_active: isActive };
    const [rows, total] = await Promise.all([
      this.model
        .find(query)
        .sort({ ...sort, _id: 1 })
        .skip(skip)
        .limit(limit)
        .lean<StorySample[]>()
        .exec(),
      this.model.countDocuments(query).exec(),
    ]);
    return { rows, total };
  }

  find(id: string): Promise<StorySample | null> {
    return this.model.findById(id).lean<StorySample | null>().exec();
  }

  async create(
    row: Omit<StorySample, 'created_at' | 'updated_at'>,
  ): Promise<StorySample> {
    const doc = await this.model.create(row);
    return doc.toObject<StorySample>();
  }

  update(id: string, set: Partial<StorySample>): Promise<StorySample | null> {
    return this.model
      .findOneAndUpdate({ _id: id }, { $set: set }, { returnDocument: 'after' })
      .lean<StorySample | null>()
      .exec();
  }

  async remove(id: string): Promise<boolean> {
    return (await this.model.deleteOne({ _id: id }).exec()).deletedCount === 1;
  }
}
