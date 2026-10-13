import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, type HydratedDocument } from 'mongoose';

import {
  PHOTO_MODES,
  STORY_LANGS,
  STORY_TEMPLATES,
  type PhotoMode,
  type StoryFields,
  type StoryLang,
  type StorySelection,
  type StoryTemplate,
  type StoryTheme,
} from '../stories.domain';

/** One of a partner's saved stories ("My stories"); at most 20 per partner. */
@Schema({
  collection: 'vistaar_v2_stories',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  versionKey: false,
})
export class Story {
  /** UUID. */
  @Prop({ type: String }) _id!: string;
  /** The partner's `VST-` id, from the token. */
  @Prop({ type: String, required: true }) agent_id!: string;
  /** `signatureOf(config, photo_path)` — a re-save of the same story finds this row. */
  @Prop({ type: String, required: true }) signature!: string;
  @Prop({ type: String, enum: STORY_TEMPLATES, required: true })
  template!: StoryTemplate;
  @Prop({ type: String, enum: STORY_LANGS, required: true }) lang!: StoryLang;
  /** A design key; the design may since have been removed — the image stays. */
  @Prop({ type: String, required: true }) theme!: StoryTheme;
  @Prop({ type: SchemaTypes.Mixed, required: true }) fields!: StoryFields;
  /** HO's custom card it was made from; null = the layout's own card. */
  @Prop({ type: String, default: null }) card!: string | null;
  @Prop({ type: Boolean, default: true }) show_whatsapp!: boolean;
  @Prop({ type: String, enum: PHOTO_MODES, default: 'inset' })
  photo_mode!: PhotoMode;
  @Prop({ type: SchemaTypes.Mixed, default: null })
  selection!: StorySelection | null;
  /** The finished 9:16 image, private, under `vistaar/stories/<agent_id>/`. */
  @Prop({ type: String, required: true }) image_path!: string;
  @Prop({ type: Number, default: null }) image_width!: number | null;
  @Prop({ type: Number, default: null }) image_height!: number | null;
  /** The partner's own photo it was drawn on, if any. */
  @Prop({ type: String, default: null }) photo_path!: string | null;
  @Prop({ type: Number, default: 0 }) share_count!: number;
  @Prop({ type: Date, default: null }) last_shared_at!: Date | null;
  /** List order: saving or sharing it again brings it to the top. */
  @Prop({ type: Date, required: true }) last_used_at!: Date;
  created_at!: Date;
  updated_at!: Date;
}

export type StoryDocument = HydratedDocument<Story>;
export const StorySchema = SchemaFactory.createForClass(Story);

// One row per story per partner, so a double tap or a retry never adds a copy.
StorySchema.index({ agent_id: 1, signature: 1 }, { unique: true });
// The partner's list, newest first.
StorySchema.index({ agent_id: 1, last_used_at: -1 });
