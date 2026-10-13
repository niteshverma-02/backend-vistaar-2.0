import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, mongo, type PipelineStage, type UpdateQuery } from 'mongoose';

import { CLOSED_STAGES, type LeadStage } from '../leads.domain';
import {
  VistaarLead,
  type VistaarLeadDocument,
} from '../schemas/vistaar-lead.schema';

export type VistaarLeadRecord = VistaarLead;

/** A list row: the record without its history. */
export type VistaarLeadBrief = Omit<
  VistaarLead,
  'activities' | 'stage_history' | 'holder_history'
>;

export interface LeadListFilter {
  agent_id?: string;
  stage?: LeadStage;
  /** Open leads with a follow-up at or before this moment (due today, overdue). */
  due_before?: Date;
  state?: string;
  origin?: 'created' | 'linked';
  from?: Date;
  to?: Date;
  /** Contained in the name, village or a crop. */
  text?: string;
  /** Digits contained in the mobile. */
  phone?: string;
}

const BRIEF = { activities: 0, stage_history: 0, holder_history: 0 } as const;

const escapeRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const isDuplicateKey = (error: unknown): boolean =>
  error instanceof mongo.MongoServerError && error.code === 11000;

@Injectable()
export class VistaarLeadsRepository {
  constructor(
    @InjectModel(VistaarLead.name)
    private readonly model: Model<VistaarLeadDocument>,
  ) {}

  findByPii(piiId: string): Promise<VistaarLeadRecord | null> {
    return this.model
      .findOne({ pii_id: piiId })
      .lean<VistaarLeadRecord | null>()
      .exec();
  }

  /** Rides the unique `{pii_id}` index; reads no more than the `_id`. */
  async isHeldBy(piiId: string, agentId: string): Promise<boolean> {
    const row = await this.model
      .exists({ pii_id: piiId, agent_id: agentId })
      .exec();
    return row !== null;
  }

  /** `false` when the farmer already has a row — the unique `pii_id` decides a race. */
  async insert(
    row: Omit<VistaarLead, 'created_at' | 'updated_at'>,
  ): Promise<boolean> {
    try {
      await this.model.create(row);
      return true;
    } catch (error) {
      if (isDuplicateKey(error)) return false;
      throw error;
    }
  }

  /**
   * The partner's own row, changed only if it still holds `expect` (the
   * stage the caller decided from); `null` = not theirs, or it moved meanwhile.
   */
  update(
    piiId: string,
    agentId: string,
    update: UpdateQuery<VistaarLeadDocument>,
    expect: { stage?: LeadStage } = {},
  ): Promise<VistaarLeadRecord | null> {
    return this.model
      .findOneAndUpdate(
        { pii_id: piiId, agent_id: agentId, ...expect },
        update,
        { returnDocument: 'after' },
      )
      .lean<VistaarLeadRecord | null>()
      .exec();
  }

  /**
   * Moves the farmer to another partner, only if the row is exactly as the
   * caller read it — any write since (the holder's work, an order, another
   * takeover) renews or ends the hold, so `null` = it changed meanwhile.
   */
  takeOver(
    piiId: string,
    from: { agent_id: string; updated_at: Date },
    update: UpdateQuery<VistaarLeadDocument>,
  ): Promise<VistaarLeadRecord | null> {
    return this.model
      .findOneAndUpdate(
        {
          pii_id: piiId,
          agent_id: from.agent_id,
          updated_at: from.updated_at,
        },
        update,
        { returnDocument: 'after' },
      )
      .lean<VistaarLeadRecord | null>()
      .exec();
  }

  /**
   * The partner's list in the app's order (Leads.tsx `byUrgency`): open leads
   * first — overdue, then with a follow-up, then without — closed last; within
   * each, the soonest follow-up (else the oldest lead) first.
   */
  async listByUrgency(
    filter: LeadListFilter,
    page: { skip: number; limit: number },
    now: Date,
  ): Promise<{ items: VistaarLeadBrief[]; total: number }> {
    const pipeline: PipelineStage[] = [
      { $match: this.toQuery(filter) },
      {
        $addFields: {
          _rank: {
            $switch: {
              branches: [
                { case: { $in: ['$stage', CLOSED_STAGES] }, then: 3 },
                {
                  case: {
                    $and: [
                      { $ne: ['$next_follow_up', null] },
                      { $lt: ['$next_follow_up', now] },
                    ],
                  },
                  then: 0,
                },
                { case: { $ne: ['$next_follow_up', null] }, then: 1 },
              ],
              default: 2,
            },
          },
          _at: { $ifNull: ['$next_follow_up', '$created_at'] },
        },
      },
      { $sort: { _rank: 1, _at: 1, _id: 1 } },
      {
        $facet: {
          items: [
            { $skip: page.skip },
            { $limit: page.limit },
            { $project: { ...BRIEF, _rank: 0, _at: 0 } },
          ],
          total: [{ $count: 'n' }],
        },
      },
    ];
    const [out] = await this.model
      .aggregate<{ items: VistaarLeadBrief[]; total: { n: number }[] }>(
        pipeline,
      )
      .exec();
    return { items: out?.items ?? [], total: out?.total[0]?.n ?? 0 };
  }

