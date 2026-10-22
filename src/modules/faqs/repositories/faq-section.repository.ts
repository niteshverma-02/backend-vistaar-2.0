import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, type QueryFilter } from 'mongoose';

import {
  FaqEntry,
  type FaqEntryDocument,
  type FaqSection,
} from '../schemas/faq.schema';

/** Far above any real section list; only a bound on a runaway read. */
const READ_CAP = 200;

/** The API never showed `kind`; the rows stay as they were before the merge. */
const WITHOUT_KIND = { kind: 0 } as const;

@Injectable()
export class FaqSectionRepository {
  constructor(
    @InjectModel(FaqEntry.name)
    private readonly model: Model<FaqEntryDocument>,
  ) {}

  /** HO's whole list is small enough to read at once; `is_active` absent = both. */
  list(isActive?: boolean): Promise<FaqSection[]> {
    const query: QueryFilter<FaqEntry> = { kind: 'section' };
    if (isActive !== undefined) query.is_active = isActive;
    return this.model
      .find(query, WITHOUT_KIND)
      .sort({ order: 1, _id: 1 })
      .limit(READ_CAP)
      .lean<FaqSection[]>()
      .exec();
  }

  find(key: string): Promise<FaqSection | null> {
    return this.model
      .findOne({ _id: key, kind: 'section' }, WITHOUT_KIND)
      .lean<FaqSection | null>()
      .exec();
  }

  async create(
    row: Omit<FaqSection, 'created_at' | 'updated_at'>,
  ): Promise<FaqSection> {
    const doc = await this.model.create({ ...row, kind: 'section' });
    const { kind: _kind, ...saved } = doc.toObject<FaqEntry>();
    return saved as FaqSection;
  }

  update(key: string, set: Partial<FaqSection>): Promise<FaqSection | null> {
    return this.model
      .findOneAndUpdate(
        { _id: key, kind: 'section' },
        { $set: set },
        { returnDocument: 'after', projection: WITHOUT_KIND },
      )
      .lean<FaqSection | null>()
      .exec();
  }

  async remove(key: string): Promise<boolean> {
    return (
      (await this.model.deleteOne({ _id: key, kind: 'section' }).exec())
        .deletedCount === 1
    );
  }
}
