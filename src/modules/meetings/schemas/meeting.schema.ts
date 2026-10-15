import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument } from 'mongoose';

import {
  MEETING_STATUSES,
  MEETING_TYPES,
  ORGANISERS,
  type Attendee,
  type MeetingCounts,
  type MeetingStatus,
  type MeetingType,
  type Organiser,
} from '../meetings.domain';

@Schema({ _id: false, versionKey: false })
export class MeetingAttendee implements Attendee {
  @Prop({ type: String, required: true }) phone!: string;
  @Prop({ type: String, required: true }) name!: string;
  @Prop({ type: String, default: null }) village!: string | null;
  @Prop({ type: String, default: null }) pii_id!: string | null;
  @Prop({ type: Boolean, default: false }) invited!: boolean;
  @Prop({ type: Boolean, default: false }) present!: boolean;
  @Prop({ type: Boolean, default: false }) walk_in!: boolean;
  @Prop({ type: Boolean, default: false }) lead_captured!: boolean;
}

const MeetingAttendeeSchema = SchemaFactory.createForClass(MeetingAttendee);

/**
 * One meeting a partner calls. Attendees live on the row: a village meeting
 * is a few dozen people, and the whole list is saved in one write.
 */
@Schema({
  collection: 'vistaar_v2_meetings',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  versionKey: false,
})
export class Meeting {
  /** The app's UUID, so a retried create is the same meeting. */
  @Prop({ type: String }) _id!: string;
  @Prop({ type: String, required: true }) agent_id!: string;
  @Prop({ type: String, enum: MEETING_TYPES, required: true })
  type!: MeetingType;
  @Prop({ type: String, required: true }) title!: string;
  @Prop({ type: Date, required: true }) starts_at!: Date;
  @Prop({ type: String, required: true }) village!: string;
  @Prop({ type: String, default: null }) venue!: string | null;
  /** Where invites go once WhatsApp is connected. */
  @Prop({ type: String, default: null }) pincode!: string | null;
  @Prop({ type: String, enum: ORGANISERS, default: 'self' })
  organiser!: Organiser;
  @Prop({ type: String, default: null }) agenda!: string | null;
  @Prop({ type: String, enum: MEETING_STATUSES, default: 'scheduled' })
  status!: MeetingStatus;
  @Prop({ type: [MeetingAttendeeSchema], default: [] })
  attendees!: MeetingAttendee[];
  /** Kept in step with `attendees` on every write, for lists and HO totals. */
  @Prop({
    type: { invited: Number, present: Number, leads: Number },
    _id: false,
    default: () => ({ invited: 0, present: 0, leads: 0 }),
  })
  counts!: MeetingCounts;
  @Prop({ type: Date, default: null }) completed_at!: Date | null;
  @Prop({ type: Date, default: null }) cancelled_at!: Date | null;
  @Prop({ type: String, default: null }) cancel_note!: string | null;
  created_at!: Date;
  updated_at!: Date;
}

export type MeetingDocument = HydratedDocument<Meeting>;
export const MeetingSchema = SchemaFactory.createForClass(Meeting);

// The partner's list (newest first) and Today's tasks; HO's date-sorted list.
MeetingSchema.index({ agent_id: 1, starts_at: -1 });
MeetingSchema.index({ starts_at: -1 });
