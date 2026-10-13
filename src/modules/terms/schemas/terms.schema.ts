import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument, type Types } from 'mongoose';

/**
 * A row of the shared `terms_and_conditions` collection (Krishi Sampark,
 * B2B Portal, RLM and Vistaar each have theirs). The shape is the existing
 * one, field for field — no Vistaar-only fields — and `__v` stays because
 * the other writers keep it. No index is declared here: the collection is not
 * ours, and its `{toc_id}` unique and `{profiles, is_active}` indexes already
 * exist.
 */
@Schema({ collection: 'terms_and_conditions' })
export class TermsAndConditions {
  _id!: Types.ObjectId;
  @Prop({ type: String, required: true }) toc_id!: string;
  @Prop({ type: String, required: true }) title!: string;
  /** The full document (docx / pdf) in the org bucket. */
  @Prop({ type: String, required: true }) link!: string;
  @Prop({ type: [String], default: [] }) profiles!: string[];
  @Prop({ type: Boolean, default: true }) is_active!: boolean;
  /**
   * Mongoose's own counter, already on every row. For a Vistaar row it is the
   * document's edit count: +1 each time its text, title or link changes, so
   * the version partners see is `__v + 1` under the same `toc_id`.
   */
  __v!: number;
}

export type TermsHydrated = HydratedDocument<TermsAndConditions>;
export const TermsSchema = SchemaFactory.createForClass(TermsAndConditions);
