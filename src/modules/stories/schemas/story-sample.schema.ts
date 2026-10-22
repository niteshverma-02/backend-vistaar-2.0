import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/**
 * A ready-made farmer quote for the "Farmer story" template, written by HO.
 * Vistaar's own — never shown on a product page, unlike `product_testimonials`.
 *
 * The `sample` kind of `vistaar_v2_story_content`; collection, timestamps and
 * indexes come from `StoryContent`.
 */
@Schema()
export class StorySample {
  /** UUID — the API's id; stored as `sample:<uuid>`. */
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

export const StorySampleSchema = SchemaFactory.createForClass(StorySample);
