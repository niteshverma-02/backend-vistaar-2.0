import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Types, mongo, type Connection } from 'mongoose';

import {
  PRODUCT_REVIEWS_COLLECTION,
  SUBMISSION_STATUSES,
  VISTAAR_SOURCE,
  escapeRegex,
  reviewIdOf,
  sharedFlagsOf,
  type SubmissionKind,
  type SubmissionStatus,
  type TestimonialType,
} from '../testimonials.domain';

/** A partner's testimonial as the service sees it, whichever field holds what. */
export interface SubmissionRow {
  /** The app's UUID. */
  _id: string;
  /** The partner (`VST-…`), from the token. */
  agent_id: string;
  /** Copy for the library's "Shared by"; the partner's name when sent. */
  partner_name: string | null;

  /** The farmer — one of the partner's own leads. */
  pii_id: string;
  farmer_name: string;
  /** `+91…`, as Stockship stores `user.contact`. */
  farmer_contact: string;
  village: string | null;
  district: string | null;
  state: string | null;

  type: TestimonialType;
  bulk: string | null;
  family: string | null;
  /** `bulk_v2.trade_name` / `combos_v2.name` when sent. */
  product_name: string | null;
  crop: string;

  kind: SubmissionKind;
  text: string;
  /** The partner's stars; Stockship's own `rating` holds them only once approved. */
  rating: number;
  /** Private object path; `null` for a quote. */
  media_path: string | null;
  /** The token URL product pages play — set on approval, gone on removal. */
  media_url: string | null;
  duration_sec: number | null;

  status: SubmissionStatus;
  reason: string | null;
  decided_by: string | null;
  decided_at: Date | null;
  approved_at: Date | null;

  /** `product_reviews._id` — the row this is, derived from `_id`. */
  review_id: Types.ObjectId;
  /** `product_testimonials._id`, reserved at submit; `null` for a quote. */
  testimonial_id: Types.ObjectId | null;

  /** Reserved for meeting gigs; nothing sets it yet. */
  gig_id: string | null;

  views: number;
  shares: number;

  created_at: Date;
  updated_at: Date;
}

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
  | 'review_id'
  | 'created_at'
  | 'updated_at'
>;

type Decision = Partial<
  Pick<
    SubmissionRow,
    | 'reason'
    | 'text'
    | 'media_path'
    | 'media_url'
    | 'decided_by'
    | 'decided_at'
    | 'approved_at'
  >
>;

/** A status move. Approving puts the stars on Stockship's `rating`, so it carries them. */
export type SubmissionChange = Decision &
  (
    | { status: 'approved'; rating: number }
    | { status: Exclude<SubmissionStatus, 'approved' | 'submitted'> }
  );

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

/** Ours, on Vistaar's review rows only: what Stockship's shape has no field for. */
type VistaarPart = Omit<
  SubmissionRow,
  | '_id'
  | 'pii_id'
  | 'farmer_name'
  | 'farmer_contact'
  | 'type'
  | 'bulk'
  | 'family'
  | 'text'
  | 'review_id'
  | 'created_at'
  | 'updated_at'
> & { id: string };

/** A `product_reviews` row in the shape Stockship's writers use, plus `vistaar`. */
interface SubmissionDoc {
  _id: Types.ObjectId;
  source: string;
  verified: boolean;
  deleted: boolean;
  verified_by: string | null;
  deleted_by: string | null;
  /** `null` until approved — Stockship's averages count every row not deleted. */
  rating: number | null;
  review: string;
  images: string[];
  pii_id: string | null;
  user: {
    contact: string | null;
    email: string | null;
    name: string | null;
    profile_image: string | null;
  };
  type: TestimonialType;
  bulk: string | null;
  family: string | null;
  created_at: Date;
  updated_at: Date;
  __v: number;
  vistaar: VistaarPart;
}

type Query = mongo.Filter<SubmissionDoc>;

/** Every partner testimonial; another app's review (or HO's) never matches. */
const BASE: Query = {
  source: VISTAAR_SOURCE,
  'vistaar.id': { $type: 'string' },
};

const byId = (id: string): Query => ({
  ...BASE,
  _id: new Types.ObjectId(reviewIdOf(id)),
});

/** The DTO's sort keys that live under `vistaar`. */
const SORT_PATHS: Record<string, string> = { shares: 'vistaar.shares' };

const isDuplicateKey = (error: unknown): boolean =>
  error instanceof mongo.MongoServerError && error.code === 11000;

