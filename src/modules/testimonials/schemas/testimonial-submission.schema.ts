import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, type HydratedDocument, type Types } from 'mongoose';

import {
  SUBMISSION_KINDS,
  SUBMISSION_STATUSES,
  type SubmissionKind,
  type SubmissionStatus,
} from '../testimonials.domain';

/**
 * `vistaar_v2_testimonials` — one row per testimonial a partner sends in.
 * Everything Stockship's `product_reviews` / `product_testimonials` have no
 * field for lives here: who sent it, the farmer's place and crop, the decision
 * and its reason, the counters. The shared rows are written on approval, with
 * the ids reserved here at submit so a retried approval never writes twice.
 */
@Schema({
  collection: 'vistaar_v2_testimonials',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  versionKey: false,
  minimize: false,
})
export class TestimonialSubmission {
  /** UUID the app makes, so a retried submit finds the first one. */
  @Prop({ type: String }) _id!: string;
  /** The partner (`VST-…`), from the token. */
  @Prop({ type: String, required: true }) agent_id!: string;
  /** Copy for the library's "Shared by"; the partner's name when sent. */
  @Prop({ type: String, default: null }) partner_name!: string | null;

  /** The farmer — one of the partner's own leads. */
  @Prop({ type: String, required: true }) pii_id!: string;
  @Prop({ type: String, required: true }) farmer_name!: string;
  /** `+91…`, as Stockship stores `user.contact`. */
  @Prop({ type: String, required: true }) farmer_contact!: string;
  @Prop({ type: String, default: null }) village!: string | null;
  @Prop({ type: String, default: null }) district!: string | null;
  @Prop({ type: String, default: null }) state!: string | null;

  @Prop({ type: String, enum: ['product', 'combo'], required: true })
  type!: 'product' | 'combo';
  @Prop({ type: String, default: null }) bulk!: string | null;
  @Prop({ type: String, default: null }) family!: string | null;
  /** `bulk_v2.trade_name` / `combos_v2.name` when sent. */
  @Prop({ type: String, default: null }) product_name!: string | null;
  @Prop({ type: String, required: true }) crop!: string;

  @Prop({ type: String, enum: SUBMISSION_KINDS, required: true })
  kind!: SubmissionKind;
  @Prop({ type: String, default: '' }) text!: string;
  @Prop({ type: Number, required: true }) rating!: number;
  /** Private object path; `null` for a quote. */
  @Prop({ type: String, default: null }) media_path!: string | null;
  /** The token URL product pages play — set on approval, gone on removal. */
  @Prop({ type: String, default: null }) media_url!: string | null;
  @Prop({ type: Number, default: null }) duration_sec!: number | null;

  @Prop({ type: String, enum: SUBMISSION_STATUSES, default: 'submitted' })
  status!: SubmissionStatus;
  @Prop({ type: String, default: null }) reason!: string | null;
  @Prop({ type: String, default: null }) decided_by!: string | null;
  @Prop({ type: Date, default: null }) decided_at!: Date | null;
  @Prop({ type: Date, default: null }) approved_at!: Date | null;

  /** `product_reviews._id` — every kind gets one (rating + words). */
  @Prop({ type: SchemaTypes.ObjectId, required: true })
  review_id!: Types.ObjectId;
  /** `product_testimonials._id`; `null` for a quote. */
  @Prop({ type: SchemaTypes.ObjectId, default: null })
  testimonial_id!: Types.ObjectId | null;

  /** Reserved for meeting gigs; nothing sets it yet. */
  @Prop({ type: String, default: null }) gig_id!: string | null;

  @Prop({ type: Number, default: 0 }) views!: number;
  @Prop({ type: Number, default: 0 }) shares!: number;

  created_at!: Date;
  updated_at!: Date;
}

export type TestimonialSubmissionDocument =
  HydratedDocument<TestimonialSubmission>;
export const TestimonialSubmissionSchema = SchemaFactory.createForClass(
  TestimonialSubmission,
);

// "My submissions", newest first.
TestimonialSubmissionSchema.index({ agent_id: 1, created_at: -1 });
// The library and the HO trays: by status, newest or most shared first.
// Each ends with the library's own tie-break, so a page never sorts in memory.
TestimonialSubmissionSchema.index({ status: 1, created_at: -1, _id: -1 });
TestimonialSubmissionSchema.index({ status: 1, shares: -1, created_at: -1 });
// Library filters on an approved story's product, crop and place.
TestimonialSubmissionSchema.index({
  status: 1,
  bulk: 1,
  created_at: -1,
  _id: -1,
});
TestimonialSubmissionSchema.index({
  status: 1,
  crop: 1,
  created_at: -1,
  _id: -1,
});
TestimonialSubmissionSchema.index({
  status: 1,
  state: 1,
  district: 1,
  created_at: -1,
  _id: -1,
});
// The HO desk's "is this shared row a partner's?" check.
TestimonialSubmissionSchema.index(
  { testimonial_id: 1 },
  { partialFilterExpression: { testimonial_id: { $type: 'objectId' } } },
);
// A farmer's withdrawal reaches every story of theirs.
TestimonialSubmissionSchema.index({ pii_id: 1 });
