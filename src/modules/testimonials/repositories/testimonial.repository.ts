import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Types, type Connection } from 'mongoose';

import {
  BULK_COLLECTION,
  COMBO_COLLECTION,
  TESTIMONIALS_COLLECTION,
  TESTIMONIAL_STATUSES,
  VISTAAR_SOURCE,
  escapeRegex,
  statusFilter,
  type MediaType,
  type TestimonialStatus,
  type TestimonialType,
} from '../testimonials.domain';

/** A row of Stockship's `product_testimonials`, as stored. */
export interface TestimonialRow {
  _id: Types.ObjectId;
  source: string;
  type: TestimonialType;
  bulk: string | null;
  family: string | null;
  verified: boolean;
  deleted: boolean;
  media: { media_type: MediaType; media_url: string };
  feedbacks: { contact: string; status: boolean; timestamp: Date }[];
  review: string;
  pii_id: string | null;
  user: { contact: string; name: string | null; profile_image: string | null };
  created_at: Date;
  updated_at: Date;
  /** Ours, not Stockship's: who in HO filed or last changed it. */
  created_by?: string;
  updated_by?: string;
}

export interface TestimonialFilter {
  status?: TestimonialStatus;
  type?: TestimonialType;
  media_type?: MediaType;
  q?: string;
}

/**
 * The shared collection through the raw driver — **no Mongoose model**, so
 * this service never declares a schema or builds an index on a collection
 * Stockship owns. Every read and write carries `source: 'vistaar'`: a row
 * from any other app is "not found" here, never editable.
 */
@Injectable()
export class TestimonialRepository {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  private get rows() {
    return this.connection.collection<TestimonialRow>(TESTIMONIALS_COLLECTION);
  }

  async page(
    filter: TestimonialFilter,
    skip: number,
    limit: number,
    sort: Record<string, 1 | -1>,
  ): Promise<{ rows: TestimonialRow[]; total: number }> {
    const query = queryOf(filter);
    const [rows, total] = await Promise.all([
      this.rows.find(query).sort(sort).skip(skip).limit(limit).toArray(),
      this.rows.countDocuments(query),
    ]);
    return { rows: rows, total };
  }

  /** One count per tray, for the desk's tabs. */
  async counts(): Promise<Record<TestimonialStatus, number>> {
    const entries = await Promise.all(
      TESTIMONIAL_STATUSES.map(
        async (s) =>
          [
            s,
            await this.rows.countDocuments({
              source: VISTAAR_SOURCE,
              ...statusFilter(s),
            }),
          ] as const,
      ),
    );
    return Object.fromEntries(entries) as Record<TestimonialStatus, number>;
  }

  async find(id: string): Promise<TestimonialRow | null> {
    return this.rows.findOne<TestimonialRow>(byId(id));
  }

  async create(row: Omit<TestimonialRow, '_id'>): Promise<TestimonialRow> {
    const doc = { ...row, _id: new Types.ObjectId() };
    await this.rows.insertOne(doc);
    return doc;
  }

  async update(
    id: string,
    set: Partial<TestimonialRow>,
  ): Promise<TestimonialRow | null> {
    return await this.rows.findOneAndUpdate(
      byId(id),
      { $set: { ...set, updated_at: new Date() } },
      { returnDocument: 'after' },
    );
  }

  async remove(id: string): Promise<boolean> {
    return (await this.rows.deleteOne(byId(id))).deletedCount === 1;
  }

  async productExists(bulk: string): Promise<boolean> {
    return (
      (await this.connection
        .collection(BULK_COLLECTION)
        .countDocuments({ sku: bulk }, { limit: 1 })) > 0
    );
  }

  /**
   * Approved ones with words in them, newest first — what My Story's
   * "Farmer story" template quotes. Bounded: it is a picker, not a feed.
   */
  async approvedWithReview(limit: number): Promise<TestimonialRow[]> {
    return this.rows
      .find({
        source: VISTAAR_SOURCE,
        ...statusFilter('approved'),
        review: { $type: 'string', $ne: '' },
      })
      .sort({ created_at: -1 })
      .limit(limit)
      .toArray();
  }

  /** `bulk_v2.trade_name` for each SKU found. */
  async tradeNames(skus: string[]): Promise<Map<string, string>> {
    if (skus.length === 0) return new Map();
    const rows = await this.connection
      .collection<{ sku: string; trade_name?: string }>(BULK_COLLECTION)
      .find(
        { sku: { $in: skus } },
        { projection: { _id: 0, sku: 1, trade_name: 1 } },
      )
      .toArray();
    return new Map(
      rows.filter((r) => r.trade_name).map((r) => [r.sku, r.trade_name!]),
    );
  }

  /** `combos_v2.family` is an array; a match on one element is enough. */
  async comboExists(family: string): Promise<boolean> {
    return (
      (await this.connection
        .collection(COMBO_COLLECTION)
        .countDocuments({ family }, { limit: 1 })) > 0
    );
  }
}

const byId = (id: string) => ({
  _id: new Types.ObjectId(id),
  source: VISTAAR_SOURCE,
});

function queryOf(filter: TestimonialFilter): Record<string, unknown> {
  const query: Record<string, unknown> = { source: VISTAAR_SOURCE };
  if (filter.status) Object.assign(query, statusFilter(filter.status));
  if (filter.type) query.type = filter.type;
  if (filter.media_type) query['media.media_type'] = filter.media_type;
  const q = filter.q?.trim();
  if (q) {
    const re = { $regex: escapeRegex(q), $options: 'i' };
    query.$or = [
      { review: re },
      { 'user.name': re },
      { 'user.contact': re },
      { bulk: re },
      { family: re },
    ];
  }
  return query;
}
