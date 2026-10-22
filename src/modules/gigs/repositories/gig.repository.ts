import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, type QueryFilter, type UpdateQuery } from 'mongoose';

import { escapeRegex } from '@common/utils/regex.util';

import type { GigStatus } from '../gigs.domain';
import { Gig, type GigDocument } from '../schemas/gig.schema';

export interface GigFilter {
  status?: GigStatus | readonly GigStatus[];
  agent_id?: string;
  state?: string;
  district?: string;
  from?: Date | null;
  to?: Date | null;
}

export interface GigTotals {
  by_status: Record<GigStatus, number>;
  partners: number;
  /** Σ payout of approved gigs. */
  approved_payout: number;
  farmers: number;
}

/** Far above any real calendar; only a bound on a runaway read. */
const OPEN_READ_CAP = 500;
/** Every field but the proof lists; their sizes instead, so lists show counts. */
const LIST = {
  ...Object.fromEntries(
    [
      'title',
      'village',
      'district',
      'state',
      'pincode',
      'venue',
      'venue_point',
      'starts_at',
      'ends_at',
      'expected_farmers',
      'min_farmers',
      'photos_required',
      'payout',
      'products',
      'requirements',
      'cohorts',
      'earning_cohorts',
      'status',
      'agent_id',
      'accepted_at',
      'assigned_by',
      'check_in',
      'submitted_at',
      'reviewed_by',
      'reviewed_at',
      'reject_reason',
      'cancelled_by',
      'cancel_reason',
      'posted_by',
      'updated_by',
      'created_at',
      'updated_at',
    ].map((f) => [f, 1]),
  ),
  attendees_count: { $size: '$attendees' },
  photos_count: { $size: '$photos' },
};

/** A list row: the gig without its proof lists, with their sizes. */
export type GigListRow = Gig & {
  attendees_count?: number;
  photos_count?: number;
};

@Injectable()
export class GigRepository {
  constructor(
    @InjectModel(Gig.name) private readonly model: Model<GigDocument>,
  ) {}

  async create(row: Omit<Gig, 'created_at' | 'updated_at'>): Promise<Gig> {
    const doc = await this.model.create(row);
    return doc.toObject<Gig>();
  }

  find(id: string): Promise<Gig | null> {
    return this.model.findById(id).lean<Gig | null>().exec();
  }

  /** Open gigs starting from `since`, soonest first — every partner's Available tab is cut from it. */
  openFrom(since: Date): Promise<Gig[]> {
    return this.model
      .find({ status: 'open', starts_at: { $gte: since } })
      .select(LIST)
      .sort({ starts_at: 1, _id: 1 })
      .limit(OPEN_READ_CAP)
      .lean<Gig[]>()
      .exec();
  }

  async page(
    filter: GigFilter,
    skip: number,
    limit: number,
    sort: Record<string, 1 | -1>,
  ): Promise<{ rows: Gig[]; total: number }> {
    const query = queryOf(filter);
    const [rows, total] = await Promise.all([
      this.model
        .find(query)
        .select(LIST)
        // The tie-break runs the same way as the sort, so one index serves both.
        .sort({ ...sort, _id: sort.starts_at ?? 1 })
        .skip(skip)
        .limit(limit)
        .lean<Gig[]>()
        .exec(),
      this.model.countDocuments(query).exec(),
    ]);
    return { rows, total };
  }

  /** A partner's gigs in `statuses` starting in `[from, until)`, soonest first. */
  forAgentBetween(
    agentId: string,
    statuses: readonly GigStatus[],
    from: Date | null,
    until: Date | null,
    cap = 200,
  ): Promise<Gig[]> {
    return this.model
      .find(queryOf({ agent_id: agentId, status: statuses, from, to: until }))
      .select(LIST)
      .sort({ starts_at: 1 })
      .limit(cap)
      .lean<Gig[]>()
      .exec();
  }

  /**
   * Moves a gig only if it is still as the caller saw it (`when`); `null` =
   * someone else moved it first. Every state change goes through here.
   */
  transition(
    id: string,
    when: QueryFilter<Gig>,
    update: UpdateQuery<Gig>,
  ): Promise<Gig | null> {
    return this.model
      .findOneAndUpdate({ ...when, _id: id }, update, {
        returnDocument: 'after',
      })
      .lean<Gig | null>()
      .exec();
  }

  /** Deletes only a gig nobody ever took; `false` otherwise. */
  async removeUntaken(id: string): Promise<boolean> {
    const out = await this.model
      .deleteOne({
        _id: id,
        status: 'open',
        agent_id: null,
        releases: { $size: 0 },
      })
      .exec();
    return out.deletedCount === 1;
  }

