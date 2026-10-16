import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

import { ASSIGNMENT_REASONS, type AssignmentReason } from '../earning.domain';

/**
 * One stretch of time a partner spent in an earning cohort. The commission
 * of an order follows the cohort at its placing time, so these are history:
 * never edited after `to` is set, never deleted.
 */
@Schema({
  collection: 'vistaar_v2_earning_assignments',
  timestamps: { createdAt: 'created_at', updatedAt: false },
  versionKey: false,
})
export class EarningAssignment {
  /** UUID. */
  @Prop({ type: String }) _id!: string;
  /** `VST-…`. */
  @Prop({ type: String, required: true }) agent_id!: string;
  @Prop({ type: String, required: true }) cohort_id!: string;
  @Prop({ type: Date, required: true }) from!: Date;
  /** `null` while current. */
  @Prop({ type: Date, default: null }) to!: Date | null;
  /** `true` while current — the unique partial index keeps one per partner. */
  @Prop({ type: Boolean, required: true }) open!: boolean;
  @Prop({ type: String, enum: ASSIGNMENT_REASONS, required: true })
  reason!: AssignmentReason;
  created_at!: Date;
}

export type EarningAssignmentDocument = HydratedDocument<EarningAssignment>;
export const EarningAssignmentSchema =
  SchemaFactory.createForClass(EarningAssignment);

// A partner's history, newest first; the cohort at an order's time.
EarningAssignmentSchema.index({ agent_id: 1, from: -1 });
// One current row per partner: a second process opening another fails here.
EarningAssignmentSchema.index(
  { agent_id: 1 },
  { unique: true, partialFilterExpression: { open: true } },
);
