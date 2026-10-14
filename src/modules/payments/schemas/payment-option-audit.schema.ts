import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, type HydratedDocument } from 'mongoose';

export const PAYMENT_AUDIT_ACTIONS = [
  'update',
  'reorder',
  'credentials_submitted',
  'credentials_tested',
  'credentials_approved',
  'credentials_rejected',
  'credentials_revoked',
] as const;
export type PaymentAuditAction = (typeof PAYMENT_AUDIT_ACTIONS)[number];

/**
 * Who changed which payment option, and from what to what. Insert-only and
 * never deleted: money settings need an answer to "who switched this on".
 * Credential rows carry ids and masked values only, never a secret.
 */
@Schema({ collection: 'vistaar_v2_payment_option_audit', versionKey: false })
export class PaymentOptionAudit {
  /** UUID. */
  @Prop({ type: String }) _id!: string;
  /** The provider, or `*` for a reorder of all of them. */
  @Prop({ type: String, required: true }) option_id!: string;
  @Prop({ type: String, enum: PAYMENT_AUDIT_ACTIONS, required: true })
  action!: PaymentAuditAction;
  @Prop({ type: SchemaTypes.Mixed, default: null })
  before!: Record<string, unknown> | null;
  @Prop({ type: SchemaTypes.Mixed, required: true })
  after!: Record<string, unknown>;
  /** HO's SSO email. */
  @Prop({ type: String, required: true }) by!: string;
  @Prop({ type: Date, required: true }) at!: Date;
}

export type PaymentOptionAuditDocument = HydratedDocument<PaymentOptionAudit>;
export const PaymentOptionAuditSchema =
  SchemaFactory.createForClass(PaymentOptionAudit);

// The HO log: newest first, all options or one.
PaymentOptionAuditSchema.index({ at: -1 });
PaymentOptionAuditSchema.index({ option_id: 1, at: -1 });
