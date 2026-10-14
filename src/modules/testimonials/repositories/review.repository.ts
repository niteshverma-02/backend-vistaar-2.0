import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection, Types } from 'mongoose';

import {
  PRODUCT_REVIEWS_COLLECTION,
  VISTAAR_SOURCE,
} from '../testimonials.domain';

/** A row of Stockship's `product_reviews`, in the shape its other writers use. */
export interface ReviewRow {
  _id: Types.ObjectId;
  source: string;
  verified: boolean;
  deleted: boolean;
  verified_by: string | null;
  deleted_by: string | null;
  rating: number;
  review: string;
  images: string[];
  pii_id: string | null;
  user: {
    contact: string | null;
    email: string | null;
    name: string | null;
    profile_image: string | null;
  };
  type: 'product' | 'combo';
  bulk: string | null;
  family: string | null;
  created_at: Date;
  updated_at: Date;
  __v: number;
}

/** What an approval decides; the flags and `*_by` are the approval's own. */
export type ReviewContent = Omit<
  ReviewRow,
  | '_id'
  | 'source'
  | 'verified'
  | 'deleted'
  | 'verified_by'
  | 'deleted_by'
  | 'created_at'
  | 'updated_at'
  | '__v'
>;

/**
 * Stockship's shared `product_reviews` through the raw driver — no Mongoose
 * model, so no schema or index is ever declared on it from here. Every write
 * filters on `source: 'vistaar'`, so another app's review is never touched.
 */
@Injectable()
export class ReviewRepository {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  private get rows() {
    return this.connection.collection<ReviewRow>(PRODUCT_REVIEWS_COLLECTION);
  }

  /**
   * Shown: written the first time, flipped back to shown after a removal. Keyed
   * by the id the submission reserved, so a retried approval writes one row.
   */
  async show(id: Types.ObjectId, content: ReviewContent, by: string) {
    const now = new Date();
    await this.rows.updateOne(
      { _id: id, source: VISTAAR_SOURCE },
      {
        $setOnInsert: {
          ...content,
          source: VISTAAR_SOURCE,
          created_at: now,
          __v: 0,
        },
        $set: {
          verified: true,
          deleted: false,
          verified_by: by,
          deleted_by: null,
          updated_at: now,
        },
      },
      { upsert: true },
    );
  }

  /** Hidden everywhere; a no-op when it was never written. */
  async hide(id: Types.ObjectId, by: string): Promise<void> {
    await this.rows.updateOne(
      { _id: id, source: VISTAAR_SOURCE },
      { $set: { deleted: true, deleted_by: by, updated_at: new Date() } },
    );
  }

  /** For good — a withdrawn consent leaves no copy of the farmer's words. */
  async erase(id: Types.ObjectId): Promise<void> {
    await this.rows.deleteOne({ _id: id, source: VISTAAR_SOURCE });
  }
}
