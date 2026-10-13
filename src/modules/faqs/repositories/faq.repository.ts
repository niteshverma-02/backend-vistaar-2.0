import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, type QueryFilter } from 'mongoose';

import { Faq, type FaqDocument } from '../schemas/faq.schema';

/** Far above any real FAQ list; only a bound on a runaway read. */
const ACTIVE_READ_CAP = 500;

export interface FaqFilter {
  category?: string;
  is_active?: boolean;
}

@Injectable()
export class FaqRepository {
  constructor(
    @InjectModel(Faq.name) private readonly model: Model<FaqDocument>,
  ) {}

  listActive(): Promise<Faq[]> {
    return this.model
      .find({ is_active: true })
      .sort({ order: 1, created_at: 1, _id: 1 })
      .limit(ACTIVE_READ_CAP)
      .lean<Faq[]>()
      .exec();
  }

  async page(
    filter: FaqFilter,
    skip: number,
    limit: number,
    sort: Record<string, 1 | -1>,
  ): Promise<{ rows: Faq[]; total: number }> {
    const query: QueryFilter<Faq> = {};
    if (filter.category) query.category = filter.category;
    if (filter.is_active !== undefined) query.is_active = filter.is_active;
    const [rows, total] = await Promise.all([
      this.model
        .find(query)
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
    return (await this.model.exists({ category }).exec()) !== null;
  }

  find(id: string): Promise<Faq | null> {
    return this.model.findById(id).lean<Faq | null>().exec();
  }

  async create(row: Omit<Faq, 'created_at' | 'updated_at'>): Promise<Faq> {
    const doc = await this.model.create(row);
    return doc.toObject<Faq>();
  }

  update(id: string, set: Partial<Faq>): Promise<Faq | null> {
    return this.model
      .findOneAndUpdate({ _id: id }, { $set: set }, { returnDocument: 'after' })
      .lean<Faq | null>()
      .exec();
  }

  async remove(id: string): Promise<boolean> {
    return (await this.model.deleteOne({ _id: id }).exec()).deletedCount === 1;
  }
}
