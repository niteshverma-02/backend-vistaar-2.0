import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument } from 'mongoose';

/** One FAQ section (a category chip on the app's FAQs screen), written by HO. */
@Schema({
  collection: 'vistaar_v2_faq_sections',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  versionKey: false,
})
export class FaqSection {
  /** The key, e.g. `payments`; a FAQ's `category`. Never changes. */
  @Prop({ type: String }) _id!: string;
  /** Chip text, e.g. `Payments`. */
  @Prop({ type: String, required: true }) label!: string;
  @Prop({ type: String, default: null }) emoji!: string | null;
  /** Lower first. */
  @Prop({ type: Number, default: 0 }) order!: number;
  /** `false` hides the section and every FAQ in it from the app. */
  @Prop({ type: Boolean, default: true }) is_active!: boolean;
  @Prop({ type: String }) created_by!: string;
  @Prop({ type: String }) updated_by!: string;
  created_at!: Date;
  updated_at!: Date;
}

export type FaqSectionDocument = HydratedDocument<FaqSection>;
export const FaqSectionSchema = SchemaFactory.createForClass(FaqSection);

FaqSectionSchema.index({ is_active: 1, order: 1 });
