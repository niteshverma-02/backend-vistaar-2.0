import {
  Prop,
  Schema,
  SchemaFactory,
  type DiscriminatorOptions,
  type ModelDefinition,
} from '@nestjs/mongoose';

import { StoryDesign, StoryDesignSchema } from './story-design.schema';
import { StoryFestival, StoryFestivalSchema } from './story-festival.schema';
import { StorySample, StorySampleSchema } from './story-sample.schema';
import { StoryTemplateRow, StoryTemplateSchema } from './story-template.schema';

/** The HO-written My Story content, one discriminator per kind. */
export const STORY_CONTENT_KINDS = [
  'design',
  'festival',
  'sample',
  'template',
] as const;
export type StoryContentKind = (typeof STORY_CONTENT_KINDS)[number];

/**
 * One collection for the four kinds of My Story content HO writes — each a
 * few rows, read whole into a ≤ 60 s cache. Every kind is a discriminator
 * model on this base, so its queries always carry `kind`: a festival key
 * never answers as a design.
 *
 * Indexes live here and only here: Mongoose builds a base schema's indexes
 * from the base model alone, and each discriminator then has none of its own
 * to diff or build.
 */
@Schema({
  collection: 'vistaar_v2_story_content',
  discriminatorKey: 'kind',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  versionKey: false,
})
export class StoryContent {
  /**
   * `<kind>:<id>`, where id is what the API shows (a UUID, or a card's key):
   * a card keyed like another kind's id can never take its row.
   */
  @Prop({ type: String }) _id!: string;
  @Prop({ type: String, required: true, enum: STORY_CONTENT_KINDS })
  kind!: StoryContentKind;
  /** Unique within a kind; a card's key is its API id. */
  @Prop({ type: String, required: true }) key!: string;
  @Prop({ type: Number, default: 0 }) order!: number;
  @Prop({ type: Boolean, default: true }) is_active!: boolean;
  created_at!: Date;
  updated_at!: Date;
}

export const StoryContentSchema = SchemaFactory.createForClass(StoryContent);

StoryContentSchema.index({ kind: 1, key: 1 }, { unique: true });
StoryContentSchema.index({ kind: 1, is_active: 1, order: 1 });

/**
 * For `MongooseModule.forFeature`: the base model, and one model per kind
 * whose `value` is the `kind` its rows carry.
 */
export const STORY_CONTENT_MODEL = {
  name: StoryContent.name,
  schema: StoryContentSchema,
  discriminators: [
    { name: StoryDesign.name, schema: StoryDesignSchema, value: 'design' },
    {
      name: StoryFestival.name,
      schema: StoryFestivalSchema,
      value: 'festival',
    },
    { name: StorySample.name, schema: StorySampleSchema, value: 'sample' },
    {
      name: StoryTemplateRow.name,
      schema: StoryTemplateSchema,
      value: 'template',
    },
  ] satisfies (DiscriminatorOptions & { value: StoryContentKind })[],
} satisfies ModelDefinition;
