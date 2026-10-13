import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument } from 'mongoose';

/**
 * A ready-made farmer quote for the "Farmer story" template, written by HO.
 * Vistaar's own — never shown on a product page, unlike `product_testimonials`.
 */
@Schema({
  collection: 'vistaar_v2_story_samples',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  versionKey: false,
})
export class StorySample {
  /** UUID. */
  @Prop({ type: String }) _id!: string;
  /** Stable key, e.g. `wheat_humic_lucknow`; a saved story's `selection.testimonial_id`. */
  @Prop({ type: String, required: true }) key!: string;
  @Prop({ type: String, required: true }) name!: string;
  @Prop({ type: String, default: null }) village!: string | null;
  @Prop({ type: String, default: null }) district!: string | null;
  @Prop({ type: String, default: null }) state!: string | null;
  @Prop({ type: String, required: true }) product!: string;
  @Prop({ type: String, default: null }) crop!: string | null;
  @Prop({ type: String, required: true }) quote!: string;
  /** 1–5. */
  @Prop({ type: Number, default: 5 }) stars!: number;
  /** Lower first. */
  @Prop({ type: Number, default: 0 }) order!: number;
  @Prop({ type: Boolean, default: true }) is_active!: boolean;
  @Prop({ type: String }) created_by!: string;
  @Prop({ type: String }) updated_by!: string;
  created_at!: Date;
  updated_at!: Date;
}

export type StorySampleDocument = HydratedDocument<StorySample>;
export const StorySampleSchema = SchemaFactory.createForClass(StorySample);

StorySampleSchema.index({ key: 1 }, { unique: true });
StorySampleSchema.index({ is_active: 1, order: 1 });
