import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

/**
 * `addresses` — one row per address, `ADDR-n` from `app_counters.addresses`,
 * listed on the person's `piis.addresses[]`. ko-sales owns it. Vistaar writes
 * only rows it filed itself (`source`), in prasar-backend's field names.
 *
 * No index is declared: ko-sales already keeps `address_id` unique and
 * `pii_id` indexed.
 */
@Schema({ collection: 'addresses', autoIndex: false })
export class Address {
  @Prop({ type: String, required: true }) address_id!: string;
  @Prop({ type: String, required: true }) pii_id!: string;
  @Prop({ type: String, default: '' }) address_line!: string;
  @Prop({ type: String, default: null }) village!: string | null;
  @Prop({ type: String, default: null }) district!: string | null;
  @Prop({ type: String, default: '' }) city!: string;
  @Prop({ type: String, default: '' }) state!: string;
  @Prop({ type: String, default: '' }) zipcode!: string;
  @Prop({ type: String, default: 'India' }) country!: string;
  @Prop({ type: Boolean, default: false }) is_primary!: boolean;
  @Prop({ type: String, default: null }) source!: string | null;
  @Prop({ type: String, default: null }) created_by!: string | null;
  @Prop({ type: Date }) created_at!: Date;
  @Prop({ type: Date }) updated_at!: Date;
}

export type AddressDocument = HydratedDocument<Address>;
export const AddressSchema = SchemaFactory.createForClass(Address);
