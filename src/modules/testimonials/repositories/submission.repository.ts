import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, mongo, type QueryFilter, type Types } from 'mongoose';

import {
  TestimonialSubmission,
  type TestimonialSubmissionDocument,
} from '../schemas/testimonial-submission.schema';
import {
  SUBMISSION_STATUSES,
  escapeRegex,
  type SubmissionKind,
  type SubmissionStatus,
} from '../testimonials.domain';

export type SubmissionRow = TestimonialSubmission;

export type NewSubmission = Omit<
  SubmissionRow,
  | 'status'
  | 'reason'
  | 'decided_by'
  | 'decided_at'
  | 'approved_at'
  | 'media_url'
  | 'views'
  | 'shares'
  | 'created_at'
  | 'updated_at'
>;

export interface LibraryFilter {
  q?: string;
  bulk?: string;
  family?: string;
  crop?: string;
  kind?: SubmissionKind;
  state?: string;
  district?: string;
}

export interface AdminSubmissionFilter {
  status?: SubmissionStatus;
  kind?: SubmissionKind;
  agent_id?: string;
  q?: string;
}

const isDuplicateKey = (error: unknown): boolean =>
  error instanceof mongo.MongoServerError && error.code === 11000;

@Injectable()
export class SubmissionRepository {
  constructor(
    @InjectModel(TestimonialSubmission.name)
    private readonly model: Model<TestimonialSubmissionDocument>,
  ) {}

  /** `false` when the id is taken — a retried submit, or someone else's. */
  async insert(row: NewSubmission): Promise<boolean> {
    try {
      await this.model.create(row);
      return true;
    } catch (error) {
      if (isDuplicateKey(error)) return false;
      throw error;
    }
  }

  find(id: string): Promise<SubmissionRow | null> {
    return this.model.findById(id).lean<SubmissionRow | null>().exec();
  }

  findMine(agentId: string, id: string): Promise<SubmissionRow | null> {
    return this.model
      .findOne({ _id: id, agent_id: agentId })
      .lean<SubmissionRow | null>()
      .exec();
  }

  async pageMine(
    agentId: string,
    status: SubmissionStatus | undefined,
    skip: number,
    limit: number,
  ): Promise<{ rows: SubmissionRow[]; total: number }> {
    const query: QueryFilter<TestimonialSubmission> = { agent_id: agentId };
    if (status) query.status = status;
    return this.page(query, skip, limit, { created_at: -1 });
  }

  /** Approved ones from every partner. */
  library(
    filter: LibraryFilter,
    skip: number,
    limit: number,
    sort: 'shared' | 'newest',
  ): Promise<{ rows: SubmissionRow[]; total: number }> {
    const query: QueryFilter<TestimonialSubmission> = { status: 'approved' };
    if (filter.bulk) query.bulk = filter.bulk;
    if (filter.family) query.family = filter.family;
    if (filter.kind) query.kind = filter.kind;
    // Exact values: the app's chips are built from the library's own rows,
    // and an exact match is what the indexes can serve.
    if (filter.crop) query.crop = filter.crop;
    if (filter.state) query.state = filter.state;
    if (filter.district) query.district = filter.district;
    const q = filter.q?.trim();
    if (q) {
      const re = { $regex: escapeRegex(q), $options: 'i' };
      query.$or = [
        { farmer_name: re },
        { village: re },
        { district: re },
        { product_name: re },
        { crop: re },
        { text: re },
      ];
    }
    return this.page(
      query,
      skip,
      limit,
      sort === 'shared'
        ? { shares: -1, created_at: -1 }
        : { created_at: -1, _id: 1 },
    );
  }

  adminPage(
    filter: AdminSubmissionFilter,
    skip: number,
    limit: number,
    sort: Record<string, 1 | -1>,
  ): Promise<{ rows: SubmissionRow[]; total: number }> {
    const query: QueryFilter<TestimonialSubmission> = {};
    if (filter.status) query.status = filter.status;
    if (filter.kind) query.kind = filter.kind;
    if (filter.agent_id) query.agent_id = filter.agent_id;
    const q = filter.q?.trim();
    if (q) {
      const re = { $regex: escapeRegex(q), $options: 'i' };
      query.$or = [
        { farmer_name: re },
        { farmer_contact: re },
        { partner_name: re },
        { agent_id: re },
        { village: re },
        { product_name: re },
        { bulk: re },
        { crop: re },
      ];
    }
    return this.page(query, skip, limit, sort);
  }

  async counts(): Promise<Record<SubmissionStatus, number>> {
    const entries = await Promise.all(
      SUBMISSION_STATUSES.map(
        async (s) =>
          [s, await this.model.countDocuments({ status: s }).exec()] as const,
      ),
    );
    return Object.fromEntries(entries) as Record<SubmissionStatus, number>;
  }

  /**
   * The status move, only from a status it may start from — two HO users on
   * the same one cannot both win. `null` when it had moved on.
   */
  transition(
    id: string,
    from: readonly SubmissionStatus[],
    set: Partial<SubmissionRow>,
  ): Promise<SubmissionRow | null> {
    return this.model
      .findOneAndUpdate(
        { _id: id, status: { $in: from } },
        { $set: set },
        { returnDocument: 'after' },
      )
      .lean<SubmissionRow | null>()
      .exec();
  }

  /** One more view or share — counted only while it is in the library. */
  bump(
    id: string,
    field: 'views' | 'shares',
  ): Promise<Pick<SubmissionRow, 'views' | 'shares'> | null> {
    return this.model
      .findOneAndUpdate(
        { _id: id, status: 'approved' },
        { $inc: { [field]: 1 } },
        {
          returnDocument: 'after',
          projection: { _id: 0, views: 1, shares: 1 },
          timestamps: false,
        },
      )
      .lean<Pick<SubmissionRow, 'views' | 'shares'> | null>()
      .exec();
  }

  /** Which of these `product_testimonials` ids a partner sent in. */
  async linkedTestimonials(
    ids: readonly Types.ObjectId[],
  ): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.model
      .find({ testimonial_id: { $in: ids } }, { _id: 0, testimonial_id: 1 })
      .lean<{ testimonial_id: Types.ObjectId }[]>()
      .exec();
    return new Set(rows.map((r) => r.testimonial_id.toHexString()));
  }

  /** Approved ones with words, newest first — the Farmer story template's picks. */
  approvedQuotes(limit: number): Promise<SubmissionRow[]> {
    return this.model
      .find({ status: 'approved', text: { $ne: '' } })
      .sort({ created_at: -1 })
      .limit(limit)
      .lean<SubmissionRow[]>()
      .exec();
  }

  private async page(
    query: QueryFilter<TestimonialSubmission>,
    skip: number,
    limit: number,
    sort: Record<string, 1 | -1>,
  ): Promise<{ rows: SubmissionRow[]; total: number }> {
    const [rows, total] = await Promise.all([
      this.model
        .find(query)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean<SubmissionRow[]>()
        .exec(),
      this.model.countDocuments(query).exec(),
    ]);
    return { rows, total };
  }
}
