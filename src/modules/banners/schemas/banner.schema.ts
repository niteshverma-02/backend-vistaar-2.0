import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, type HydratedDocument } from 'mongoose';

import type { Localized } from '@modules/onboarding/form.domain';

import { BANNER_TONES, type BannerTone } from '../banners.domain';

/** One slide of the app's Home carousel, written by HO. */
@Schema({
  collection: 'vistaar_v2_banners',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  versionKey: false,
})
export class Banner {
  /** UUID. */
  @Prop({ type: String }) _id!: string;
  /** Drawn on a text banner; on an image banner, its name and screen-reader label. */
  @Prop({ type: SchemaTypes.Mixed, required: true }) title!: Localized;
  /** Required without an image. */
  @Prop({ type: SchemaTypes.Mixed, default: null })
  subtitle!: Localized | null;
  /** The button text, e.g. "Book now". Required without an image. */
  @Prop({ type: SchemaTypes.Mixed, default: null }) cta!: Localized | null;
  /** HO's own art under `vistaar/banners/`; set, the app shows it instead of drawing the banner. */
  @Prop({ type: String, default: null }) image_path!: string | null;
  /** Its download URL, kept so the app's read never touches storage. */
  @Prop({ type: String, default: null }) image_url!: string | null;
  @Prop({ type: Number, default: null }) image_width!: number | null;
  @Prop({ type: Number, default: null }) image_height!: number | null;
  /** In-app route the tap opens. */
  @Prop({ type: String, required: true }) link!: string;
  @Prop({ type: String, enum: BANNER_TONES, default: 'primary' })
  tone!: BannerTone;
  @Prop({ type: String, default: null }) emoji!: string | null;
  /** Cohort keys that see it; empty means every partner. */
  @Prop({ type: [String], default: [] }) cohorts!: string[];
  @Prop({ type: Date, default: null }) starts_at!: Date | null;
  @Prop({ type: Date, default: null }) ends_at!: Date | null;
  /** Lower first. */
  @Prop({ type: Number, default: 0 }) order!: number;
  @Prop({ type: Boolean, default: true }) is_active!: boolean;
  @Prop({ type: String }) created_by!: string;
  @Prop({ type: String }) updated_by!: string;
  created_at!: Date;
  updated_at!: Date;
}

export type BannerDocument = HydratedDocument<Banner>;
export const BannerSchema = SchemaFactory.createForClass(Banner);

// The app's read: active rows not yet ended, in carousel order.
BannerSchema.index({ is_active: 1, order: 1 });
