import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model, PipelineStage } from 'mongoose';

import type { ShareChannel, StoryTemplate } from '../stories.domain';
import {
  StoryStat,
  type StoryStatDocument,
} from '../schemas/story-stat.schema';

export interface StatTotals {
  saved: number;
  shares: number;
  partners: number;
}

export interface DayTotals extends StatTotals {
  date: string;
}

export interface PartnerTotals {
  agent_id: string;
  saved: number;
  shares: number;
  active_days: number;
  last_date: string;
}

/** `{ product: 3, tip: 1 }` — summed key by key. */
export type Counts = Record<string, number>;

@Injectable()
export class StoryStatRepository {
  constructor(
    @InjectModel(StoryStat.name)
    private readonly model: Model<StoryStatDocument>,
  ) {}

  /**
   * One `$inc` upsert on the partner's day row — no read, no race. A save
   * that is also shared counts both in the same write.
   */
  async bump(
    agentId: string,
    date: string,
    event: {
      saved?: boolean;
      share?: { template: StoryTemplate; channel: ShareChannel };
    },
  ): Promise<void> {
    const inc: Record<string, number> = {};
    if (event.saved) inc.saved = 1;
    if (event.share) {
      inc.shares = 1;
      inc[`templates.${event.share.template}`] = 1;
      inc[`channels.${event.share.channel}`] = 1;
    }
    if (!Object.keys(inc).length) return;
    await this.model
      .updateOne(
        { _id: `${agentId}:${date}` },
        { $inc: inc, $setOnInsert: { agent_id: agentId, date } },
        { upsert: true },
      )
      .exec();
  }

  async perDay(from: string, to: string): Promise<DayTotals[]> {
    return this.model
      .aggregate<DayTotals>([
        { $match: { date: { $gte: from, $lte: to } } },
        {
          $group: {
            _id: '$date',
            saved: { $sum: '$saved' },
            shares: { $sum: '$shares' },
            partners: { $sum: { $cond: [{ $gt: ['$shares', 0] }, 1, 0] } },
          },
        },
        { $sort: { _id: 1 } },
        {
          $project: {
            _id: 0,
            date: '$_id',
            saved: 1,
            shares: 1,
            partners: 1,
          },
        },
      ])
      .exec();
  }

  /**
   * Range totals, and the template / channel split, in one pass. Sharers and
   * the splits are summed inside Mongo: pushing every partner id or day row
   * into one result would pass the 16 MB document limit at scale.
   */
  async totals(
    from: string,
    to: string,
  ): Promise<StatTotals & { templates: Counts; channels: Counts }> {
    const split = (
      field: 'templates' | 'channels',
    ): PipelineStage.FacetPipelineStage[] => [
      { $project: { kv: { $objectToArray: { $ifNull: [`$${field}`, {}] } } } },
      { $unwind: '$kv' },
      { $group: { _id: '$kv.k', n: { $sum: '$kv.v' } } },
    ];
    const [row] = await this.model
      .aggregate<{
        sums: { saved: number; shares: number }[];
        sharers: { n: number }[];
        templates: { _id: string; n: number }[];
        channels: { _id: string; n: number }[];
      }>([
        { $match: { date: { $gte: from, $lte: to } } },
        {
          $facet: {
            sums: [
              {
                $group: {
                  _id: null,
                  saved: { $sum: '$saved' },
                  shares: { $sum: '$shares' },
                },
              },
            ],
            sharers: [
              { $match: { shares: { $gt: 0 } } },
              { $group: { _id: '$agent_id' } },
              { $count: 'n' },
            ],
            templates: split('templates'),
            channels: split('channels'),
          },
        },
      ])
      .exec();
    const counts = (list: { _id: string; n: number }[] = []): Counts =>
      Object.fromEntries(list.map((c) => [c._id, c.n]));
    return {
      saved: row?.sums[0]?.saved ?? 0,
      shares: row?.sums[0]?.shares ?? 0,
      partners: row?.sharers[0]?.n ?? 0,
      templates: counts(row?.templates),
      channels: counts(row?.channels),
    };
  }

  /** Partners in the range, most shares first. */
  async perPartner(
    from: string,
    to: string,
    skip: number,
    limit: number,
  ): Promise<{ rows: PartnerTotals[]; total: number }> {
    const pipeline: PipelineStage[] = [
      { $match: { date: { $gte: from, $lte: to } } },
      {
        $group: {
          _id: '$agent_id',
          saved: { $sum: '$saved' },
          shares: { $sum: '$shares' },
          active_days: { $sum: 1 },
          last_date: { $max: '$date' },
        },
      },
      {
        $facet: {
          rows: [
            { $sort: { shares: -1, saved: -1, _id: 1 } },
            { $skip: skip },
            { $limit: limit },
            {
              $project: {
                _id: 0,
                agent_id: '$_id',
                saved: 1,
                shares: 1,
                active_days: 1,
                last_date: 1,
              },
            },
          ],
          total: [{ $count: 'n' }],
        },
      },
    ];
    const [result] = await this.model
      .aggregate<{ rows: PartnerTotals[]; total: { n: number }[] }>(pipeline)
      .exec();
    return { rows: result?.rows ?? [], total: result?.total[0]?.n ?? 0 };
  }

  /** One partner's days in the range — an `_id` range, string order is date order. */
  forPartner(agentId: string, from: string, to: string): Promise<StoryStat[]> {
    return this.model
      .find({ _id: { $gte: `${agentId}:${from}`, $lte: `${agentId}:${to}` } })
      .sort({ _id: 1 })
      .lean<StoryStat[]>()
      .exec();
  }
}

export function sumCounts(list: (Counts | null | undefined)[]): Counts {
  const out: Counts = {};
  for (const counts of list) {
    for (const [key, n] of Object.entries(counts ?? {})) {
      out[key] = (out[key] ?? 0) + n;
    }
  }
  return out;
}
