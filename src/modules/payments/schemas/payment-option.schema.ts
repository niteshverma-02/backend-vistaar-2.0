import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

import { PAYMENT_PROVIDERS, type PaymentProvider } from '../payments.domain';

/**
 * HO's setting for one online payment option. A provider with no row yet is
 * off; the row is written at HO's first save. Holds no merchant key or URL.
 */
@Schema({
  collection: 'vistaar_v2_payment_options',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  versionKey: false,
})
export class PaymentOption {
  @Prop({ type: String, enum: PAYMENT_PROVIDERS }) _id!: PaymentProvider;
  @Prop({ type: String, required: true }) label!: string;
  @Prop({ type: String, default: null }) hint!: string | null;
  @Prop({ type: Boolean, default: false }) is_active!: boolean;
  /** Lower first. */
  @Prop({ type: Number, default: 0 }) order!: number;
  /** Cohort keys that see it; empty means every partner. */
  @Prop({ type: [String], default: [] }) cohorts!: string[];
  /** Optimistic lock: every write is conditional on the version HO read. */
  @Prop({ type: Number, default: 1 }) version!: number;
  @Prop({ type: String }) updated_by!: string;
  created_at!: Date;
  updated_at!: Date;
}

export type PaymentOptionDocument = HydratedDocument<PaymentOption>;
export const PaymentOptionSchema = SchemaFactory.createForClass(PaymentOption);
// Three rows at most, read whole — `_id` is the only index needed.
