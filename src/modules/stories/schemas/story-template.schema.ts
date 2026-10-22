import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes } from 'mongoose';

import type { Localized } from '@modules/onboarding/form.domain';

import type {
  StoryTemplate,
  TemplateFields,
  TemplateTexts,
} from '../stories.domain';

/**
 * A "Choose a design" card in My Story: one of the six built-in ones, or a
 * custom card HO made on one of their layouts.
 *
 * The `template` kind of `vistaar_v2_story_content`; collection, timestamps
 * and indexes come from `StoryContent`, which also stores the card key as
 * `key` (never part of this row as the API sees it).
 */
@Schema()
export class StoryTemplateRow {
  /**
   * Card key: a layout name for the six built-in cards, else HO's own
   * (`diwali_offer`). Stored as `template:<key>`.
   */
  @Prop({ type: String }) _id!: string;
  /** The layout the app draws it with. */
  @Prop({ type: String, required: true }) base!: StoryTemplate;
  /** One of the six: editable and hideable, never deleted. */
  @Prop({ type: Boolean, default: false }) builtin!: boolean;
  /** Card title, e.g. `{ en: 'Product offer', hi: 'प्रोडक्ट ऑफ़र' }`. */
  @Prop({ type: SchemaTypes.Mixed, required: true }) label!: Localized;
  /** Card subtitle, e.g. `{ en: 'Price vs MRP, % off' }`. */
  @Prop({ type: SchemaTypes.Mixed, required: true }) hint!: Localized;
  /** Words printed on the story, per language; `en` required. */
  @Prop({ type: SchemaTypes.Mixed, required: true })
  texts!: Record<string, TemplateTexts>;
  /** Text the card pre-fills, per language, over the layout's defaults. */
  @Prop({ type: SchemaTypes.Mixed, default: {} })
  fields!: Record<string, TemplateFields>;
  /** Icons offered for the story's emoji. */
  @Prop({ type: [String], default: [] }) emojis!: string[];
  /** Design key the card opens in; null = keep the partner's current design. */
  @Prop({ type: String, default: null }) default_design!: string | null;
  /** Leads the strip with a "Suggested" badge. */
  @Prop({ type: Boolean, default: false }) suggested!: boolean;
  /** Offered from / until; null = no bound (a Diwali card for Diwali weeks). */
  @Prop({ type: Date, default: null }) starts_at!: Date | null;
  @Prop({ type: Date, default: null }) ends_at!: Date | null;
  /** Lower first in the strip (after the suggested cards). */
  @Prop({ type: Number, default: 0 }) order!: number;
  /** Hidden cards leave the strip; saved stories made with one still open. */
  @Prop({ type: Boolean, default: true }) is_active!: boolean;
  @Prop({ type: String }) created_by!: string;
  @Prop({ type: String }) updated_by!: string;
  created_at!: Date;
  updated_at!: Date;
}

export const StoryTemplateSchema =
  SchemaFactory.createForClass(StoryTemplateRow);
