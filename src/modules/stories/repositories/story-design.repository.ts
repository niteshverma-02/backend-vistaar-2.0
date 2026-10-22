import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, type QueryFilter } from 'mongoose';

import { windowQuery } from '@common/utils/schedule-window.util';

import type { FestivalStatus } from '../stories.domain';
import { StoryDesign } from '../schemas/story-design.schema';
import {
  fromStored,
  storedId,
  toStored,
  type StoredContent,
} from './story-content.mapping';

/** Far above any real design list; only a bound on a runaway read. */
const ACTIVE_READ_CAP = 100;

const KIND = 'design';

type Stored = StoredContent<StoryDesign>;

const out = (row: Stored): StoryDesign => fromStored(KIND, row);

/** The `design` rows of `vistaar_v2_story_content`; the model adds `kind` to every query. */
@Injectable()
export class StoryDesignRepository {
  constructor(
    @InjectModel(StoryDesign.name)
    private readonly model: Model<Stored>,
  ) {}

  /** Active and not ended — scheduled ones included, so a cached copy goes live on time. */
  async listActive(now: Date): Promise<StoryDesign[]> {
    const rows = await this.model
      .find({
        is_active: true,
        $or: [{ ends_at: null }, { ends_at: { $gt: now } }],
      })
      .sort({ order: 1, created_at: 1 })
      .limit(ACTIVE_READ_CAP)
      .lean<Stored[]>()
      .exec();
    return rows.map(out);
  }

  async page(
    status: FestivalStatus | undefined,
    now: Date,
    skip: number,
    limit: number,
    sort: Record<string, 1 | -1>,
  ): Promise<{ rows: StoryDesign[]; total: number }> {
    const query: QueryFilter<Stored> = windowQuery(status, now);
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

  async findByKey(key: string): Promise<StoryDesign | null> {
    const row = await this.model.findOne({ key }).lean<Stored | null>().exec();
    return row && out(row);
  }

  async find(id: string): Promise<StoryDesign | null> {
    const row = await this.model
      .findById(storedId(KIND, id))
      .lean<Stored | null>()
      .exec();
    return row && out(row);
  }

  async create(
    row: Omit<StoryDesign, 'created_at' | 'updated_at'>,
  ): Promise<StoryDesign> {
    const doc = await this.model.create(toStored(KIND, row));
    return out(doc.toObject<Stored>());
  }

  async update(
    id: string,
    set: Partial<StoryDesign>,
  ): Promise<StoryDesign | null> {
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

  /** Designs still drawing this art (a copied design shares its file). */
  countByImage(path: string): Promise<number> {
    return this.model.countDocuments({ image_path: path }).exec();
  }
}
