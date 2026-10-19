import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

/**
 * `vistaar_v2_order_ids` — every `KSV-` number handed out, and the checkout
 * attempt it went to. The app's `request_id` makes a retry or a double tap
 * get the same number back instead of spending another one. Never deleted:
 * a number given out is never given again.
 */
@Schema({
  collection: 'vistaar_v2_order_ids',
  timestamps: { createdAt: 'created_at', updatedAt: false },
  versionKey: false,
})
export class OrderId {
  /**
   * `<agent_id>:<request_id>`. One number per checkout attempt rests on `_id`
   * alone — always unique, so two copies of one request racing can never both
   * keep a number, even where a declared index was never built.
   */
  @Prop({ type: String }) _id!: string;
  /** The order number, `KSV-n`. */
  @Prop({ type: String, required: true }) order_id!: string;
  /** The partner it was issued to (`VST-…`). */
  @Prop({ type: String, required: true }) agent_id!: string;
  /** The app's id for one checkout attempt. */
  @Prop({ type: String, required: true }) request_id!: string;

  created_at!: Date;
}

export type OrderIdRecord = Pick<
  OrderId,
  '_id' | 'order_id' | 'agent_id' | 'request_id' | 'created_at'
>;
export type OrderIdDocument = HydratedDocument<OrderId>;
export const OrderIdSchema = SchemaFactory.createForClass(OrderId);

// Support: which attempt got this number. Uniqueness comes from the counter.
OrderIdSchema.index({ order_id: 1 });
