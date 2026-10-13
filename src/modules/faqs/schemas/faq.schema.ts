import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument } from 'mongoose';

/** One help FAQ, written by HO. */
@Schema({
  collection: 'vistaar_v2_faqs',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  versionKey: false,
})
export class Faq {
  /** UUID. */
  @Prop({ type: String }) _id!: string;
  /** A `vistaar_v2_faq_sections` key. */
  @Prop({ type: String, required: true }) category!: string;
  @Prop({ type: String, required: true }) q!: string;
  @Prop({ type: String, required: true }) a!: string;
  /** `questionKey(q)`; unique, so the same question cannot be added twice. */
  @Prop({ type: String, required: true }) q_key!: string;
  /** Lower first. */
  @Prop({ type: Number, default: 0 }) order!: number;
  @Prop({ type: Boolean, default: true }) is_active!: boolean;
  @Prop({ type: String }) created_by!: string;
  @Prop({ type: String }) updated_by!: string;
  created_at!: Date;
  updated_at!: Date;
}

export type FaqDocument = HydratedDocument<Faq>;
export const FaqSchema = SchemaFactory.createForClass(Faq);

FaqSchema.index({ q_key: 1 }, { unique: true });
FaqSchema.index({ is_active: 1, order: 1 });
FaqSchema.index({ category: 1, order: 1 });
