import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, type HydratedDocument } from 'mongoose';

import {
  COHORT_STATUSES,
  type EarningFilters,
  type EarningStatus,
} from '../earning.domain';

/**
 * An HO-built earning cohort (not the onboarding cohort). Never deleted:
 * assignments and the commission of past orders point at it, so it is
 * archived instead. `ec_default` is built in and catches everyone else.
 */
@Schema({
  collection: 'vistaar_v2_earning_cohorts',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  versionKey: false,
  minimize: false,
})
export class EarningCohort {
  /** `ec_` + slug, never changes. */
  @Prop({ type: String }) _id!: string;
  @Prop({ type: String, required: true }) name!: string;
  @Prop({ type: String, default: null }) description!: string | null;
  @Prop({ type: SchemaTypes.Mixed, required: true }) filters!: EarningFilters;
  /** 1 = looked at first among active cohorts; the default is always last (its own is 0). */
  @Prop({ type: Number, required: true }) priority!: number;
  @Prop({ type: String, enum: COHORT_STATUSES, default: 'active' })
  status!: EarningStatus;
  /** ₹ a meeting gig pays its partner when HO left the gig's payout empty; `null` = settings `gig_payout`. */
  @Prop({ type: Number, default: null }) meeting_gig_payout!: number | null;
  /** 1 on create, +1 on every edit; an edit names the one it was made from. */
  @Prop({ type: Number, default: 1 }) version!: number;
  @Prop({ type: String, required: true }) created_by!: string;
  @Prop({ type: String, required: true }) updated_by!: string;
  @Prop({ type: String, default: null }) archived_by!: string | null;
  @Prop({ type: Date, default: null }) archived_at!: Date | null;
  created_at!: Date;
  updated_at!: Date;
}

export type EarningCohortDocument = HydratedDocument<EarningCohort>;
export const EarningCohortSchema = SchemaFactory.createForClass(EarningCohort);

// Active cohorts in HO's order (also read whole — a few dozen rows).
EarningCohortSchema.index({ status: 1, priority: 1 });
