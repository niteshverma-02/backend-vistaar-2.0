import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, mongo } from 'mongoose';

import {
  TestimonialConsent,
  type TestimonialConsentDocument,
} from '../schemas/testimonial-consent.schema';

export type ConsentRow = TestimonialConsent;

export type NewConsent = Omit<
  ConsentRow,
  | 'status'
  | 'withdrawn_at'
  | 'withdrawn_by'
  | 'withdrawn_reason'
  | 'created_at'
  | 'updated_at'
>;

const isDuplicateKey = (error: unknown): boolean =>
  error instanceof mongo.MongoServerError && error.code === 11000;

/** Insert and withdraw only — a consent is never edited or deleted. */
@Injectable()
export class ConsentRepository {
  constructor(
    @InjectModel(TestimonialConsent.name)
    private readonly model: Model<TestimonialConsentDocument>,
  ) {}

  /** A retried submit finds the first one there and keeps it. */
  async insert(row: NewConsent): Promise<void> {
    try {
      await this.model.create(row);
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
    }
  }

  find(id: string): Promise<ConsentRow | null> {
    return this.model.findById(id).lean<ConsentRow | null>().exec();
  }

  async findMany(ids: readonly string[]): Promise<Map<string, ConsentRow>> {
    if (ids.length === 0) return new Map();
    const rows = await this.model
      .find({ _id: { $in: ids } })
      .lean<ConsentRow[]>()
      .exec();
    return new Map(rows.map((r) => [r._id, r]));
  }

  /** `null` when it was already withdrawn (or never given). */
  withdraw(
    id: string,
    by: string,
    reason: string,
    at: Date,
  ): Promise<ConsentRow | null> {
    return this.model
      .findOneAndUpdate(
        { _id: id, status: 'given' },
        {
          $set: {
            status: 'withdrawn',
            withdrawn_at: at,
            withdrawn_by: by,
            withdrawn_reason: reason,
          },
        },
        { returnDocument: 'after' },
      )
      .lean<ConsentRow | null>()
      .exec();
  }
}