  /** Newest first — the HO list. */
  async listRecent(
    filter: LeadListFilter,
    page: { skip: number; limit: number },
  ): Promise<{ items: VistaarLeadBrief[]; total: number }> {
    const query = this.toQuery(filter);
    const [items, total] = await Promise.all([
      this.model
        .find(query)
        .select(BRIEF)
        .sort({ created_at: -1, _id: 1 })
        .skip(page.skip)
        .limit(page.limit)
        .lean<VistaarLeadBrief[]>()
        .exec(),
      this.model.countDocuments(query).exec(),
    ]);
    return { items, total };
  }

  /** The app's three cards and the stage counts, in one pass over the partner's rows. */
  async partnerSummary(
    agentId: string,
    dueBefore: Date,
  ): Promise<{
    total: number;
    open: number;
    pipeline_value: number;
    won: number;
    lost: number;
    due: number;
    by_stage: { key: LeadStage; count: number }[];
  }> {
    const open = { $not: [{ $in: ['$stage', CLOSED_STAGES] }] };
    const [out] = await this.model
      .aggregate<{
        totals: {
          total: number;
          open: number;
          pipeline_value: number;
          won: number;
          lost: number;
          due: number;
        }[];
        by_stage: { _id: LeadStage; count: number }[];
      }>([
        { $match: { agent_id: agentId } },
        {
          $facet: {
            totals: [
              {
                $group: {
                  _id: null,
                  total: { $sum: 1 },
                  open: { $sum: { $cond: [open, 1, 0] } },
                  pipeline_value: {
                    $sum: {
                      $cond: [open, { $ifNull: ['$expected_value', 0] }, 0],
                    },
                  },
                  won: { $sum: { $cond: [{ $eq: ['$stage', 'won'] }, 1, 0] } },
                  lost: {
                    $sum: { $cond: [{ $eq: ['$stage', 'lost'] }, 1, 0] },
                  },
                  due: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            open,
                            { $ne: ['$next_follow_up', null] },
                            { $lte: ['$next_follow_up', dueBefore] },
                          ],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                },
              },
            ],
            by_stage: [{ $group: { _id: '$stage', count: { $sum: 1 } } }],
          },
        },
      ])
      .exec();
    const t = out?.totals[0];
    return {
      total: t?.total ?? 0,
      open: t?.open ?? 0,
      pipeline_value: t?.pipeline_value ?? 0,
      won: t?.won ?? 0,
      lost: t?.lost ?? 0,
      due: t?.due ?? 0,
      by_stage: (out?.by_stage ?? []).map((s) => ({
        key: s._id,
        count: s.count,
      })),
    };
  }

  /** The HO cards in one round trip. */
  async adminSummary(since: { today: Date; week: Date }): Promise<{
    total: number;
    today: number;
    last_7_days: number;
    partners: number;
    by_stage: { key: LeadStage; count: number }[];
    by_partner: { key: string; count: number }[];
  }> {
    const [out] = await this.model
      .aggregate<{
        total: { n: number }[];
        today: { n: number }[];
        week: { n: number }[];
        partners: { n: number }[];
        by_stage: { _id: LeadStage; count: number }[];
        by_partner: { _id: string; count: number }[];
      }>([
        {
          $facet: {
            total: [{ $count: 'n' }],
            today: [
              { $match: { created_at: { $gte: since.today } } },
              { $count: 'n' },
            ],
            week: [
              { $match: { created_at: { $gte: since.week } } },
              { $count: 'n' },
            ],
            partners: [{ $group: { _id: '$agent_id' } }, { $count: 'n' }],
            by_stage: [{ $group: { _id: '$stage', count: { $sum: 1 } } }],
            by_partner: [
              { $group: { _id: '$agent_id', count: { $sum: 1 } } },
              { $sort: { count: -1 } },
              { $limit: 10 },
            ],
          },
        },
      ])
      .exec();
    const n = (rows?: { n: number }[]) => rows?.[0]?.n ?? 0;
    return {
      total: n(out?.total),
      today: n(out?.today),
      last_7_days: n(out?.week),
      partners: n(out?.partners),
      by_stage: (out?.by_stage ?? []).map((s) => ({
        key: s._id,
        count: s.count,
      })),
      by_partner: (out?.by_partner ?? []).map((p) => ({
        key: p._id,
        count: p.count,
      })),
    };
  }

  private toQuery(filter: LeadListFilter): Record<string, unknown> {
    const query: Record<string, unknown> = {};
    if (filter.agent_id) query.agent_id = filter.agent_id;
    if (filter.stage) query.stage = filter.stage;
    if (filter.state) query.state = filter.state;
    if (filter.origin) query.origin = filter.origin;
    if (filter.due_before) {
      query.stage = filter.stage ?? { $nin: CLOSED_STAGES };
      query.next_follow_up = { $ne: null, $lte: filter.due_before };
    }
    if (filter.from || filter.to) {
      query.created_at = {
        ...(filter.from && { $gte: filter.from }),
        ...(filter.to && { $lte: filter.to }),
      };
    }
    if (filter.phone) {
      query.phone =
        filter.phone.length === 10
          ? filter.phone
          : { $regex: escapeRegex(filter.phone) };
    }
    if (filter.text) {
      const like = new RegExp(escapeRegex(filter.text), 'i');
      query.$or = [{ name: like }, { village: like }, { crops: like }];
    }
    return query;
  }
}
