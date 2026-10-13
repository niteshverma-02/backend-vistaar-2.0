import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, type HydratedDocument } from 'mongoose';

/**
 * One partner's My Story activity on one IST day — counters, never events, so
 * the collection grows with partners × active days, not with every tap.
 */
@Schema({
  collection: 'vistaar_v2_story_stats',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  versionKey: false,
})
export class StoryStat {
  /** `<agent_id>:<YYYY-MM-DD>`. */
  @Prop({ type: String }) _id!: string;
  @Prop({ type: String, required: true }) agent_id!: string;
  /** IST day. */
  @Prop({ type: String, required: true }) date!: string;
  /** New stories saved. */
  @Prop({ type: Number, default: 0 }) saved!: number;
  @Prop({ type: Number, default: 0 }) shares!: number;
  /** Shares per template, e.g. `{ product: 3 }`. */
  @Prop({ type: SchemaTypes.Mixed, default: {} })
  templates!: Record<string, number>;
  /** Shares per channel, e.g. `{ status: 2, farmer: 1 }`. */
  @Prop({ type: SchemaTypes.Mixed, default: {} })
  channels!: Record<string, number>;
  created_at!: Date;
  updated_at!: Date;
}

export type StoryStatDocument = HydratedDocument<StoryStat>;
export const StoryStatSchema = SchemaFactory.createForClass(StoryStat);

// HO's reads are a date range across every partner; one partner's is an `_id` range.
StoryStatSchema.index({ date: 1, agent_id: 1 });
