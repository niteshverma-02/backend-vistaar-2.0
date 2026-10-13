import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, type HydratedDocument } from 'mongoose';

import { INFO_PAGES, type InfoPageKey } from '../info-pages.domain';

/**
 * One info page's text, edited by HO. `content`'s shape depends on the page
 * and is checked by that page's DTO before it is written.
 */
@Schema({
  collection: 'vistaar_v2_info_pages',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  versionKey: false,
})
export class InfoPage {
  @Prop({ type: String, enum: INFO_PAGES }) _id!: InfoPageKey;
  @Prop({ type: SchemaTypes.Mixed, required: true }) content!: unknown;
  /** 1 on the first save, +1 on each; a save names the one it was made from. */
  @Prop({ type: Number, required: true }) version!: number;
  @Prop({ type: String }) created_by!: string;
  @Prop({ type: String }) updated_by!: string;
  created_at!: Date;
  updated_at!: Date;
}

export type InfoPageDocument = HydratedDocument<InfoPage>;
export const InfoPageSchema = SchemaFactory.createForClass(InfoPage);
