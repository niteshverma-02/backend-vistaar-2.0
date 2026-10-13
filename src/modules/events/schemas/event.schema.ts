import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument } from 'mongoose';

import { EVENT_TYPES, type EventType } from '../events.domain';

/** One farmer event, written by HO. */
@Schema({
  collection: 'vistaar_v2_events',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  versionKey: false,
})
export class FarmerEvent {
  /** UUID. */
  @Prop({ type: String }) _id!: string;
  @Prop({ type: String, required: true }) title!: string;
  @Prop({ type: String, enum: EVENT_TYPES, required: true }) type!: EventType;
  @Prop({ type: Date, required: true }) starts_at!: Date;
  /** Venue, or "Online (Google Meet)". */
  @Prop({ type: String, required: true }) location!: string;
  /** Shown on a story invite, e.g. "Free soil testing". */
  @Prop({ type: String, default: null }) note!: string | null;
  @Prop({ type: Number, required: true }) seats!: number;
  /** Kept in step with `vistaar_v2_event_registrations` by conditional `$inc`. */
  @Prop({ type: Number, default: 0 }) registered_count!: number;
  /** Cohort keys that see it; empty means every partner. */
  @Prop({ type: [String], default: [] }) cohorts!: string[];
  @Prop({ type: Boolean, default: true }) is_active!: boolean;
  @Prop({ type: String }) created_by!: string;
  @Prop({ type: String }) updated_by!: string;
  created_at!: Date;
  updated_at!: Date;
}

export type FarmerEventDocument = HydratedDocument<FarmerEvent>;
export const FarmerEventSchema = SchemaFactory.createForClass(FarmerEvent);

// The app's read (active, upcoming soonest first) and HO's date-sorted list.
FarmerEventSchema.index({ is_active: 1, starts_at: 1 });
