import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, type HydratedDocument, type Types } from 'mongoose';

import {
  NPS_BUCKETS,
  type FollowUpStatus,
  type NpsBucket,
} from '../feedback.domain';

/** The partner as they were when they answered — what the desk lists and searches. */
export interface PartnerSnapshot {
  name: string | null;
  phone: string;
  cohort: string | null;
  district: string | null;
  state: string | null;
  /** `agents_v2.agent_id` of the HO officer who owns the partner. */
  owner_agent_id: string | null;
}

/** A detractor's call-back promise ("within 2 working days"). */
export interface FollowUp {
  status: FollowUpStatus;
  due_at: Date;
  /** Who should call: the partner's owner when they answered. */
  owner_agent_id: string | null;
  note: string | null;
  done_by: string | null;
  done_at: Date | null;
}

/** One answer of the Feedback screen. Never edited by the partner; never deleted. */
@Schema({
  collection: 'vistaar_v2_feedback',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  versionKey: false,
})
export class Feedback {
  _id!: Types.ObjectId;
  @Prop({ type: String, required: true }) agent_id!: string;
  @Prop({ type: SchemaTypes.Mixed, required: true }) partner!: PartnerSnapshot;
  /** 0–10. */
  @Prop({ type: Number, required: true }) nps!: number;
  @Prop({ type: String, enum: NPS_BUCKETS, required: true })
  bucket!: NpsBucket;
  /** The chips as the partner saw them. */
  @Prop({ type: [String], default: [] }) reasons!: string[];
  @Prop({ type: String, default: null }) comment!: string | null;
  /** 1–5 stars, or `null` when not given. */
  @Prop({ type: Number, default: null }) rating!: number | null;
  /** Only on detractors. */
  @Prop({ type: SchemaTypes.Mixed, default: null })
  follow_up!: FollowUp | null;
  created_at!: Date;
  updated_at!: Date;
}

export type FeedbackDocument = HydratedDocument<Feedback>;
export const FeedbackSchema = SchemaFactory.createForClass(Feedback);

// The partner's daily cap and their history.
FeedbackSchema.index({ agent_id: 1, created_at: -1 });
// The desk's newest-first list and the date-range summary.
FeedbackSchema.index({ created_at: -1 });
FeedbackSchema.index({ bucket: 1, created_at: -1 });
// Open call-backs, soonest due first.
FeedbackSchema.index(
  { 'follow_up.status': 1, 'follow_up.due_at': 1 },
  { partialFilterExpression: { 'follow_up.status': { $exists: true } } },
);