/**
 * Partner testimonials, kept on Stockship's shared `product_reviews` through
 * the raw driver — no Mongoose model, so no schema or index is ever declared
 * on it from here (the indexes these reads want are in PROD-CHECKLIST). Every
 * read and write filters on `source: 'vistaar'` and a `vistaar` part.
 */
@Injectable()
export class SubmissionRepository {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  private get rows() {
    return this.connection.collection<SubmissionDoc>(
      PRODUCT_REVIEWS_COLLECTION,
    );
  }

  /** `false` when the id is taken — a retried submit, or someone else's. */
  async insert(row: NewSubmission): Promise<boolean> {
    try {
      await this.rows.insertOne(toDoc(row, new Date()));
      return true;
    } catch (error) {
      if (isDuplicateKey(error)) return false;
      throw error;
    }
  }

  async find(id: string): Promise<SubmissionRow | null> {
    return fromDoc(await this.rows.findOne(byId(id)));
  }

  /** Is this file already on one of the partner's testimonials? */
  async mediaTaken(agentId: string, path: string): Promise<boolean> {
    return (
      (await this.rows.countDocuments(
        { ...BASE, 'vistaar.agent_id': agentId, 'vistaar.media_path': path },
        { limit: 1 },
      )) > 0
    );
  }

  async findMine(agentId: string, id: string): Promise<SubmissionRow | null> {
    return fromDoc(
      await this.rows.findOne({ ...byId(id), 'vistaar.agent_id': agentId }),
    );
  }

  pageMine(
    agentId: string,
    status: SubmissionStatus | undefined,
    skip: number,
    limit: number,
  ): Promise<{ rows: SubmissionRow[]; total: number }> {
    const query: Query = { ...BASE, 'vistaar.agent_id': agentId };
    if (status) query['vistaar.status'] = status;
    return this.page(query, skip, limit, { created_at: -1 });
  }

  /** Approved ones from every partner. */
  library(
    filter: LibraryFilter,
    skip: number,
    limit: number,
    sort: 'shared' | 'newest',
  ): Promise<{ rows: SubmissionRow[]; total: number }> {
    const query: Query = { ...BASE, 'vistaar.status': 'approved' };
    if (filter.bulk) query.bulk = filter.bulk;
    if (filter.family) query.family = filter.family;
    if (filter.kind) query['vistaar.kind'] = filter.kind;
    // Exact values: the app's chips are built from the library's own rows.
    if (filter.crop) query['vistaar.crop'] = filter.crop;
    if (filter.state) query['vistaar.state'] = filter.state;
    if (filter.district) query['vistaar.district'] = filter.district;
    const q = filter.q?.trim();
    if (q) {
      const re = { $regex: escapeRegex(q), $options: 'i' };
      query.$or = [
        { 'user.name': re },
        { 'vistaar.village': re },
        { 'vistaar.district': re },
        { 'vistaar.product_name': re },
        { 'vistaar.crop': re },
        { review: re },
      ];
    }
    return this.page(
      query,
      skip,
      limit,
      sort === 'shared'
        ? { 'vistaar.shares': -1, created_at: -1 }
        : { created_at: -1, _id: -1 },
    );
  }

  adminPage(
    filter: AdminSubmissionFilter,
    skip: number,
    limit: number,
    sort: Record<string, 1 | -1>,
  ): Promise<{ rows: SubmissionRow[]; total: number }> {
    const query: Query = { ...BASE };
    if (filter.status) query['vistaar.status'] = filter.status;
    if (filter.kind) query['vistaar.kind'] = filter.kind;
    if (filter.agent_id) query['vistaar.agent_id'] = filter.agent_id;
    const q = filter.q?.trim();
    if (q) {
      const re = { $regex: escapeRegex(q), $options: 'i' };
      query.$or = [
        { 'user.name': re },
        { 'user.contact': re },
        { 'vistaar.partner_name': re },
        { 'vistaar.agent_id': re },
        { 'vistaar.village': re },
        { 'vistaar.product_name': re },
        { bulk: re },
        { 'vistaar.crop': re },
      ];
    }
    return this.page(
      query,
      skip,
      limit,
      Object.fromEntries(
        Object.entries(sort).map(([k, d]) => [SORT_PATHS[k] ?? k, d]),
      ),
    );
  }

  async counts(): Promise<Record<SubmissionStatus, number>> {
    const entries = await Promise.all(
      SUBMISSION_STATUSES.map(
        async (s) =>
          [
            s,
            await this.rows.countDocuments({ ...BASE, 'vistaar.status': s }),
          ] as const,
      ),
    );
    return Object.fromEntries(entries) as Record<SubmissionStatus, number>;
  }

