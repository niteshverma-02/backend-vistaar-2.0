import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

/** Coins one checkout attempt took off an order. */
@Schema({ _id: false, versionKey: false })
export class CoinRedemption {
  /** The checkout attempt's `x-request-id` (the same UUID as `POST /orders/id`). */
  @Prop({ type: String, required: true }) id!: string;
  @Prop({ type: Number, required: true }) coins!: number;
  /** False once released (the order was not placed); held again by a retry. */
  @Prop({ type: Boolean, required: true }) active!: boolean;
  @Prop({ type: Date, required: true }) at!: Date;
  @Prop({ type: Date, default: null }) released_at!: Date | null;
}

const CoinRedemptionSchema = SchemaFactory.createForClass(CoinRedemption);

/**
 * A partner's spent coins (user, 2026-10-23: "Use your coins" at checkout).
 * One document per partner, so a spend is one atomic update that checks the
 * balance — two orders at once can never spend the same coins. Approved
 * coins only grow (a decision moves pending rows only), so
 * `spent ≤ approved − coins` checked against a fresh total is safe.
 */
@Schema({
  collection: 'vistaar_v2_coin_accounts',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  versionKey: false,
  minimize: false,
})
export class CoinAccount {
  /** The partner (`VST-…`). */
  @Prop({ type: String }) _id!: string;
  /** Σ `coins` of the active redemptions. */
  @Prop({ type: Number, required: true, default: 0 }) spent!: number;
  @Prop({ type: [CoinRedemptionSchema], default: [] })
  redemptions!: CoinRedemption[];
  created_at!: Date;
  updated_at!: Date;
}

export type CoinAccountDocument = HydratedDocument<CoinAccount>;
export const CoinAccountSchema = SchemaFactory.createForClass(CoinAccount);
