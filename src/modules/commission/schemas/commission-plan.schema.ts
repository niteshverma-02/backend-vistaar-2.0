import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, type HydratedDocument } from 'mongoose';

import { PLAN_KINDS, type PlanKind, type Slab } from '../commission.domain';

/** One earlier state of a plan, kept on every change. */
export interface PlanChange {
  at: Date;
  by: string;
  action: 'created' | 'updated';
  /** Absent on changes made before plans had kinds (all slab plans). */
  kind?: PlanKind;
  slabs: Slab[];
  min_order_value?: number | null;
  notes: string[];
  draft: boolean;
}

/**
 * A cohort's commission slabs from a month on, until the next plan for that
 * cohort starts. The cohort is a partner type (`vistaar_agent`) or an earning
 * cohort (`ec_…`). A partner type with no plan earns at the PRD's rates
 * (built in, shown as a draft); an earning cohort with none earns the
 * default cohort's. Past months are locked: they have been paid on.
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
  /** Rows from before 2026-10-16 have none: read as `slabs`. */
  @Prop({ type: String, enum: PLAN_KINDS, default: 'slabs' })
  kind?: PlanKind;
  @Prop({ type: [SchemaTypes.Mixed], required: true }) slabs!: Slab[];
  /** ₹ of base an order needs to earn on this plan (earning cohorts only); rows from before have none. */
  @Prop({ type: Number, default: null }) min_order_value?: number | null;
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
