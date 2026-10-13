import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument } from 'mongoose';

/** A partner's seat at an event. */
@Schema({
  collection: 'vistaar_v2_event_registrations',
  timestamps: { createdAt: 'created_at', updatedAt: false },
  versionKey: false,
})
export class EventRegistration {
  /** `<event_id>:<agent_id>` — one seat per partner per event, by construction. */
  @Prop({ type: String }) _id!: string;
  @Prop({ type: String, required: true }) event_id!: string;
  @Prop({ type: String, required: true }) agent_id!: string;
  created_at!: Date;
}

export type EventRegistrationDocument = HydratedDocument<EventRegistration>;
export const EventRegistrationSchema =
  SchemaFactory.createForClass(EventRegistration);

// HO's list of who registered; the partner's own checks are `_id` lookups.
EventRegistrationSchema.index({ event_id: 1, created_at: 1 });
