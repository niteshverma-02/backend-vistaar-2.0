import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, type HydratedDocument } from 'mongoose';

import {
  CREDENTIAL_MODES,
  CREDENTIAL_STATUSES,
  type CredentialMode,
  type CredentialStatus,
} from '../payment-credentials.domain';
import { PAYMENT_PROVIDERS, type PaymentProvider } from '../payments.domain';
import type { SealedValue } from '../providers/credential-cipher';

export interface CredentialTest {
  ok: boolean;
  message: string;
  by: string;
  at: Date;
}

/**
 * One set of merchant keys for one provider, from submit to retirement.
 * `secrets` is sealed (see `CredentialCipher`) and set to `null` the moment
 * the set stops being pending or active.
 */
@Schema({
  collection: 'vistaar_v2_payment_credentials',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  versionKey: false,
})
export class PaymentCredential {
  /** UUID. */
  @Prop({ type: String }) _id!: string;
  @Prop({ type: String, enum: PAYMENT_PROVIDERS, required: true })
  provider!: PaymentProvider;
  @Prop({ type: String, enum: CREDENTIAL_MODES, required: true })
  mode!: CredentialMode;
  @Prop({ type: String, enum: CREDENTIAL_STATUSES, required: true })
  status!: CredentialStatus;
  /** Ids that are not secret (Key ID, App ID), shown in full. */
  @Prop({ type: SchemaTypes.Mixed, required: true })
  public_fields!: Record<string, string>;
  @Prop({ type: SchemaTypes.Mixed, default: null })
  secrets!: Record<string, SealedValue> | null;
  /** `••••abcd` per secret — the only form a secret is ever shown in. */
  @Prop({ type: SchemaTypes.Mixed, required: true })
  masked!: Record<string, string>;
  @Prop({ type: String, default: null }) note!: string | null;
  @Prop({ type: String, required: true }) submitted_by!: string;
  @Prop({ type: Date, required: true }) expires_at!: Date;
  @Prop({ type: SchemaTypes.Mixed, default: null })
  test!: CredentialTest | null;
  @Prop({ type: String, default: null }) decided_by!: string | null;
  @Prop({ type: Date, default: null }) decided_at!: Date | null;
  @Prop({ type: String, default: null }) reason!: string | null;
  @Prop({ type: Date, default: null }) activated_at!: Date | null;
  @Prop({ type: Date, default: null }) retired_at!: Date | null;
  @Prop({ type: String, default: null }) retired_by!: string | null;
  created_at!: Date;
  updated_at!: Date;
}

export type PaymentCredentialDocument = HydratedDocument<PaymentCredential>;
export const PaymentCredentialSchema =
  SchemaFactory.createForClass(PaymentCredential);

// At most one live set and one waiting set per provider, enforced by Mongo too.
PaymentCredentialSchema.index(
  { provider: 1 },
  {
    unique: true,
    name: 'one_active_per_provider',
    partialFilterExpression: { status: 'active' },
  },
);
// A different key from the one above: Mongo will not take two partial
// indexes on the same key everywhere.
PaymentCredentialSchema.index(
  { provider: 1, status: 1 },
  {
    unique: true,
    name: 'one_pending_per_provider',
    partialFilterExpression: { status: 'pending' },
  },
);
// HO's history of one provider, newest first.
PaymentCredentialSchema.index({ provider: 1, created_at: -1 });
