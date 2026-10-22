import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes } from 'mongoose';

import type { Localized } from '@modules/onboarding/form.domain';

import type { FestivalText } from '../stories.domain';

/**
 * A greeting the Festival template offers, written by HO.
 *
 * The `festival` kind of `vistaar_v2_story_content`; collection, timestamps
 * and indexes come from `StoryContent`.
 */
@Schema()
export class StoryFestival {
  /** UUID — the API's id; stored as `festival:<uuid>`. */
  @Prop({ type: String }) _id!: string;
  /** Stable key a saved story's `selection.festival` keeps, e.g. `diwali`. */
  @Prop({ type: String, required: true }) key!: string;
  /** Picker label, e.g. `{ en: 'Diwali', hi: 'दीपावली' }`. */
  @Prop({ type: SchemaTypes.Mixed, required: true }) label!: Localized;
  @Prop({ type: String, required: true }) emoji!: string;
  /** Pre-filled text per language; `en` required. */
  @Prop({ type: SchemaTypes.Mixed, required: true })
  text!: Record<string, FestivalText>;
  /** Offered from / until; null = no bound. */
  @Prop({ type: Date, default: null }) starts_at!: Date | null;
  @Prop({ type: Date, default: null }) ends_at!: Date | null;
  /** Lower first in the picker. */
  @Prop({ type: Number, default: 0 }) order!: number;
  @Prop({ type: Boolean, default: true }) is_active!: boolean;
  @Prop({ type: String }) created_by!: string;
  @Prop({ type: String }) updated_by!: string;
  created_at!: Date;
  updated_at!: Date;
}

export const StoryFestivalSchema = SchemaFactory.createForClass(StoryFestival);
