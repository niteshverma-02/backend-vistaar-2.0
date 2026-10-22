import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, type QueryFilter } from 'mongoose';

import { StorySample } from '../schemas/story-sample.schema';
import {
  fromStored,
  storedId,
  toStored,
  type StoredContent,
} from './story-content.mapping';

/** Far above any real picker; only a bound on a runaway read. */
const ACTIVE_READ_CAP = 200;

const KIND = 'sample';

type Stored = StoredContent<StorySample>;

const out = (row: Stored): StorySample => fromStored(KIND, row);

/** The `sample` rows of `vistaar_v2_story_content`; the model adds `kind` to every query. */
@Injectable()
export class StorySampleRepository {
  constructor(
    @InjectModel(StorySample.name)
    private readonly model: Model<Stored>,
  ) {}

  async listActive(): Promise<StorySample[]> {
    const rows = await this.model
      .find({ is_active: true })
      .sort({ order: 1, created_at: -1 })
      .limit(ACTIVE_READ_CAP)
      .lean<Stored[]>()
      .exec();
    return rows.map(out);
  }

  async page(
    isActive: boolean | undefined,
    skip: number,
    limit: number,
    sort: Record<string, 1 | -1>,
  ): Promise<{ rows: StorySample[]; total: number }> {
    const query: QueryFilter<Stored> =
      isActive === undefined ? {} : { is_active: isActive };
    const [rows, total] = await Promise.all([
      this.model
        .find(query)
        .sort({ ...sort, _id: 1 })
        .skip(skip)
        .limit(limit)
        .lean<Stored[]>()
        .exec(),
      this.model.countDocuments(query).exec(),
    ]);
    return { rows: rows.map(out), total };
  }

  async find(id: string): Promise<StorySample | null> {
    const row = await this.model
      .findById(storedId(KIND, id))
      .lean<Stored | null>()
      .exec();
    return row && out(row);
  }

  async create(
    row: Omit<StorySample, 'created_at' | 'updated_at'>,
  ): Promise<StorySample> {
    const doc = await this.model.create(toStored(KIND, row));
    return out(doc.toObject<Stored>());
  }

  async update(
    id: string,
    set: Partial<StorySample>,
  ): Promise<StorySample | null> {
    const row = await this.model
      .findOneAndUpdate(
        { _id: storedId(KIND, id) },
        { $set: set },
        { returnDocument: 'after' },
      )
      .lean<Stored | null>()
      .exec();
    return row && out(row);
  }

  async remove(id: string): Promise<boolean> {
    return (
      (await this.model.deleteOne({ _id: storedId(KIND, id) }).exec())
        .deletedCount === 1
    );
  }
}
