import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument } from 'mongoose';

import {
  CROP_SEASONS,
  type CropSeason,
  type CropStage,
} from '../crop-calendar.domain';

/** One crop's calendar, written by HO. */
@Schema({
  collection: 'vistaar_v2_crop_calendar',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  versionKey: false,
})
export class CropCalendarEntry {
  /** The crop key, e.g. `wheat`; never changes. */
  @Prop({ type: String }) _id!: string;
  /** Display name, e.g. `Wheat`. */
  @Prop({ type: String, required: true }) crop!: string;
  @Prop({ type: String, default: null }) emoji!: string | null;
  @Prop({ type: String, enum: CROP_SEASONS, required: true })
  season!: CropSeason;
  /** Month range, e.g. `Nov – Dec`. */
  @Prop({ type: String, required: true }) sowing!: string;
  @Prop({ type: String, required: true }) harvest!: string;
  @Prop({
    type: [
      {
        _id: false,
        stage: String,
        month: String,
        advice: String,
        products: [String],
      },
    ],
    default: [],
  })
  stages!: CropStage[];
  /** Lower first. */
  @Prop({ type: Number, default: 0 }) order!: number;
  @Prop({ type: Boolean, default: true }) is_active!: boolean;
  @Prop({ type: String }) created_by!: string;
  @Prop({ type: String }) updated_by!: string;
  created_at!: Date;
  updated_at!: Date;
}

export type CropCalendarDocument = HydratedDocument<CropCalendarEntry>;
export const CropCalendarSchema =
  SchemaFactory.createForClass(CropCalendarEntry);

CropCalendarSchema.index({ is_active: 1, order: 1 });
