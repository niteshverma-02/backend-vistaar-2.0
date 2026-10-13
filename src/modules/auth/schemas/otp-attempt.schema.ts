import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

/**
 * Recent OTP sends or guesses for one phone, shared by every server process —
 * in memory, four processes would allow four times the guesses. Mongo deletes
 * the row once its window has passed (TTL index).
 */
@Schema({ collection: 'vistaar_v2_otp_attempts', versionKey: false })
export class OtpAttempt {
  /** `<kind>:<phone>`, e.g. `verify:9876543210`. */
  @Prop({ type: String }) _id!: string;
  /** Times of the hits still inside the window, oldest first. */
  @Prop({ type: [Date], default: [] }) hits!: Date[];
  /** Whether the last take was let through. */
  @Prop({ type: Boolean, default: true }) allowed!: boolean;
  @Prop({ type: Date, required: true }) expires_at!: Date;
}

export type OtpAttemptDocument = HydratedDocument<OtpAttempt>;
export const OtpAttemptSchema = SchemaFactory.createForClass(OtpAttempt);

OtpAttemptSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });
