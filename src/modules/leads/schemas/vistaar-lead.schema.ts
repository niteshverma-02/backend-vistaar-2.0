import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, type HydratedDocument } from 'mongoose';

import type { GeoPoint } from '@common/utils/geo.util';

import {
  FOUND_VIA,
  LEAD_STAGES,
  LOCATION_SOURCES,
  type ActivityType,
  type FoundVia,
  type HoldEnd,
  type LeadStage,
  type LocationSource,
} from '../leads.domain';

export interface StageMove {
  from: LeadStage | null;
  to: LeadStage;
  at: Date;
  /** `VST-…`, or `system` (first order). */
  by: string;
}

export interface LeadActivity {
  id: string;
  type: ActivityType;
  text: string;
  at: Date;
  by: string;
}

/** A partner who held the farmer before. */
export interface HolderMove {
  agent_id: string;
  from: Date;
  to: Date;
  reason: HoldEnd;
  /** The partner who took over (`VST-…`), or the HO user's email (transfer). */
  by: string;
  /** HO's reason for a transfer. */
  note?: string;
}

/**
 * `vistaar_v2_leads` — one row per farmer a partner holds (the PRD's partner
 * lead: owner, stage, follow-up, activity, consent). The farmer themself is
 * the org's record (`pii_id` → `leads_v2` / `contacts_v2`); the basics here
 * are the partner's copy, kept for the lists and search.
 */
@Schema({
  collection: 'vistaar_v2_leads',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  versionKey: false,
  minimize: false,
})
export class VistaarLead {
  @Prop({ type: String }) _id!: string;

  /** The farmer — unique: one farmer, one partner. */
  @Prop({ type: String, required: true }) pii_id!: string;
  /** The partner (`VST-…`). */
  @Prop({ type: String, required: true }) agent_id!: string;
  /** The org lead (`L-…`); `null` until written, or for a person with a contact only. */
  @Prop({ type: String, default: null }) lead_id!: string | null;
  /** `created` — Vistaar wrote the org records; `linked` — an existing Katyayani farmer. */
  @Prop({ type: String, enum: ['created', 'linked'], required: true })
  origin!: 'created' | 'linked';

  @Prop({ type: String, required: true }) name!: string;
  @Prop({ type: String, required: true }) phone!: string;
  @Prop({ type: String, required: true }) village!: string;
  @Prop({ type: String, default: null }) district!: string | null;
  @Prop({ type: String, default: null }) state!: string | null;
  @Prop({ type: String, default: null }) pincode!: string | null;
  @Prop({ type: [String], default: [] }) crops!: string[];
  @Prop({ type: Number, required: true }) acreage!: number;

  @Prop({ type: String, enum: FOUND_VIA, default: null })
  found_via!: FoundVia | null;
  @Prop({ type: Number, default: null }) expected_value!: number | null;

  @Prop({ type: String, enum: LEAD_STAGES, default: 'prospect' })
  stage!: LeadStage;
  @Prop({ type: [SchemaTypes.Mixed], default: [] })
  stage_history!: StageMove[];
  @Prop({ type: Date, default: null }) next_follow_up!: Date | null;
  @Prop({ type: String, default: null }) lost_reason!: string | null;
  /** Newest last; the last 100 kept. */
  @Prop({ type: [SchemaTypes.Mixed], default: [] })
  activities!: LeadActivity[];

  /** The consent wording's version the partner ticked, and when. */
  @Prop({ type: SchemaTypes.Mixed, required: true })
  consent!: { version: number; at: Date };
  /** Ex-employee partners: "did not handle this farmer at Katyayani in the last 12 months". */
  @Prop({ type: Date, default: null }) ex_employee_declared_at!: Date | null;

  /** Set by the first order (won). */
  @Prop({ type: Date, default: null }) customer_at!: Date | null;
  /** Set by every order (Customers epic): a customer's hold runs from it. */
  @Prop({ type: Date, default: null }) last_order_at!: Date | null;

  /** Since when this partner holds the farmer; `null` = since `created_at`. */
  @Prop({ type: Date, default: null }) held_since!: Date | null;
  /** The partner's last work on the lead: a save, stage, follow-up, expected value or activity. */
  @Prop({ type: Date, default: null }) last_worked_at!: Date | null;
  /** Earlier partners, oldest first (last 20). HO only. */
  @Prop({ type: [SchemaTypes.Mixed], default: [] })
  holder_history!: HolderMove[];

  /** Where the farmer is (GeoJSON, lng first) — the radar's dot; `null` = unknown. */
  @Prop({ type: SchemaTypes.Mixed, default: null })
  location!: GeoPoint | null;
  /** How `location` was learnt (a phone fix at a visit / add / order, or the pincode's centre). */
  @Prop({ type: String, enum: LOCATION_SOURCES, default: null })
  location_source!: LocationSource | null;
  @Prop({ type: Date, default: null }) location_at!: Date | null;

  created_at!: Date;
  updated_at!: Date;
}

export type VistaarLeadDocument = HydratedDocument<VistaarLead>;
export const VistaarLeadSchema = SchemaFactory.createForClass(VistaarLead);

VistaarLeadSchema.index({ pii_id: 1 }, { unique: true });
VistaarLeadSchema.index({ agent_id: 1, created_at: -1 });
VistaarLeadSchema.index({ agent_id: 1, stage: 1 });
VistaarLeadSchema.index({ agent_id: 1, next_follow_up: 1 });
VistaarLeadSchema.index({ created_at: -1 });
// HO: customers (stage `won`) counted and summed, leads by stage, newest first.
VistaarLeadSchema.index({ stage: 1, created_at: -1 });
VistaarLeadSchema.index({ phone: 1 });
// HO: customers by latest order (only won leads have one, so it walks them
// first); follow-ups across partners. `_id` closes the sort (stable pages).
VistaarLeadSchema.index({ last_order_at: -1, _id: 1 });
VistaarLeadSchema.index({ next_follow_up: 1, _id: 1 });
// The radar: one partner's farmers within N km. Rows with no location are
// not in it (2dsphere skips them).
VistaarLeadSchema.index({ agent_id: 1, location: '2dsphere' });
