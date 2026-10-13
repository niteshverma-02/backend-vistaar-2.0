import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, type HydratedDocument } from 'mongoose';

/**
 * The org's lead records (ko-sales owns both). Vistaar inserts a farmer's
 * lead and contact whole — the documents are built in `leads.domain.ts` and
 * written through the driver, so these classes declare only the fields read
 * and filtered on.
 *
 * ⚠️ No index is declared: ko-sales keeps `lead_id`, `contact_id` and both
 * `pii_id`s unique, and `leads_v2.source` indexed.
 */

/** `leads_v2` — one lead per person. */
@Schema({ collection: 'leads_v2', autoIndex: false })
export class OrgLead {
  @Prop({ type: String }) lead_id!: string;
  @Prop({ type: String }) pii_id!: string;
  @Prop({ type: String }) first_name?: string;
  @Prop({ type: String }) last_name?: string;
  @Prop({ type: String }) state?: string;
  @Prop({ type: String }) pin_code?: string;
  @Prop({ type: String }) source?: string;
  @Prop({ type: String }) status?: string;
  @Prop({ type: String }) created_by?: string;
  @Prop({ type: Date }) created_at?: Date;
  @Prop({ type: Date }) updated_at?: Date;
}

/** `contacts_v2` — the person's profile; a farmer's farm. */
@Schema({ collection: 'contacts_v2', autoIndex: false })
export class OrgContact {
  @Prop({ type: String }) contact_id!: string;
  @Prop({ type: String }) pii_id!: string;
  @Prop({ type: String }) profile?: string;
  @Prop({ type: String }) source?: string;
  @Prop({ type: SchemaTypes.Mixed }) farm_details?: Record<string, unknown>;
}

export type OrgLeadDocument = HydratedDocument<OrgLead>;
export type OrgContactDocument = HydratedDocument<OrgContact>;

export const OrgLeadSchema = SchemaFactory.createForClass(OrgLead);
export const OrgContactSchema = SchemaFactory.createForClass(OrgContact);
