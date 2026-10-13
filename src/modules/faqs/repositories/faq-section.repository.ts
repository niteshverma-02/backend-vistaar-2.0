import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, type QueryFilter } from 'mongoose';

import {
  FaqSection,
  type FaqSectionDocument,
} from '../schemas/faq-section.schema';

/** Far above any real section list; only a bound on a runaway read. */
const READ_CAP = 200;

@Injectable()
export class FaqSectionRepository {
  constructor(
    @InjectModel(FaqSection.name)
    private readonly model: Model<FaqSectionDocument>,
  ) {}

  /** HO's whole list is small enough to read at once; `is_active` absent = both. */
  list(isActive?: boolean): Promise<FaqSection[]> {
    const query: QueryFilter<FaqSection> = {};
    if (isActive !== undefined) query.is_active = isActive;
    return this.model
      .find(query)
      .sort({ order: 1, _id: 1 })
      .limit(READ_CAP)
      .lean<FaqSection[]>()
      .exec();
  }

  find(key: string): Promise<FaqSection | null> {
    return this.model.findById(key).lean<FaqSection | null>().exec();
  }

  async create(
    row: Omit<FaqSection, 'created_at' | 'updated_at'>,
  ): Promise<FaqSection> {
    const doc = await this.model.create(row);
    return doc.toObject<FaqSection>();
  }

  update(key: string, set: Partial<FaqSection>): Promise<FaqSection | null> {
    return this.model
      .findOneAndUpdate(
        { _id: key },
        { $set: set },
        { returnDocument: 'after' },
      )
      .lean<FaqSection | null>()
      .exec();
  }

  async remove(key: string): Promise<boolean> {
    return (await this.model.deleteOne({ _id: key }).exec()).deletedCount === 1;
  }
}
