import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, type PipelineStage, type QueryFilter } from 'mongoose';

import type {
  Attendee,
  MeetingCounts,
  MeetingStatus,
} from '../meetings.domain';
import { Meeting, type MeetingDocument } from '../schemas/meeting.schema';

export type MeetingBrief = Omit<Meeting, 'attendees'>;

export interface MeetingFilter {
  agent_id?: string;
  status?: MeetingStatus;
  from?: Date | null;
  to?: Date | null;
}

export interface MeetingTotals {
  meetings: number;
  by_status: Record<MeetingStatus, number>;
  partners: number;
  invited: number;
  present: number;
  leads: number;
}

const BRIEF = { attendees: 0 } as const;
const isDuplicateKey = (e: unknown) =>
  typeof e === 'object' &&
  e !== null &&
  (e as { code?: unknown }).code === 11000;

/** `$size` of the attendees with `field` true — counts recomputed in the same write. */
const countOf = (field: keyof Attendee) => ({
  $size: {
    $filter: { input: '$attendees', as: 'a', cond: `$$a.${field}` },
  },
});

@Injectable()
export class MeetingRepository {
  constructor(
    @InjectModel(Meeting.name) private readonly model: Model<MeetingDocument>,
  ) {}

  /** `null` when the id is taken — the caller decides if it is a retry. */
  async create(
    row: Omit<Meeting, 'created_at' | 'updated_at'>,
  ): Promise<Meeting | null> {
    try {
      const doc = await this.model.create(row);
      return doc.toObject<Meeting>();
    } catch (e) {
      if (isDuplicateKey(e)) return null;
      throw e;
    }
  }

  find(id: string): Promise<Meeting | null> {
    return this.model.findById(id).lean<Meeting | null>().exec();
  }

  async page(
    filter: MeetingFilter,
    skip: number,
    limit: number,
    sort: Record<string, 1 | -1>,
  ): Promise<{ rows: MeetingBrief[]; total: number }> {
    const query = queryOf(filter);
    const [rows, total] = await Promise.all([
      this.model
        .find(query)
        .select(BRIEF)
        .sort({ ...sort, _id: 1 })
        .skip(skip)
        .limit(limit)
        .lean<MeetingBrief[]>()
        .exec(),
      this.model.countDocuments(query).exec(),
    ]);
    return { rows, total };
  }

  /** A partner's scheduled meetings starting in `[from, until)`, soonest first. */
  scheduledBetween(
    agentId: string,
    from: Date,
    until: Date,
    cap = 50,
  ): Promise<MeetingBrief[]> {
    return this.model
      .find({
        agent_id: agentId,
        status: 'scheduled',
        starts_at: { $gte: from, $lt: until },
      })
      .select(BRIEF)
      .sort({ starts_at: 1 })
      .limit(cap)
      .lean<MeetingBrief[]>()
      .exec();
  }

  /** Only lands while the meeting is still scheduled (and `also` holds); `null` otherwise. */
  updateScheduled(
    id: string,
    agentId: string,
    set: Partial<Meeting>,
    also: QueryFilter<Meeting> = {},
  ): Promise<Meeting | null> {
    return this.model
      .findOneAndUpdate(
        { ...also, _id: id, agent_id: agentId, status: 'scheduled' },
        { $set: set },
        { returnDocument: 'after' },
      )
      .lean<Meeting | null>()
      .exec();
  }

  /**
   * The whole attendee list, only if nobody saved since the caller read it
   * (`updated_at`) and the meeting is not cancelled; `null` = changed meanwhile.
   */
  setAttendees(
    id: string,
    agentId: string,
    readAt: Date,
    attendees: Attendee[],
    counts: MeetingCounts,
  ): Promise<Meeting | null> {
    return this.model
      .findOneAndUpdate(
        {
          _id: id,
          agent_id: agentId,
          updated_at: readAt,
          status: { $ne: 'cancelled' },
        },
        { $set: { attendees, counts } },
        { returnDocument: 'after' },
      )
      .lean<Meeting | null>()
      .exec();
  }

  /** Marks one attendee captured as a lead and recounts, in one atomic write. */
  markCaptured(
    id: string,
    agentId: string,
    phone: string,
    piiId: string,
  ): Promise<Meeting | null> {
    const pipeline: PipelineStage[] = [
      {
        $set: {
          attendees: {
            $map: {
              input: '$attendees',
              as: 'a',
              in: {
                $cond: [
                  { $eq: ['$$a.phone', phone] },
                  {
                    $mergeObjects: [
                      '$$a',
                      { pii_id: piiId, present: true, lead_captured: true },
                    ],
                  },
                  '$$a',
                ],
              },
            },
          },
          updated_at: '$$NOW',
        },
      },
      {
        $set: {
          counts: {
            invited: countOf('invited'),
            present: countOf('present'),
            leads: countOf('lead_captured'),
          },
        },
      },
    ];
    return this.model
      .findOneAndUpdate(
        {
          _id: id,
          agent_id: agentId,
          status: { $ne: 'cancelled' },
          'attendees.phone': phone,
        },
        pipeline,
        { returnDocument: 'after', updatePipeline: true },
      )
      .lean<Meeting | null>()
      .exec();
  }

  /** Meetings in the window, by status, with the farmers they reached. */
  async totals(filter: MeetingFilter): Promise<MeetingTotals> {
    const [out] = await this.model
      .aggregate<{
        by_status: { _id: MeetingStatus; count: number }[];
        sums: {
          meetings: number;
          partners: string[];
          invited: number;
          present: number;
          leads: number;
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
                  meetings: { $sum: 1 },
                  partners: { $addToSet: '$agent_id' },
                  invited: { $sum: '$counts.invited' },
                  present: { $sum: '$counts.present' },
                  leads: { $sum: '$counts.leads' },
                },
              },
            ],
          },
        },
      ])
      .exec();
    const sums = out?.sums[0];
    const byStatus = { scheduled: 0, completed: 0, cancelled: 0 };
    for (const s of out?.by_status ?? []) byStatus[s._id] = s.count;
    return {
      meetings: sums?.meetings ?? 0,
      by_status: byStatus,
      partners: sums?.partners.length ?? 0,
      invited: sums?.invited ?? 0,
      present: sums?.present ?? 0,
      leads: sums?.leads ?? 0,
    };
  }
}

function queryOf(filter: MeetingFilter): QueryFilter<Meeting> {
  const query: QueryFilter<Meeting> = {};
  if (filter.agent_id) query.agent_id = filter.agent_id;
  if (filter.status) query.status = filter.status;
  if (filter.from || filter.to) {
    query.starts_at = {
      ...(filter.from && { $gte: filter.from }),
      ...(filter.to && { $lt: filter.to }),
    };
  }
  return query;
}
