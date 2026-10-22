import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { StoryTemplateRow } from '../schemas/story-template.schema';
import { STORY_TEMPLATES } from '../stories.domain';
import {
  fromStored,
  storedId,
  toStored,
  type StoredContent,
} from './story-content.mapping';

/** Far above any real card list; only a bound on a runaway read. */
const READ_CAP = 200;

const KIND = 'template';

type Stored = StoredContent<StoryTemplateRow>;

const out = (row: Stored): StoryTemplateRow => fromStored(KIND, row);

/** The `template` rows of `vistaar_v2_story_content`; the model adds `kind` to every query. */
@Injectable()
export class StoryTemplateRepository {
  constructor(
    @InjectModel(StoryTemplateRow.name)
    private readonly model: Model<Stored>,
  ) {}

  async all(): Promise<StoryTemplateRow[]> {
    const rows = await this.model
      .find()
      .sort({ suggested: -1, order: 1, _id: 1 })
      .limit(READ_CAP)
      .lean<Stored[]>()
      .exec();
    return rows.map(out);
  }

  async find(key: string): Promise<StoryTemplateRow | null> {
    const row = await this.model
      .findById(storedId(KIND, key))
      .lean<Stored | null>()
      .exec();
    return row && out(row);
  }

  async create(
    row: Omit<StoryTemplateRow, 'created_at' | 'updated_at'>,
  ): Promise<StoryTemplateRow> {
    const doc = await this.model.create(toStored(KIND, row));
    return out(doc.toObject<Stored>());
  }

  /** Inserts only when missing — HO's edits are never overwritten. */
  async insertIfMissing(
    row: Omit<StoryTemplateRow, 'created_at' | 'updated_at'>,
  ): Promise<boolean> {
    const { _id, ...fields } = toStored(KIND, row);
    const result = await this.model
      .updateOne({ _id }, { $setOnInsert: fields }, { upsert: true })
      .exec();
    return result.upsertedCount === 1;
  }

  /** Built-in rows written before custom cards existed get their layout and flag. */
  async backfillBuiltins(): Promise<void> {
    await Promise.all(
      STORY_TEMPLATES.map((key) =>
        this.model
          .updateOne(
            { _id: storedId(KIND, key), base: { $exists: false } },
            {
              $set: {
                base: key,
                builtin: true,
                suggested: false,
                fields: {},
                starts_at: null,
                ends_at: null,
              },
            },
          )
          .exec(),
      ),
    );
  }

  async update(
    key: string,
    set: Partial<StoryTemplateRow>,
  ): Promise<StoryTemplateRow | null> {
    const row = await this.model
      .findOneAndUpdate(
        { _id: storedId(KIND, key) },
        { $set: set },
        { returnDocument: 'after' },
      )
      .lean<Stored | null>()
      .exec();
    return row && out(row);
  }

  async remove(key: string): Promise<boolean> {
    return (
      (
        await this.model
          .deleteOne({ _id: storedId(KIND, key), builtin: false })
          .exec()
      ).deletedCount === 1
    );
  }

  countActive(): Promise<number> {
    return this.model.countDocuments({ is_active: true }).exec();
  }
}
