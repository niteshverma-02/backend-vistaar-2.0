import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, type QueryFilter } from 'mongoose';

import { isDuplicateKey } from '@common/utils/mongo-error.util';

import type { StoryTemplate } from '../stories.domain';
import { Story, type StoryDocument } from '../schemas/story.schema';

export interface AdminStoryFilter {
  agent_id?: string;
  template?: StoryTemplate;
}

/** The fields a save writes; the rest are the row's own counters. */
export type StoryContent = Omit<
  Story,
  | '_id'
  | 'agent_id'
  | 'signature'
  | 'share_count'
  | 'last_shared_at'
  | 'last_used_at'
  | 'created_at'
  | 'updated_at'
>;

/** Every partner read and write carries `agent_id`: one partner never reaches another's row. */
@Injectable()
export class StoryRepository {
  constructor(
    @InjectModel(Story.name) private readonly model: Model<StoryDocument>,
  ) {}

  listMine(agentId: string, limit: number): Promise<Story[]> {
    return this.model
      .find({ agent_id: agentId })
      .sort({ last_used_at: -1, _id: 1 })
      .limit(limit)
      .lean<Story[]>()
      .exec();
  }

  findMine(agentId: string, id: string): Promise<Story | null> {
    return this.model
      .findOne({ _id: id, agent_id: agentId })
      .lean<Story | null>()
      .exec();
  }

  findBySignature(agentId: string, signature: string): Promise<Story | null> {
    return this.model
      .findOne({ agent_id: agentId, signature })
      .lean<Story | null>()
      .exec();
  }

  /**
   * Inserts the story, or — when the same story is already saved — brings it
   * to the top with the new image. `created` says which, for the stats.
   * Two saves racing on one new story meet on the unique index; the loser
   * takes the update path.
   */
  async upsert(
    id: string,
    agentId: string,
    signature: string,
    content: StoryContent,
    now: Date,
  ): Promise<{ story: Story; created: boolean }> {
    for (let attempt = 0; ; attempt++) {
      try {
        const story = await this.model
          .findOneAndUpdate(
            { agent_id: agentId, signature },
            {
              $set: { ...content, last_used_at: now },
              $setOnInsert: {
                _id: id,
                share_count: 0,
                last_shared_at: null,
              },
            },
            { upsert: true, returnDocument: 'after' },
          )
          .lean<Story>()
          .exec();
        // The fresh id only lands on an insert.
        return { story, created: story._id === id };
      } catch (error) {
        if (attempt > 0 || !isDuplicateKey(error)) throw error;
      }
    }
  }

  /** One share: counted, and the story moves to the top. */
  recordShare(agentId: string, id: string, now: Date): Promise<Story | null> {
    return this.model
      .findOneAndUpdate(
        { _id: id, agent_id: agentId },
        {
          $inc: { share_count: 1 },
          $set: { last_shared_at: now, last_used_at: now },
        },
        { returnDocument: 'after' },
      )
      .lean<Story | null>()
      .exec();
  }

  /** The partner's stories past the newest `keep` — what drops off the list. */
  beyond(agentId: string, keep: number): Promise<Story[]> {
    return this.model
      .find({ agent_id: agentId })
      .sort({ last_used_at: -1, _id: 1 })
      .skip(keep)
      .lean<Story[]>()
      .exec();
  }

  async removeMany(agentId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.model
      .deleteMany({ agent_id: agentId, _id: { $in: ids } })
      .exec();
  }

  async remove(agentId: string, id: string): Promise<boolean> {
    const result = await this.model
      .deleteOne({ _id: id, agent_id: agentId })
      .exec();
    return result.deletedCount === 1;
  }

  /** A photo can back several of the partner's stories; its file goes with the last one. */
  countUsing(agentId: string, path: string): Promise<number> {
    return this.model
      .countDocuments({
        agent_id: agentId,
        $or: [{ image_path: path }, { photo_path: path }],
      })
      .exec();
  }

  find(id: string): Promise<Story | null> {
    return this.model.findById(id).lean<Story | null>().exec();
  }

  async page(
    filter: AdminStoryFilter,
    skip: number,
    limit: number,
    sort: Record<string, 1 | -1>,
  ): Promise<{ rows: Story[]; total: number }> {
    const query: QueryFilter<Story> = {};
    if (filter.agent_id) query.agent_id = filter.agent_id;
    if (filter.template) query.template = filter.template;
    const [rows, total] = await Promise.all([
      this.model
        .find(query)
        .sort({ ...sort, _id: 1 })
        .skip(skip)
        .limit(limit)
        .lean<Story[]>()
        .exec(),
      this.model.countDocuments(query).exec(),
    ]);
    return { rows, total };
  }
}
