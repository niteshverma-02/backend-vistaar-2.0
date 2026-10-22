import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, type QueryFilter } from 'mongoose';

import type { FestivalStatus } from '../stories.domain';
import { StoryFestival } from '../schemas/story-festival.schema';
import {
  fromStored,
  storedId,
  toStored,
  type StoredContent,
} from './story-content.mapping';

/** Far above any real festival list; only a bound on a runaway read. */
const ACTIVE_READ_CAP = 200;

const KIND = 'festival';

type Stored = StoredContent<StoryFestival>;

const out = (row: Stored): StoryFestival => fromStored(KIND, row);

/** The `festival` rows of `vistaar_v2_story_content`; the model adds `kind` to every query. */
@Injectable()
export class StoryFestivalRepository {
  constructor(
    @InjectModel(StoryFestival.name)
    private readonly model: Model<Stored>,
  ) {}

  /** Active and not ended — scheduled ones included, so a cached copy goes live on time. */
  async listActive(now: Date): Promise<StoryFestival[]> {
    const rows = await this.model
      .find({
        is_active: true,
        $or: [{ ends_at: null }, { ends_at: { $gt: now } }],
      })
      .sort({ order: 1, created_at: -1 })
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
  ): Promise<{ rows: StoryFestival[]; total: number }> {
    const query = queryOf(status, now);
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

  async find(id: string): Promise<StoryFestival | null> {
    const row = await this.model
      .findById(storedId(KIND, id))
      .lean<Stored | null>()
      .exec();
    return row && out(row);
  }

  async create(
    row: Omit<StoryFestival, 'created_at' | 'updated_at'>,
  ): Promise<StoryFestival> {
    const doc = await this.model.create(toStored(KIND, row));
    return out(doc.toObject<Stored>());
  }

  async update(
    id: string,
    set: Partial<StoryFestival>,
  ): Promise<StoryFestival | null> {
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

/** The Mongo side of `festivalStatus` — keep the two in step. */
function queryOf(
  status: FestivalStatus | undefined,
  now: Date,
): QueryFilter<Stored> {
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
