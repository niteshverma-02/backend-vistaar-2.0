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

  /** One `$inc` upsert on the partner's day row — no read, no race. */
  async bump(
    agentId: string,
    date: string,
    event:
      | { kind: 'saved' }
      | { kind: 'share'; template: StoryTemplate; channel: ShareChannel },
  ): Promise<void> {
    const inc: Record<string, number> =
      event.kind === 'saved'
        ? { saved: 1 }
        : {
            shares: 1,
            [`templates.${event.template}`]: 1,
            [`channels.${event.channel}`]: 1,
          };
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

  /** Range totals, and the template / channel split, in one pass. */
  async totals(
    from: string,
    to: string,
  ): Promise<StatTotals & { templates: Counts; channels: Counts }> {
    const [row] = await this.model
      .aggregate<{
        saved: number;
        shares: number;
        sharers: string[];
        templates: Counts[];
        channels: Counts[];
      }>([
        { $match: { date: { $gte: from, $lte: to } } },
        {
          $group: {
            _id: null,
            saved: { $sum: '$saved' },
            shares: { $sum: '$shares' },
            sharers: {
              $addToSet: {
                $cond: [{ $gt: ['$shares', 0] }, '$agent_id', '$$REMOVE'],
              },
            },
            templates: { $push: '$templates' },
            channels: { $push: '$channels' },
          },
        },
      ])
      .exec();
    return {
      saved: row?.saved ?? 0,
      shares: row?.shares ?? 0,
      partners: row?.sharers.length ?? 0,
      templates: sumCounts(row?.templates ?? []),
      channels: sumCounts(row?.channels ?? []),
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
