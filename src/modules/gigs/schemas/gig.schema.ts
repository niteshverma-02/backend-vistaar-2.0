import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, type HydratedDocument } from 'mongoose';

import {
  GIG_STATUSES,
  type CheckinFlag,
  type GigPoint,
  type GigStatus,
} from '../gigs.domain';

export interface GigRelease {
  agent_id: string;
  at: Date;
  /** The partner gave it back, or HO reopened it. */
  by: 'partner' | 'ho';
}

export interface GigCheckin {
  lat: number | null;
  lng: number | null;
  accuracy_m: number | null;
  /** Server time. */
  at: Date;
  distance_m: number | null;
  flags: CheckinFlag[];
}

export interface GigAttendee {
  phone: string;
  name: string;
  village: string | null;
}

export interface GigPhoto {
  /** The file's UUID. */
  id: string;
  path: string;
  at: Date;
}

/** One paid farmer meeting HO posted, and the partner's proof of holding it. */
@Schema({
  collection: 'vistaar_v2_gigs',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  versionKey: false,
})
export class Gig {
  /** `GIG-000001` from `vistaar_v2_counters`. */
  @Prop({ type: String }) _id!: string;
  @Prop({ type: String, required: true }) title!: string;
  @Prop({ type: String, required: true }) village!: string;
  @Prop({ type: String, default: null }) district!: string | null;
  /** Upper case, as partners' states are kept. */
  @Prop({ type: String, default: null }) state!: string | null;
  @Prop({ type: String, default: null }) pincode!: string | null;
  @Prop({ type: String, default: null }) venue!: string | null;
  /** Pinned by HO; check-in distance is measured from it. */
  @Prop({ type: SchemaTypes.Mixed, default: null })
  venue_point!: GigPoint | null;
  @Prop({ type: Date, required: true }) starts_at!: Date;
  @Prop({ type: Date, required: true }) ends_at!: Date;
  @Prop({ type: Number, default: 0 }) expected_farmers!: number;
  @Prop({ type: Number, required: true }) min_farmers!: number;
  @Prop({ type: Number, required: true }) photos_required!: number;
  /** ₹, fixed once a partner holds the gig. */
  @Prop({ type: Number, required: true }) payout!: number;
  @Prop({ type: [String], default: [] }) products!: string[];
  /** Free lines shown to the partner, e.g. "2 testimonials". */
  @Prop({ type: [String], default: [] }) requirements!: string[];
  /** Cohort keys that see it; empty means every partner. */
  @Prop({ type: [String], default: [] }) cohorts!: string[];
  @Prop({ type: String, enum: GIG_STATUSES, default: 'open' })
  status!: GigStatus;
  @Prop({ type: String, default: null }) agent_id!: string | null;
  @Prop({ type: Date, default: null }) accepted_at!: Date | null;
  /** HO email when HO gave it to the partner; `null` = the partner took it. */
  @Prop({ type: String, default: null }) assigned_by!: string | null;
  @Prop({ type: [SchemaTypes.Mixed], default: [] }) releases!: GigRelease[];
  @Prop({ type: SchemaTypes.Mixed, default: null })
  check_in!: GigCheckin | null;
  @Prop({ type: [SchemaTypes.Mixed], default: [] }) attendees!: GigAttendee[];
  @Prop({ type: [SchemaTypes.Mixed], default: [] }) photos!: GigPhoto[];
  @Prop({ type: Date, default: null }) submitted_at!: Date | null;
  @Prop({ type: String, default: null }) reviewed_by!: string | null;
  @Prop({ type: Date, default: null }) reviewed_at!: Date | null;
  @Prop({ type: String, default: null }) reject_reason!: string | null;
  @Prop({ type: String, default: null }) cancelled_by!: string | null;
  @Prop({ type: String, default: null }) cancel_reason!: string | null;
  @Prop({ type: String, required: true }) posted_by!: string;
  @Prop({ type: String }) updated_by!: string;
  created_at!: Date;
  updated_at!: Date;
}

export type GigDocument = HydratedDocument<Gig>;
export const GigSchema = SchemaFactory.createForClass(Gig);

// Open gigs by date (the app's Available tab, HO's calendar).
GigSchema.index({ status: 1, starts_at: 1 });
// A partner's gigs: My gigs, history, earnings, Today's tasks.
GigSchema.index({ agent_id: 1, starts_at: -1 });
// HO review: has this farmer's phone been at another gig lately?
GigSchema.index({ 'attendees.phone': 1, starts_at: -1 });
