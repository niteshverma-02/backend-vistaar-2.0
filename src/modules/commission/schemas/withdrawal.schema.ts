import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument } from 'mongoose';

export const WITHDRAWAL_STATUSES = [
  'requested',
  'approved',
  'paid',
  'rejected',
  'cancelled',
] as const;
export type WithdrawalStatus = (typeof WITHDRAWAL_STATUSES)[number];

/** Asked for and not yet paid or closed: holds the amount out of the balance. */
export const OPEN_STATUSES: readonly WithdrawalStatus[] = [
  'requested',
  'approved',
];

/**
 * A partner's request to be paid their confirmed commission. HO approves it,
 * pays it from the bank file and enters the UTR. Never deleted: it is the
 * payment record (TDS, Form 16A, the partner's statement).
 */
@Schema({
  collection: 'vistaar_v2_withdrawals',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  versionKey: false,
})
export class Withdrawal {
  /** `WD-000001`. */
  @Prop({ type: String }) _id!: string;
  @Prop({ type: String, required: true }) agent_id!: string;
  /** Whole ₹, before TDS. */
  @Prop({ type: Number, required: true }) amount!: number;
  @Prop({ type: String, required: true }) status!: WithdrawalStatus;
  /**
   * `true` while requested or approved, else unset: the partial unique index
   * on it allows one open withdrawal per partner.
   */
  @Prop({ type: Boolean }) open?: true;
  /** % — set at request, fixed at approval (PAN verified or not then). */
  @Prop({ type: Number, required: true }) tds_rate!: number;
  /** ₹ to the paisa. */
  @Prop({ type: Number, required: true }) tds_amount!: number;
  @Prop({ type: Number, required: true }) net_amount!: number;
  /** Last four digits of the account it goes to, for the partner's screen. */
  @Prop({ type: String, default: null }) account_last4!: string | null;

  @Prop({ type: Date, required: true }) requested_at!: Date;
  @Prop({ type: Date, default: null }) approved_at!: Date | null;
  @Prop({ type: String, default: null }) approved_by!: string | null;
  @Prop({ type: Date, default: null }) paid_at!: Date | null;
  @Prop({ type: String, default: null }) paid_by!: string | null;
  /** The bank's reference for the transfer. */
  @Prop({ type: String, default: null }) utr!: string | null;
  @Prop({ type: Date, default: null }) rejected_at!: Date | null;
  @Prop({ type: String, default: null }) rejected_by!: string | null;
  @Prop({ type: String, default: null }) rejection_reason!: string | null;
  @Prop({ type: Date, default: null }) cancelled_at!: Date | null;

  created_at!: Date;
  updated_at!: Date;
}

export type WithdrawalDocument = HydratedDocument<Withdrawal>;
export const WithdrawalSchema = SchemaFactory.createForClass(Withdrawal);

// The partner's wallet and statements.
WithdrawalSchema.index({ agent_id: 1, requested_at: -1 });
// HO's queues (requested, approved) and the paid-in-a-quarter reports.
WithdrawalSchema.index({ status: 1, requested_at: 1 });
WithdrawalSchema.index({ status: 1, paid_at: 1 });
// One open withdrawal per partner, even when two requests race.
WithdrawalSchema.index(
  { agent_id: 1 },
  { unique: true, partialFilterExpression: { open: true } },
);
