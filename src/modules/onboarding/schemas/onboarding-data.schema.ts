import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, type HydratedDocument } from 'mongoose';

import type { GeoPoint } from '@common/utils/geo.util';

import type { BankChange } from '../bank-change.domain';
import type { RawData } from '../form.domain';
import type { IdKeys } from '../id-keys.domain';

export type DocumentStatus = 'pending' | 'verified' | 'rejected';

export interface DocumentReview {
  status: DocumentStatus;
  reason: string | null;
  by: string | null;
  at: Date | null;
  /** The value that was reviewed — a re-upload makes it pending again. */
  sig: string;
}

export interface AdminEdit {
  field: string;
  old_value: unknown;
  new_value: unknown;
  by: string;
  at: Date;
}

/**
 * `vistar_onboarding_data` — one per partner, written again and again from the
 * app as the form is filled. Generic fields at the top; everything the form
 * collects goes into `raw_data` (any shape the config's field types allow).
 * Mapped onto `vistaar_v2_agents` when HO approves.
 */
@Schema({
  collection: 'vistaar_v2_onboarding_data',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  versionKey: false,
  minimize: false,
})
export class OnboardingData {
  @Prop({ type: String }) _id!: string;
  /** `vistaar_v2_agents._id`. */
  @Prop({ type: String, required: true }) agent_ref!: string;
  @Prop({ type: String, required: true }) agent_id!: string;
  @Prop({ type: String, required: true }) pii_id!: string;

  @Prop({ type: String, required: true }) cohort!: string;
  @Prop({ type: String, required: true }) config_id!: string;
  @Prop({ type: Number, required: true }) config_version!: number;

  @Prop({ type: SchemaTypes.Mixed, default: {} }) raw_data!: RawData;

  @Prop({ type: String, default: null }) current_step!: string | null;
  @Prop({ type: [String], default: [] }) completed_steps!: string[];
  @Prop({ type: Number, default: 0 }) completion_pct!: number;

  /** Per KYC document field key. */
  @Prop({ type: SchemaTypes.Mixed, default: {} }) documents_review!: Record<
    string,
    DocumentReview
  >;
  /** HO's note per field when asking for changes; only these fields are editable then. */
  @Prop({ type: SchemaTypes.Mixed, default: {} }) remarks!: Record<
    string,
    string
  >;

  /** Copied from the form's GPS field, for the nearby-network check. */
  @Prop({ type: SchemaTypes.Mixed, default: undefined }) location?: GeoPoint;

  @Prop({ type: Date, default: null }) submitted_at!: Date | null;
  @Prop({ type: Number, default: 0 }) submit_count!: number;

  @Prop({ type: [SchemaTypes.Mixed], default: [] }) updated_data!: AdminEdit[];

  /** Normalised Aadhaar (hash) and PAN from `raw_data`, for the duplicate check across partners. */
  @Prop({ type: SchemaTypes.Mixed, default: undefined }) id_keys?: IdKeys;

  /** The partner's latest request to change the payout account (one pending at a time). */
  @Prop({ type: SchemaTypes.Mixed, default: undefined })
  bank_change?: BankChange;

  @Prop({ type: String, default: 'vistaar_app' }) source!: string;
  @Prop({ type: String, default: 'self' }) created_by!: string;
  @Prop({ type: String, default: 'self' }) updated_by!: string;
  /** Bumped on every write; a save that read an older one retries instead of overwriting. */
  @Prop({ type: Number, default: 0 }) version!: number;

  created_at!: Date;
  updated_at!: Date;
}

export type OnboardingDataDocument = HydratedDocument<OnboardingData>;
export const OnboardingDataSchema =
  SchemaFactory.createForClass(OnboardingData);

OnboardingDataSchema.index({ agent_ref: 1 }, { unique: true });
OnboardingDataSchema.index({ location: '2dsphere' });
// Not unique: the save refuses a clash, and beta may already hold duplicates.
OnboardingDataSchema.index(
  { 'id_keys.aadhaar_hash': 1 },
  { partialFilterExpression: { 'id_keys.aadhaar_hash': { $exists: true } } },
);
OnboardingDataSchema.index(
  { 'id_keys.pan': 1 },
  { partialFilterExpression: { 'id_keys.pan': { $exists: true } } },
);
