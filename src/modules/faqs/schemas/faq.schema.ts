import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument } from 'mongoose';

export const FAQ_ENTRY_KINDS = ['section', 'faq'] as const;
export type FaqEntryKind = (typeof FAQ_ENTRY_KINDS)[number];

function isSection(this: FaqEntry): boolean {
  return this.kind === 'section';
}

function isFaq(this: FaqEntry): boolean {
  return this.kind === 'faq';
}

/**
 * The app's FAQs screen, written by HO: its sections (the category chips) and
 * the FAQs in them, in one collection so `GET /faqs` is one read. Every query
 * names `kind`, so a section never comes back as a FAQ or the other way round.
 */
@Schema({
  collection: 'vistaar_v2_faqs',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  versionKey: false,
})
export class FaqEntry {
  /**
   * Section: its key, e.g. `payments` — a FAQ's `category`, never changes.
   * FAQ: a UUID. A key cannot hold a `-` (`SECTION_KEY`), so the two never meet.
   */
  @Prop({ type: String }) _id!: string;
  @Prop({ type: String, required: true, enum: FAQ_ENTRY_KINDS })
  kind!: FaqEntryKind;

  /** Section: chip text, e.g. `Payments`. */
  @Prop({ type: String, required: isSection }) label?: string;
  @Prop({ type: String }) emoji?: string | null;

  /** FAQ: its section's key. */
  @Prop({ type: String, required: isFaq }) category?: string;
  @Prop({ type: String, required: isFaq }) q?: string;
  @Prop({ type: String, required: isFaq }) a?: string;
  /** FAQ: `questionKey(q)`; unique among FAQs, so the same question cannot be added twice. */
  @Prop({ type: String, required: isFaq }) q_key?: string;

  /** Lower first. */
  @Prop({ type: Number, default: 0 }) order!: number;
  /** On a section, `false` hides it and every FAQ in it from the app. */
  @Prop({ type: Boolean, default: true }) is_active!: boolean;
  @Prop({ type: String }) created_by!: string;
  @Prop({ type: String }) updated_by!: string;
  created_at!: Date;
  updated_at!: Date;
}

type EntryCommon = Pick<
  FaqEntry,
  | '_id'
  | 'order'
  | 'is_active'
  | 'created_by'
  | 'updated_by'
  | 'created_at'
  | 'updated_at'
>;

/** A section row as the API returns it: `kind` left off, as before the merge. */
export type FaqSection = EntryCommon & { label: string; emoji: string | null };

/** A FAQ row as the API returns it: `kind` left off, as before the merge. */
export type Faq = EntryCommon & {
  category: string;
  q: string;
  a: string;
  q_key: string;
};

export type FaqEntryDocument = HydratedDocument<FaqEntry>;
export const FaqEntrySchema = SchemaFactory.createForClass(FaqEntry);

// Partial: a section has no question, and several of them would collide on null.
FaqEntrySchema.index(
  { q_key: 1 },
  { unique: true, partialFilterExpression: { kind: 'faq' } },
);
FaqEntrySchema.index({ is_active: 1, order: 1 });
FaqEntrySchema.index({ category: 1, order: 1 });