  /** Other gigs of the partner on that IST day that they still hold. */
  heldBetween(
    agentId: string,
    from: Date,
    to: Date,
    exceptId: string,
  ): Promise<number> {
    return this.model
      .countDocuments({
        _id: { $ne: exceptId },
        agent_id: agentId,
        status: { $in: ['accepted', 'checked_in'] },
        starts_at: { $gte: from, $lt: to },
      })
      .exec();
  }

  /** Approved gigs of a partner, oldest approval first — their gig earnings. */
  approvedFor(
    agentId: string,
  ): Promise<Pick<Gig, '_id' | 'payout' | 'reviewed_at' | 'title'>[]> {
    return this.model
      .find({ agent_id: agentId, status: 'approved' })
      .select({ _id: 1, payout: 1, reviewed_at: 1, title: 1 })
      .sort({ reviewed_at: 1, _id: 1 })
      .lean<Pick<Gig, '_id' | 'payout' | 'reviewed_at' | 'title'>[]>()
      .exec();
  }

  /** A partner's approved gigs held in `[from, to)`: how many, their pay, farmers present. */
  async approvedStats(
    agentId: string,
    from: Date,
    to: Date,
  ): Promise<{ done: number; earnings: number; farmers: number }> {
    const [out] = await this.model
      .aggregate<{ done: number; earnings: number; farmers: number }>([
        {
          $match: {
            agent_id: agentId,
            status: 'approved',
            starts_at: { $gte: from, $lt: to },
          },
        },
        {
          $group: {
            _id: null,
            done: { $sum: 1 },
            earnings: { $sum: '$payout' },
            farmers: { $sum: { $size: '$attendees' } },
          },
        },
      ])
      .exec();
    return {
      done: out?.done ?? 0,
      earnings: out?.earnings ?? 0,
      farmers: out?.farmers ?? 0,
    };
  }

  /** Where these phones were seen at other gigs since `since`. */
  async seenElsewhere(
    phones: readonly string[],
    since: Date,
    exceptId: string,
  ): Promise<
    {
      phone: string;
      gig_id: string;
      agent_id: string | null;
      starts_at: Date;
    }[]
  > {
    if (phones.length === 0) return [];
    return this.model
      .aggregate<{
        phone: string;
        gig_id: string;
        agent_id: string | null;
        starts_at: Date;
      }>([
        {
          $match: {
            _id: { $ne: exceptId },
            'attendees.phone': { $in: phones },
            starts_at: { $gte: since },
          },
        },
        { $unwind: '$attendees' },
        { $match: { 'attendees.phone': { $in: phones } } },
        {
          $project: {
            _id: 0,
            phone: '$attendees.phone',
            gig_id: '$_id',
            agent_id: 1,
            starts_at: 1,
          },
        },
        { $limit: 500 },
      ])
      .exec();
  }

  async totals(filter: GigFilter): Promise<GigTotals> {
    const [out] = await this.model
      .aggregate<{
        by_status: { _id: GigStatus; count: number }[];
        sums: {
          partners: (string | null)[];
          approved_payout: number;
          farmers: number;
        }[];
      }>([
        { $match: queryOf(filter) },
        {
          $facet: {
            by_status: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
            sums: [
              {
                $group: {
                  _id: null,
                  partners: { $addToSet: '$agent_id' },
                  approved_payout: {
                    $sum: {
                      $cond: [{ $eq: ['$status', 'approved'] }, '$payout', 0],
                    },
                  },
                  farmers: { $sum: { $size: '$attendees' } },
                },
              },
            ],
          },
        },
      ])
      .exec();
    const by_status = Object.fromEntries(
      [
        'open',
        'accepted',
        'checked_in',
        'submitted',
        'approved',
        'rejected',
        'cancelled',
      ].map((s) => [s, 0]),
    ) as Record<GigStatus, number>;
    for (const s of out?.by_status ?? []) by_status[s._id] = s.count;
    const sums = out?.sums[0];
    return {
      by_status,
      partners: (sums?.partners ?? []).filter((p) => p !== null).length,
      approved_payout: sums?.approved_payout ?? 0,
      farmers: sums?.farmers ?? 0,
    };
  }
}

function queryOf(filter: GigFilter): QueryFilter<Gig> {
  const query: QueryFilter<Gig> = {};
  if (filter.status) {
    query.status =
      typeof filter.status === 'string'
        ? filter.status
        : { $in: [...filter.status] };
  }
  if (filter.agent_id) query.agent_id = filter.agent_id;
  if (filter.state) query.state = filter.state;
  if (filter.district) {
    query.district = {
      $regex: `^${escapeRegex(filter.district)}$`,
      $options: 'i',
    };
  }
  if (filter.from || filter.to) {
    query.starts_at = {
      ...(filter.from && { $gte: filter.from }),
      ...(filter.to && { $lt: filter.to }),
    };
  }
  return query;
}
