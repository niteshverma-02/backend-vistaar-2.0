import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument } from 'mongoose';

/**
 * A partner's Form 16A for one quarter, as HO downloads it from TRACES and
 * uploads it here. The file is private in the org bucket; the partner gets a
 * signed link in their TDS report.
 */
@Schema({
  collection: 'vistaar_v2_tds_certificates',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  versionKey: false,
})
export class TdsCertificate {
  /** `<agent_id>:<quarter>` — one certificate per partner and quarter. */
  @Prop({ type: String }) _id!: string;
  @Prop({ type: String, required: true }) agent_id!: string;
  /** `FY2026-Q2`. */
  @Prop({ type: String, required: true }) quarter!: string;
  @Prop({ type: String, required: true }) path!: string;
  @Prop({ type: String, required: true }) uploaded_by!: string;
  created_at!: Date;
  updated_at!: Date;
}

export type TdsCertificateDocument = HydratedDocument<TdsCertificate>;
export const TdsCertificateSchema =
  SchemaFactory.createForClass(TdsCertificate);

// HO's list of one quarter's certificates; the partner's is an `_id` read.
TdsCertificateSchema.index({ quarter: 1, agent_id: 1 });
