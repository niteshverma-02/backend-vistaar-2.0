import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model, type PipelineStage } from 'mongoose';

import {
  escapeRegex,
  type FollowUpStatus,
  type NpsBucket,
} from '../feedback.domain';
import { Feedback } from '../schemas/feedback.schema';

export type FeedbackRow = Feedback;
export type NewFeedback = Omit<Feedback, '_id' | 'created_at' | 'updated_at'>;

export interface FeedbackFilter {
  bucket?: NpsBucket;
  follow_up?: FollowUpStatus | 'overdue';
  agent_id?: string;
  start?: Date;
  end?: Date;
  q?: string;
}

/** What one aggregation over a date range answers for the desk's summary. */
export interface FeedbackStats {
  buckets: { _id: NpsBucket; count: number }[];
  ratings: { _id: number; count: number }[];
  reasons: { _id: { bucket: NpsBucket; reason: string }; count: number }[];
}

/** A reason list is short; this only bounds a runaway summary. */
const TOP_REASONS = 60;

@Injectable()
export class FeedbackRepository {
  constructor(
    @InjectModel(Feedback.name) private readonly model: Model<Feedback>,
  ) {}

  async create(row: NewFeedback): Promise<FeedbackRow> {
    const doc = await this.model.create(row);
    return doc.toObject<FeedbackRow>();
  }

  /** How many the partner sent since `since` — the daily cap, on `{agent_id, created_at}`. */
  countSince(agentId: string, since: Date): Promise<number> {
    return this.model
      .countDocuments({ agent_id: agentId, created_at: { $gte: since } })
      .exec();
  }

  async page(
    filter: FeedbackFilter,
    skip: number,
    limit: number,
    sort: Record<string, 1 | -1>,
  ): Promise<{ rows: FeedbackRow[]; total: number }> {
    const query = queryOf(filter);
    const [rows, total] = await Promise.all([
      this.model
        .find(query)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean<FeedbackRow[]>()
        .exec(),
      this.model.countDocuments(query).exec(),
    ]);
    return { rows, total };
  }

  find(id: string): Promise<FeedbackRow | null> {
    return this.model
      .findById(new Types.ObjectId(id))
      .lean<FeedbackRow>()
      .exec();
  }

  /** Closes or reopens a detractor's call-back; `null` when there is no such call-back. */
  setFollowUp(
    id: string,
    set: {
      status: FollowUpStatus;
      note: string | null;
      done_by: string | null;
      done_at: Date | null;
    },
  ): Promise<FeedbackRow | null> {
    return this.model
      .findOneAndUpdate(
        { _id: new Types.ObjectId(id), follow_up: { $ne: null } },
        {
          $set: {
            'follow_up.status': set.status,
            'follow_up.note': set.note,
            'follow_up.done_by': set.done_by,
            'follow_up.done_at': set.done_at,
          },
        },
        { returnDocument: 'after' },
      )
      .lean<FeedbackRow>()
      .exec();
  }

  async stats(start: Date, end: Date): Promise<FeedbackStats> {
    const pipeline: PipelineStage[] = [
      { $match: { created_at: { $gte: start, $lt: end } } },
      {
        $facet: {
          buckets: [{ $group: { _id: '$bucket', count: { $sum: 1 } } }],
          ratings: [
            { $match: { rating: { $gte: 1 } } },
            { $group: { _id: '$rating', count: { $sum: 1 } } },
          ],
          reasons: [
            { $unwind: '$reasons' },
            {
              $group: {
                _id: { bucket: '$bucket', reason: '$reasons' },
                count: { $sum: 1 },
              },
            },
            { $sort: { count: -1 } },
            { $limit: TOP_REASONS },
          ],
        },
      },
    ];
    const [stats] = await this.model.aggregate<FeedbackStats>(pipeline).exec();
    return stats ?? { buckets: [], ratings: [], reasons: [] };
  }

  /** Open call-backs: all of them, and those past due at `now`. */
  async followUpCounts(now: Date): Promise<{ open: number; overdue: number }> {
    const [open, overdue] = await Promise.all([
      this.model.countDocuments({ 'follow_up.status': 'open' }).exec(),
      this.model
        .countDocuments({
          'follow_up.status': 'open',
          'follow_up.due_at': { $lt: now },
        })
        .exec(),
    ]);
    return { open, overdue };
  }
}

function queryOf(filter: FeedbackFilter): Record<string, unknown> {
  const query: Record<string, unknown> = {};
  if (filter.bucket) query.bucket = filter.bucket;
  if (filter.agent_id) query.agent_id = filter.agent_id;
  if (filter.follow_up === 'overdue') {
    query['follow_up.status'] = 'open';
    query['follow_up.due_at'] = { $lt: new Date() };
  } else if (filter.follow_up) {
    query['follow_up.status'] = filter.follow_up;
  }
  if (filter.start || filter.end) {
    query.created_at = {
      ...(filter.start ? { $gte: filter.start } : {}),
      ...(filter.end ? { $lt: filter.end } : {}),
    };
  }
  const q = filter.q?.trim();
  if (q) {
    const re = { $regex: escapeRegex(q), $options: 'i' };
    query.$or = [
      { comment: re },
      { reasons: re },
      { 'partner.name': re },
      { 'partner.phone': re },
      { agent_id: re },
    ];
  }
  return query;
}
