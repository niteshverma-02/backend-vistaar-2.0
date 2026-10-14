import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, type HydratedDocument } from 'mongoose';

export const SETTINGS_ID = 'vistaar';

export interface FarmerConsent {
  version: number;
  text: { en: string; hi?: string };
}

/** One document of programme settings the HO desk can change without a release. */
@Schema({ collection: 'vistaar_v2_settings', versionKey: false })
export class Settings {
  @Prop({ type: String, default: SETTINGS_ID })
  _id!: string;

  /** `agents_v2.agent_id` that owns every new signup until reassigned. */
  @Prop({ type: String, default: null })
  default_owner_agent_id!: string | null;

  /**
   * Override for the `lead_owner` of farmer leads. Unset (`null`) = the one
   * active Offline Head (USR-1037) owns them — the HO portal head.
   */
  @Prop({ type: String, default: null })
  lead_owner_agent_id!: string | null;

  /**
   * The consent a partner ticks for each farmer they add (PRD §10, DPDP). HO
   * edits the text; every change is a new `version`, and each lead records
   * the version it was given under. `null` = the built-in first version.
   */
  @Prop({ type: SchemaTypes.Mixed, default: null })
  farmer_consent!: FarmerConsent | null;

  /**
   * One farmer, one partner — but not forever (user, 2026-10-13): a lead with
   * no work for this many days, or a customer with no order for
   * `customer_release_days`, can be taken by another partner.
   */
  @Prop({ type: Number, default: 15 })
  lead_release_days!: number;

  @Prop({ type: Number, default: 45 })
  customer_release_days!: number;

  /** Commission: days after delivery before it is confirmed (returns allowed until then). */
  @Prop({ type: Number, default: 7 }) return_window_days!: number;
  /** Smallest withdrawal, ₹. */
  @Prop({ type: Number, default: 500 }) min_withdrawal!: number;
  /** TDS u/s 194H on a withdrawal, % — with a verified PAN / without. */
  @Prop({ type: Number, default: 2 }) tds_rate_with_pan!: number;
  @Prop({ type: Number, default: 20 }) tds_rate_without_pan!: number;
  /** A partner's monthly sales target, ₹, unless HO set one for them. */
  @Prop({ type: Number, default: 100_000 }) monthly_target!: number;

  /** How far the approval screen looks for existing network, in km. */
  @Prop({ type: Number, default: 5 })
  conflict_radius_km!: number;

  @Prop({ type: String }) updated_by?: string;
  @Prop({ type: Date }) updated_at?: Date;
}

export type SettingsDocument = HydratedDocument<Settings>;
export const SettingsSchema = SchemaFactory.createForClass(Settings);
