import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, type HydratedDocument } from 'mongoose';

import {
  COHORT_STATUSES,
  type CommissionOffRange,
  type EarningFilters,
  type EarningStatus,
  type RuleCondition,
} from '../earning.domain';
import { EarningRule, EarningRuleSchema } from './earning-rule.schema';

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
  /**
   * What places a partner in the cohort — all must hold, a list value holds
   * on any entry. `null` only on a row from before conditions: the services
   * convert its `filters` on read (`ec_default` keeps `[]`, locked).
   */
  @Prop({ type: SchemaTypes.Mixed, default: null })
  conditions!: RuleCondition[] | null;
  /** The legacy view, derived from `conditions` (best effort), kept for old readers. */
  @Prop({ type: SchemaTypes.Mixed, required: true }) filters!: EarningFilters;
  /** 1 = looked at first among active cohorts; the default is always last (its own is 0). */
  @Prop({ type: Number, required: true }) priority!: number;
  @Prop({ type: String, enum: COHORT_STATUSES, default: 'active' })
  status!: EarningStatus;
  /**
   * IST days `YYYY-MM-DD`, both included: the cohort takes partners only
   * between them; `null` = open on that side. Absent on rows from before
   * dates (read as `null`); never set on `ec_default`.
   */
  @Prop({ type: String, default: null }) starts_on?: string | null;
  @Prop({ type: String, default: null }) ends_on?: string | null;
  /**
   * Months the cohort's own commission plan was switched off (its partners
   * earn `ec_default`'s then). Absent on rows from before the switch (= none);
   * never set on `ec_default`.
   */
  @Prop({ type: [SchemaTypes.Mixed], default: [] })
  commission_off?: CommissionOffRange[];
  /** ₹ a meeting gig pays its partner when HO left the gig's payout empty; `null` = settings `gig_payout`. */
  @Prop({ type: Number, default: null }) meeting_gig_payout!: number | null;
  /**
   * At most this % (0–100) of an order's subtotal its partners may pay with
   * coins; `null` (and rows from before it) = `DEFAULT_COIN_REDEEM_PCT`.
   */
  @Prop({ type: Number, default: null }) coin_redeem_pct?: number | null;
  /** At most this many coins on one order; `null` (and rows from before it) = no cap. */
  @Prop({ type: Number, default: null }) coin_redeem_max?: number | null;
  /**
   * Its coin / gig rules, archived ones too. Written only by the rule
   * repository, one rule at a time (guarded by that rule's own `version`),
   * so a rule edit and a cohort edit never conflict. Missing on a row from
   * before the merge (read as `[]`).
   */
  @Prop({ type: [EarningRuleSchema], default: [] })
  rules!: EarningRule[];
  /** 1 on create, +1 on every edit of the cohort's own fields (never a rule's). */
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
// A rule by its id (HO's get / edit / archive), and no id in two cohorts.
// Partial: a cohort with no rules would index `null` and clash with the next.
EarningCohortSchema.index(
  { 'rules._id': 1 },
  {
    unique: true,
    partialFilterExpression: { 'rules._id': { $exists: true } },
  },
);
