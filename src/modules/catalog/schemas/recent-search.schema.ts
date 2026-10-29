import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

/** One partner's recent product search terms — newest first, capped, deduped. */
@Schema({
  collection: 'vistaar_v2_recent_searches',
  timestamps: { createdAt: false, updatedAt: 'updated_at' },
  versionKey: false,
})
export class RecentSearch {
  /** `agent_id`. */
  @Prop({ type: String }) _id!: string;
  @Prop({ type: [String], default: [] }) terms!: string[];
  updated_at!: Date;
}

export type RecentSearchDocument = HydratedDocument<RecentSearch>;
export const RecentSearchSchema = SchemaFactory.createForClass(RecentSearch);
