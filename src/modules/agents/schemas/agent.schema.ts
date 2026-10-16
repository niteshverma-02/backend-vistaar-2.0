import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, type HydratedDocument } from 'mongoose';

import type { GeoPoint } from '@common/utils/geo.util';

import { PARTNER_ROLE_CODE, STAGES, type Stage } from '../agents.domain';

export const AGENTS_COLLECTION = 'vistaar_v2_agents';

export interface StageHistoryEntry {
  from: Stage | null;
  to: Stage;
  by: string;
  at: Date;
  reason?: string;
}

/** What the pipeline lists and searches on, refreshed on every onboarding save. */
export interface AgentPreview {
  name?: string;
  district?: string;
  state?: string;
  pincode?: string;
}

/** Mapped from the onboarding data when HO approves (`maps_to` on each field). */
export interface AgentProfile {
  name?: string;
  email?: string;
  sub_cohort?: string;
  address_line?: string;
  village?: string;
  district?: string;
  state?: string;
  pincode?: string;
  details?: Record<string, unknown>;
}

/** The partner's earning cohort now — a copy of the open `vistaar_v2_earning_assignments` row. */
export interface EarningCohortRef {
  id: string;
  since: Date;
}

/**
 * One Vistaar partner, from the moment an OTP is asked for. The record is
 * created at OTP send with `otp_verified: false`; the `VST-` id and the
 * `pii_id` are given only once the OTP is verified, so a number nobody
 * verifies never takes an id or touches the shared `piis`.
 *
 * Never deleted: a rejected or blocked partner stays, with the history of how
 * they got there.
 */
@Schema({
  collection: AGENTS_COLLECTION,
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  versionKey: false,
})
export class Agent {
  /** UUID — the token's `sub`. */
  @Prop({ type: String }) _id!: string;

  /** `VST-000001`, given at OTP verify. */
  @Prop({ type: String, default: null }) agent_id!: string | null;
  @Prop({ type: String, default: null }) pii_id!: string | null;

  /** Ten digits, as `piis.phone_number` stores them. India only for now. */
  @Prop({ type: String, required: true }) phone!: string;
  @Prop({ type: String, required: true, default: '+91' }) country_code!: string;

  @Prop({ type: String, default: PARTNER_ROLE_CODE }) user_role!: string;

  @Prop({ type: Boolean, default: false }) otp_verified!: boolean;
  @Prop({ type: Date, default: null }) otp_verified_at!: Date | null;
  @Prop({ type: Date, default: null }) last_login_at!: Date | null;

  @Prop({ type: String, enum: STAGES, default: 'signed_up' }) stage!: Stage;
  @Prop({ type: [SchemaTypes.Mixed], default: [] })
  stage_history!: StageHistoryEntry[];
  /** The stage a block interrupted, so an unblock puts it back. */
  @Prop({ type: String, default: null }) blocked_from!: Stage | null;

  @Prop({ type: String, default: null }) onboarding_id!: string | null;
  @Prop({ type: String, default: null }) cohort!: string | null;
  @Prop({ type: SchemaTypes.Mixed, default: {} }) preview!: AgentPreview;

  /** `agents_v2.agent_id` of the HO person responsible for this partner. */
  @Prop({ type: String, default: null }) owner_agent_id!: string | null;

  @Prop({ type: Boolean, default: false }) is_approved!: boolean;
  @Prop({ type: String, default: null }) decided_by!: string | null;
  @Prop({ type: Date, default: null }) decided_at!: Date | null;
  @Prop({ type: String, default: null }) rejection_reason!: string | null;

  @Prop({ type: SchemaTypes.Mixed, default: null })
  profile!: AgentProfile | null;
  @Prop({ type: SchemaTypes.Mixed, default: undefined }) location?: GeoPoint;

  /** Written only by the earning module; absent until first assigned. */
  @Prop({ type: SchemaTypes.Mixed, default: undefined })
  earning_cohort?: EarningCohortRef | null;

  /** ₹ of delivered sales a month HO expects of this partner; `null` = the settings default. */
  @Prop({ type: Number, default: null }) monthly_target!: number | null;

  @Prop({ type: Boolean, default: true }) is_active!: boolean;
  @Prop({ type: String, default: 'self' }) created_by!: string;
  @Prop({ type: String, default: 'self' }) updated_by!: string;

  created_at!: Date;
  updated_at!: Date;
}

export type AgentDocument = HydratedDocument<Agent>;
export const AgentSchema = SchemaFactory.createForClass(Agent);

AgentSchema.index({ phone: 1, country_code: 1 }, { unique: true });
AgentSchema.index(
  { agent_id: 1 },
  { unique: true, partialFilterExpression: { agent_id: { $type: 'string' } } },
);
AgentSchema.index(
  { pii_id: 1 },
  { unique: true, partialFilterExpression: { pii_id: { $type: 'string' } } },
);
AgentSchema.index({ otp_verified: 1, stage: 1, updated_at: -1 });
AgentSchema.index({ owner_agent_id: 1, stage: 1 });
// The HO agent directory: approved partners, newest approval first.
AgentSchema.index({ otp_verified: 1, stage: 1, decided_at: -1 });
AgentSchema.index({ location: '2dsphere' });
// The HO partner list by last app login (who has gone quiet).
AgentSchema.index({ otp_verified: 1, stage: 1, last_login_at: -1 });
