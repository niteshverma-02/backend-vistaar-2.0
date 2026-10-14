import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

/** `pincode_map_v2` — ko-sales' India Post pincode book. Read-only here. */
@Schema({ collection: 'pincode_map_v2', autoIndex: false })
export class Pincode {
  @Prop({ type: String }) pincode!: string;
  @Prop({ type: String }) state?: string;
  @Prop({ type: String }) district?: string;
  @Prop({ type: String }) taluk?: string;
  /** The pincode area's centre (India Post); missing on a few. */
  @Prop({ type: Object }) geo?: { lat?: number | null; lng?: number | null };
}

export type PincodeDocument = HydratedDocument<Pincode>;
export const PincodeSchema = SchemaFactory.createForClass(Pincode);
