import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, type HydratedDocument } from 'mongoose';

import type { Slab } from '../commission.domain';

/** One earlier state of a plan, kept on every change. */
export interface PlanChange {
  at: Date;
  by: string;
  action: 'created' | 'updated';
  slabs: Slab[];
  notes: string[];
  draft: boolean;
}

/**
 * A cohort's commission slabs from a month on, until the next plan for that
 * cohort starts. A cohort with no plan earns at the PRD's rates (built in,
 * shown as a draft). Past months are locked: they have been paid on.
 */
@Schema({
  collection: 'vistaar_v2_commission_plans',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  versionKey: false,
})
export class CommissionPlan {
  /** `<cohort>@<YYYY-MM>` — one plan per cohort and month, by construction. */
  @Prop({ type: String }) _id!: string;
  @Prop({ type: String, required: true }) cohort!: string;
  /** IST month the plan starts in, `YYYY-MM`. */
  @Prop({ type: String, required: true }) effective_from!: string;
  @Prop({ type: [SchemaTypes.Mixed], required: true }) slabs!: Slab[];
  @Prop({ type: [String], default: [] }) notes!: string[];
  @Prop({ type: Boolean, default: true }) draft!: boolean;
  @Prop({ type: String, required: true }) created_by!: string;
  @Prop({ type: String, required: true }) updated_by!: string;
  /** Oldest first: every state the plan was in before the current one. */
  @Prop({ type: [SchemaTypes.Mixed], default: [] }) history!: PlanChange[];
  created_at!: Date;
  updated_at!: Date;
}

export type CommissionPlanDocument = HydratedDocument<CommissionPlan>;
export const CommissionPlanSchema =
  SchemaFactory.createForClass(CommissionPlan);
// No index: the whole collection (a few rows per cohort) is read and held in memory.
