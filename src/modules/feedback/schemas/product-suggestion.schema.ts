import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, type HydratedDocument } from 'mongoose';

import { SUGGESTION_STATUSES, type SuggestionStatus } from '../feedback.domain';
import type { PartnerSnapshot } from './feedback.schema';

/** "Suggest a product": something farmers ask a partner for that Katyayani does not sell. */
@Schema({
  collection: 'vistaar_v2_product_suggestions',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  versionKey: false,
})
export class ProductSuggestion {
  /** `SUG-000123` — the reference the partner's toast shows. */
  @Prop({ type: String }) _id!: string;
  @Prop({ type: String, required: true }) agent_id!: string;
  @Prop({ type: SchemaTypes.Mixed, required: true }) partner!: PartnerSnapshot;
  @Prop({ type: String, required: true }) product!: string;
  /** `productKey(product)` — the same ask, however it was typed. */
  @Prop({ type: String, required: true }) product_key!: string;
  @Prop({ type: String, default: null }) crop!: string | null;
  /** Free text as typed, e.g. "50 packs". */
  @Prop({ type: String, default: null }) monthly_demand!: string | null;
  @Prop({ type: String, default: null }) note!: string | null;
  @Prop({ type: String, enum: SUGGESTION_STATUSES, default: 'new' })
  status!: SuggestionStatus;
  /** HO's note to the product team. */
  @Prop({ type: String, default: null }) ho_note!: string | null;
  @Prop({ type: String, default: null }) updated_by!: string | null;
  created_at!: Date;
  updated_at!: Date;
}

export type ProductSuggestionDocument = HydratedDocument<ProductSuggestion>;
export const ProductSuggestionSchema =
  SchemaFactory.createForClass(ProductSuggestion);

ProductSuggestionSchema.index({ agent_id: 1, created_at: -1 });
ProductSuggestionSchema.index({ status: 1, created_at: -1 });
ProductSuggestionSchema.index({ created_at: -1 });
// "Most asked for" groups on this.
ProductSuggestionSchema.index({ product_key: 1, created_at: -1 });
