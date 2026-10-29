import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { applyRecentSearch } from '../catalog.domain';
import {
  RecentSearch,
  type RecentSearchDocument,
} from '../schemas/recent-search.schema';

@Injectable()
export class RecentSearchRepository {
  constructor(
    @InjectModel(RecentSearch.name)
    private readonly model: Model<RecentSearchDocument>,
  ) {}

  /** Moves `term` to the front of the partner's list, deduped and capped. */
  async record(agentId: string, term: string): Promise<string[]> {
    const current = await this.findMine(agentId);
    const terms = applyRecentSearch(current, term);
    await this.model
      .updateOne({ _id: agentId }, { $set: { terms } }, { upsert: true })
      .exec();
    return terms;
  }

  async findMine(agentId: string): Promise<string[]> {
    const row = await this.model
      .findById(agentId)
      .lean<RecentSearch | null>()
      .exec();
    return row?.terms ?? [];
  }

  async clearMine(agentId: string): Promise<void> {
    await this.model.deleteOne({ _id: agentId }).exec();
  }
}