  /**
   * The status move, only from a status it may start from — two HO users on
   * the same one cannot both win. Stockship's flags move with it in the same
   * write, so its lists and averages never disagree with ours. `null` when it
   * had moved on.
   */
  async transition(
    id: string,
    from: readonly SubmissionStatus[],
    change: SubmissionChange,
  ): Promise<SubmissionRow | null> {
    return fromDoc(
      await this.rows.findOneAndUpdate(
        { ...byId(id), 'vistaar.status': { $in: [...from] } },
        { $set: setOf(change) },
        { returnDocument: 'after' },
      ),
    );
  }

  /** One more view or share — counted only while it is in the library. */
  async bump(
    id: string,
    field: 'views' | 'shares',
  ): Promise<Pick<SubmissionRow, 'views' | 'shares'> | null> {
    const doc = await this.rows.findOneAndUpdate(
      { ...byId(id), 'vistaar.status': 'approved' },
      { $inc: { [`vistaar.${field}`]: 1 } },
      {
        returnDocument: 'after',
        projection: { _id: 0, 'vistaar.views': 1, 'vistaar.shares': 1 },
      },
    );
    return doc
      ? { views: doc.vistaar.views, shares: doc.vistaar.shares }
      : null;
  }

  /** Approved ones with words, newest first — the Farmer story template's picks. */
  async approvedQuotes(limit: number): Promise<SubmissionRow[]> {
    const docs = await this.rows
      .find({ ...BASE, 'vistaar.status': 'approved', review: { $ne: '' } })
      .sort({ created_at: -1 })
      .limit(limit)
      .toArray();
    return docs.map((d) => fromDoc(d)!);
  }

  private async page(
    query: Query,
    skip: number,
    limit: number,
    sort: Record<string, 1 | -1>,
  ): Promise<{ rows: SubmissionRow[]; total: number }> {
    const [docs, total] = await Promise.all([
      this.rows.find(query).sort(sort).skip(skip).limit(limit).toArray(),
      this.rows.countDocuments(query),
    ]);
    return { rows: docs.map((d) => fromDoc(d)!), total };
  }
}

function toDoc(row: NewSubmission, now: Date): SubmissionDoc {
  const {
    _id: id,
    pii_id,
    farmer_name,
    farmer_contact,
    type,
    bulk,
    family,
    text,
    ...ours
  } = row;
  return {
    _id: new Types.ObjectId(reviewIdOf(id)),
    source: VISTAAR_SOURCE,
    ...sharedFlagsOf('submitted'),
    verified_by: null,
    deleted_by: null,
    rating: null,
    review: text,
    images: [],
    pii_id,
    user: {
      contact: farmer_contact,
      email: null,
      name: farmer_name,
      profile_image: null,
    },
    type,
    bulk,
    family,
    created_at: now,
    updated_at: now,
    __v: 0,
    vistaar: {
      ...ours,
      id,
      status: 'submitted',
      reason: null,
      media_url: null,
      decided_by: null,
      decided_at: null,
      approved_at: null,
      views: 0,
      shares: 0,
    },
  };
}

function fromDoc(doc: SubmissionDoc | null): SubmissionRow | null {
  if (!doc) return null;
  const { id, ...ours } = doc.vistaar;
  return {
    ...ours,
    _id: id,
    pii_id: doc.pii_id ?? '',
    farmer_name: doc.user?.name ?? '',
    farmer_contact: doc.user?.contact ?? '',
    type: doc.type,
    bulk: doc.bulk,
    family: doc.family,
    text: doc.review ?? '',
    review_id: doc._id,
    created_at: doc.created_at,
    updated_at: doc.updated_at,
  };
}

/** Our fields under `vistaar`, the words on `review`, Stockship's flags from the status. */
function setOf(change: SubmissionChange): Record<string, unknown> {
  const { status, text, ...decision } = change;
  const approved = change.status === 'approved';
  const by = change.decided_by ?? null;
  const set: Record<string, unknown> = {
    ...sharedFlagsOf(status),
    rating: approved ? change.rating : null,
    ...(approved ? { verified_by: by, deleted_by: null } : { deleted_by: by }),
    'vistaar.status': status,
    updated_at: new Date(),
  };
  if (text !== undefined) set.review = text;
  for (const [key, value] of Object.entries(decision)) {
    if (key !== 'rating' && value !== undefined) set[`vistaar.${key}`] = value;
  }
  return set;
}
