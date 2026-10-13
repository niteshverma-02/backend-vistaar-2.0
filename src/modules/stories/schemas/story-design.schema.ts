import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, type HydratedDocument } from 'mongoose';

import type { Localized } from '@modules/onboarding/form.domain';

import type { DesignColors, StoryTemplate } from '../stories.domain';

/**
 * A look the partner can pick for a story: colours, and optionally HO's own
 * 9:16 art drawn behind the text. A saved story keeps the design's `key`.
 */
@Schema({
  collection: 'vistaar_v2_story_designs',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  versionKey: false,
})
export class StoryDesign {
  /** UUID. */
  @Prop({ type: String }) _id!: string;
  /** Stable key a saved story's `theme` keeps, e.g. `green`, `diwali_lights`. */
  @Prop({ type: String, required: true }) key!: string;
  /** Picker label, e.g. `{ en: 'Diwali lights', hi: 'दीवाली रोशनी' }`. */
  @Prop({ type: SchemaTypes.Mixed, required: true }) label!: Localized;
  /** Always the full palette — `completeColors` fills what HO left out. */
  @Prop({ type: SchemaTypes.Mixed, required: true }) colors!: DesignColors;
  /** HO's art, public under `vistaar/story-designs/`; null = colours only. */
  @Prop({ type: String, default: null }) image_path!: string | null;
  @Prop({ type: String, default: null }) image_url!: string | null;
  @Prop({ type: Number, default: null }) image_width!: number | null;
  @Prop({ type: Number, default: null }) image_height!: number | null;
  /** 0–0.9 of `bg_from` laid over the art so text reads; ignored without art. */
  @Prop({ type: Number, default: 0 }) overlay!: number;
  /** Templates it is offered on; empty = all. */
  @Prop({ type: [String], default: [] }) templates!: StoryTemplate[];
  /** Offered from / until; null = no bound (a Diwali look for Diwali week). */
  @Prop({ type: Date, default: null }) starts_at!: Date | null;
  @Prop({ type: Date, default: null }) ends_at!: Date | null;
  /** Lower first in the picker; the first live one is the app's default. */
  @Prop({ type: Number, default: 0 }) order!: number;
  @Prop({ type: Boolean, default: true }) is_active!: boolean;
  @Prop({ type: String }) created_by!: string;
  @Prop({ type: String }) updated_by!: string;
  created_at!: Date;
  updated_at!: Date;
}

export type StoryDesignDocument = HydratedDocument<StoryDesign>;
export const StoryDesignSchema = SchemaFactory.createForClass(StoryDesign);

StoryDesignSchema.index({ key: 1 }, { unique: true });
StoryDesignSchema.index({ is_active: 1, order: 1 });
