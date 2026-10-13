import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import {
  StoryTemplateRow,
  type StoryTemplateDocument,
} from '../schemas/story-template.schema';
import { STORY_TEMPLATES } from '../stories.domain';

/** Far above any real card list; only a bound on a runaway read. */
const READ_CAP = 200;

@Injectable()
export class StoryTemplateRepository {
  constructor(
    @InjectModel(StoryTemplateRow.name)
    private readonly model: Model<StoryTemplateDocument>,
  ) {}

  all(): Promise<StoryTemplateRow[]> {
    return this.model
      .find()
      .sort({ suggested: -1, order: 1, _id: 1 })
      .limit(READ_CAP)
      .lean<StoryTemplateRow[]>()
      .exec();
  }

  find(key: string): Promise<StoryTemplateRow | null> {
    return this.model.findById(key).lean<StoryTemplateRow | null>().exec();
  }

  async create(
    row: Omit<StoryTemplateRow, 'created_at' | 'updated_at'>,
  ): Promise<StoryTemplateRow> {
    const doc = await this.model.create(row);
    return doc.toObject<StoryTemplateRow>();
  }

  /** Inserts only when missing — HO's edits are never overwritten. */
  async insertIfMissing(
    row: Omit<StoryTemplateRow, 'created_at' | 'updated_at'>,
  ): Promise<boolean> {
    const result = await this.model
      .updateOne({ _id: row._id }, { $setOnInsert: row }, { upsert: true })
      .exec();
    return result.upsertedCount === 1;
  }

  /** Built-in rows written before custom cards existed get their layout and flag. */
  async backfillBuiltins(): Promise<void> {
    await Promise.all(
      STORY_TEMPLATES.map((key) =>
        this.model
          .updateOne(
            { _id: key, base: { $exists: false } },
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

  update(
    key: string,
    set: Partial<StoryTemplateRow>,
  ): Promise<StoryTemplateRow | null> {
    return this.model
      .findOneAndUpdate(
        { _id: key },
        { $set: set },
        { returnDocument: 'after' },
      )
      .lean<StoryTemplateRow | null>()
      .exec();
  }

  async remove(key: string): Promise<boolean> {
    return (
      (await this.model.deleteOne({ _id: key, builtin: false }).exec())
        .deletedCount === 1
    );
  }

  countActive(): Promise<number> {
    return this.model.countDocuments({ is_active: true }).exec();
  }
}
