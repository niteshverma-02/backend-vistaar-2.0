import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes } from 'mongoose';

import {
  COHORT_STATUSES,
  EARNING_TRIGGERS,
  type EarningStatus,
  type EarningTrigger,
  type RuleCondition,
  type RuleReward,
} from '../earning.domain';

/**
 * One coin / gig rule of an earning cohort, kept inside the cohort's
 * document (`rules[]`) — an event reads the cohort and has its rules with
 * it. When `trigger` happens and every condition holds, the partner earns
 * `reward`. Archived, never removed — rewards already earned name it.
 * Its own `version` and timestamps: a rule edit never touches the cohort's.
 */
@Schema({ versionKey: false, minimize: false })
export class EarningRule {
  /** UUID, unique across every cohort. */
  @Prop({ type: String, required: true }) _id!: string;
  @Prop({ type: String, required: true }) name!: string;
  @Prop({ type: String, enum: EARNING_TRIGGERS, required: true })
  trigger!: EarningTrigger;
  /** All must hold; empty = every time the trigger fires. */
  @Prop({ type: [SchemaTypes.Mixed], default: [] })
  conditions!: RuleCondition[];
  @Prop({ type: SchemaTypes.Mixed, required: true }) reward!: RuleReward;
  /** HO's order within the cohort; the first matching rule per reward kind pays. */
  @Prop({ type: Number, required: true }) order!: number;
  @Prop({ type: String, enum: COHORT_STATUSES, default: 'active' })
  status!: EarningStatus;
  /**
   * HO's ON/OFF switch: off never pays and is not shown in the app, but keeps
   * its place in the order and can be switched on again (unlike archive).
   * Absent on rules from before the switch: read through `ruleEnabled` (on).
   */
  @Prop({ type: Boolean, default: true }) enabled?: boolean;
  @Prop({ type: Number, default: 1 }) version!: number;
  @Prop({ type: String, required: true }) created_by!: string;
  @Prop({ type: String, required: true }) updated_by!: string;
  @Prop({ type: String, default: null }) archived_by!: string | null;
  @Prop({ type: Date, default: null }) archived_at!: Date | null;
  // Set by the repository: rule writes skip schema timestamps, which would
  // stamp the cohort's own `updated_at` too.
  @Prop({ type: Date, required: true }) created_at!: Date;
  @Prop({ type: Date, required: true }) updated_at!: Date;
}

export const EarningRuleSchema = SchemaFactory.createForClass(EarningRule);
