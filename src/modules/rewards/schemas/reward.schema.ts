import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

import {
  EARNING_TRIGGERS,
  REWARD_KINDS,
  type EarningTrigger,
  type RewardKind,
} from '@modules/earning/earning.domain';

import { REWARD_STATUSES, type RewardStatus } from '../rewards.domain';

/**
 * One coin or gig reward an event earned a partner, as it stood then: the
 * rule, the amount and the earning cohort are copied, so a later rule or
 * cohort change never rewrites it. Pending until HO decides; never deleted —
 * an approved gig is money in the wallet.
 */
@Schema({
  collection: 'vistaar_v2_rewards',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  versionKey: false,
  minimize: false,
})
export class Reward {
  /**
   * `<trigger>:<the event's once-only key>:<kind>` — the same event can only
   * ever be inserted once. E.g. `lead_created:<pii_id>:<kind>`,
   * `follow_up_done:<pii_id>:<YYYY-MM-DD due day, IST>:<kind>`,
   * `reorder:<order_id>:<kind>`, `attendance_streak:<agent_id>:<day>:<kind>`.
   */
  @Prop({ type: String }) _id!: string;
  /** The partner (`VST-…`). */
  @Prop({ type: String, required: true }) agent_id!: string;
  @Prop({ type: String, required: true }) rule_id!: string;
  /** The rule's name then, for the lists. */
  @Prop({ type: String, required: true }) rule_name!: string;
  @Prop({ type: String, enum: REWARD_KINDS, required: true })
  kind!: RewardKind;
  @Prop({ type: String, enum: EARNING_TRIGGERS, required: true })
  trigger!: EarningTrigger;
  /** The farmer, on a trigger about one; else `null`. */
  @Prop({ type: String, default: null }) pii_id!: string | null;
  /** The farmer's name then, for the lists. */
  @Prop({ type: String, default: null }) farmer_name!: string | null;
  /**
   * The non-farmer thing the reward is about, when there is one: the order
   * (`reorder`), meeting, gig, event, story, the streak's IST day, or the
   * partner themselves (`onboarding_approved`); else `null`.
   */
  @Prop({ type: String, default: null }) ref_id!: string | null;
  /** `follow_up_done`: the IST day the follow-up was due; else `null`. */
  @Prop({ type: String, default: null }) due_day!: string | null;
  /** Coins, or ₹ for a gig; a whole number ≥ 1. */
  @Prop({ type: Number, required: true }) amount!: number;
  /** The partner's earning cohort when it happened. */
  @Prop({ type: String, required: true }) cohort_id!: string;
  @Prop({ type: String, enum: REWARD_STATUSES, default: 'pending' })
  status!: RewardStatus;
  /** Why HO (or the system) rejected it. */
  @Prop({ type: String, default: null }) reason!: string | null;
  /** HO's email, or `system`. */
  @Prop({ type: String, default: null }) reviewed_by!: string | null;
  /** An approved gig is earned (in the wallet) from this moment. */
  @Prop({ type: Date, default: null }) reviewed_at!: Date | null;
  created_at!: Date;
  updated_at!: Date;
}

export type RewardDocument = HydratedDocument<Reward>;
export const RewardSchema = SchemaFactory.createForClass(Reward);

// HO's queue: by status, newest first (all statuses = a merge of the three).
RewardSchema.index({ status: 1, created_at: -1, _id: 1 });
// The partner's list and summary, and the wallet's approved gigs.
RewardSchema.index({ agent_id: 1, created_at: -1, _id: 1 });
