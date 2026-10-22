import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, type QueryFilter } from 'mongoose';

import {
  type Faq,
  FaqEntry,
  type FaqEntryDocument,
  type FaqSection,
} from '../schemas/faq.schema';

/** Far above any real FAQ list; only a bound on a runaway read. */
const ACTIVE_READ_CAP = 500;
/** Far above any real section list; only a bound on a runaway read. */
const SECTION_READ_CAP = 200;

/** The API never showed `kind`; the rows stay as they were before the merge. */
const WITHOUT_KIND = { kind: 0 } as const;

export interface FaqFilter {
  category?: string;
  is_active?: boolean;
}

export interface ActiveEntries {
  sections: FaqSection[];
  faqs: Faq[];
}

@Injectable()
export class FaqRepository {
  constructor(
    @InjectModel(FaqEntry.name) private readonly model: Model<FaqEntryDocument>,
  ) {}

  /** Switched-on sections and FAQs, each in display order, in one round trip. */
  async listActive(): Promise<ActiveEntries> {
    const [active] = await this.model
      .aggregate<ActiveEntries>([
        { $match: { is_active: true } },
        {
          $facet: {
            sections: [
              { $match: { kind: 'section' } },
              { $sort: { order: 1, _id: 1 } },
              { $limit: SECTION_READ_CAP },
              { $project: WITHOUT_KIND },
            ],
            faqs: [
              { $match: { kind: 'faq' } },
              { $sort: { order: 1, created_at: 1, _id: 1 } },
              { $limit: ACTIVE_READ_CAP },
              { $project: WITHOUT_KIND },
            ],
          },
        },
      ])
      .exec();
    return active ?? { sections: [], faqs: [] };
  }

  async page(
    filter: FaqFilter,
    skip: number,
    limit: number,
    sort: Record<string, 1 | -1>,
  ): Promise<{ rows: Faq[]; total: number }> {
    const query: QueryFilter<FaqEntry> = { kind: 'faq' };
    if (filter.category) query.category = filter.category;
    if (filter.is_active !== undefined) query.is_active = filter.is_active;
    const [rows, total] = await Promise.all([
      this.model
        .find(query, WITHOUT_KIND)
        .sort({ ...sort, _id: 1 })
        .skip(skip)
        .limit(limit)
        .lean<Faq[]>()
        .exec(),
      this.model.countDocuments(query).exec(),
    ]);
    return { rows, total };
  }

  async inSection(category: string): Promise<boolean> {
    return (await this.model.exists({ kind: 'faq', category }).exec()) !== null;
  }

  find(id: string): Promise<Faq | null> {
    return this.model
      .findOne({ _id: id, kind: 'faq' }, WITHOUT_KIND)
      .lean<Faq | null>()
      .exec();
  }

  async create(row: Omit<Faq, 'created_at' | 'updated_at'>): Promise<Faq> {
    const doc = await this.model.create({ ...row, kind: 'faq' });
    const { kind: _kind, ...saved } = doc.toObject<FaqEntry>();
    return saved as Faq;
  }

  update(id: string, set: Partial<Faq>): Promise<Faq | null> {
    return this.model
      .findOneAndUpdate(
        { _id: id, kind: 'faq' },
        { $set: set },
        { returnDocument: 'after', projection: WITHOUT_KIND },
      )
      .lean<Faq | null>()
      .exec();
  }

  async remove(id: string): Promise<boolean> {
    return (
      (await this.model.deleteOne({ _id: id, kind: 'faq' }).exec())
        .deletedCount === 1
    );
  }
}
