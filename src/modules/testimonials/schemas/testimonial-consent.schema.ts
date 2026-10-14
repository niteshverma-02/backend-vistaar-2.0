import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export const CONSENT_LANGS = ['en', 'hi'] as const;
export type ConsentLang = (typeof CONSENT_LANGS)[number];

/**
 * `vistaar_v2_testimonial_consents` — the farmer's permission to show their
 * face, voice, words and name, one row per testimonial (`_id` = the
 * submission's). Kept apart from the testimonial so it outlives it: never
 * deleted, even when the testimonial is (DPDP — the proof of what was agreed).
 */
@Schema({
  collection: 'vistaar_v2_testimonial_consents',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  versionKey: false,
})
export class TestimonialConsent {
  /** The submission's id. */
  @Prop({ type: String }) _id!: string;
  /** Who took it (`VST-…`). */
  @Prop({ type: String, required: true }) agent_id!: string;
  /** Who gave it. */
  @Prop({ type: String, required: true }) pii_id!: string;
  @Prop({ type: String, required: true }) farmer_name!: string;

  /** The wording's version and the exact words shown — settings keep only the latest. */
  @Prop({ type: Number, required: true }) version!: number;
  @Prop({ type: String, required: true }) text!: string;
  @Prop({ type: String, enum: CONSENT_LANGS, required: true })
  lang!: ConsentLang;
  /** Server time. */
  @Prop({ type: Date, required: true }) given_at!: Date;

  @Prop({ type: String, enum: ['given', 'withdrawn'], default: 'given' })
  status!: 'given' | 'withdrawn';
  @Prop({ type: Date, default: null }) withdrawn_at!: Date | null;
  /** The HO email that recorded it. */
  @Prop({ type: String, default: null }) withdrawn_by!: string | null;
  @Prop({ type: String, default: null }) withdrawn_reason!: string | null;

  created_at!: Date;
  updated_at!: Date;
}

export type TestimonialConsentDocument = HydratedDocument<TestimonialConsent>;
export const TestimonialConsentSchema =
  SchemaFactory.createForClass(TestimonialConsent);

// A farmer's consents, for HO answering "what did I agree to?".
TestimonialConsentSchema.index({ pii_id: 1, given_at: -1 });
// What a partner collected.
TestimonialConsentSchema.index({ agent_id: 1, given_at: -1 });
