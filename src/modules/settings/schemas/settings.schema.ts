import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, type HydratedDocument } from 'mongoose';

export const SETTINGS_ID = 'vistaar';

export interface FarmerConsent {
  version: number;
  text: { en: string; hi?: string };
}

/**
 * The Feedback screen's follow-up question and reason chips per NPS bucket
 * (`detractor`, `passive`, `promoter`). The feedback module owns the shape
 * and the built-in copy; this only keeps HO's edit.
 */
export type FeedbackReasons = Record<
  string,
  { question: string; chips: string[] }
>;

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
   * active Offline Head (USR-1037) owns them — the HO portal head; with none
   * (or this account inactive), the partner who added the farmer.
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

  /**
   * The farmer's permission to show their testimonial — face, voice, words,
   * name — on Katyayani's product pages and to other partners. Versioned like
   * `farmer_consent`; each consent row keeps the words it was given under.
   * `null` = the built-in first version.
   */
  @Prop({ type: SchemaTypes.Mixed, default: null })
  testimonial_consent!: FarmerConsent | null;

  /** `null` = the app's built-in reasons. */
  @Prop({ type: SchemaTypes.Mixed, default: null })
  feedback_reasons!: FeedbackReasons | null;

  /** Commission: days after delivery before it is confirmed (returns allowed until then). */
  @Prop({ type: Number, default: 7 }) return_window_days!: number;
  /** Smallest withdrawal, ₹. */
  @Prop({ type: Number, default: 500 }) min_withdrawal!: number;
  /** TDS u/s 194H on a withdrawal, % — with a verified PAN / without. */
  @Prop({ type: Number, default: 2 }) tds_rate_with_pan!: number;
  @Prop({ type: Number, default: 20 }) tds_rate_without_pan!: number;
  /** A partner's monthly sales target, ₹, unless HO set one for them. */
  @Prop({ type: Number, default: 100_000 }) monthly_target!: number;

  /** Meeting gigs: defaults for a new gig, HO-changeable per gig. */
  @Prop({ type: Number, default: 250 }) gig_payout!: number;
  @Prop({ type: Number, default: 15 }) gig_min_farmers!: number;
  @Prop({ type: Number, default: 3 }) gig_photos_required!: number;
  /** Check-in farther than this from a pinned venue is flagged, never refused. */
  @Prop({ type: Number, default: 500 }) gig_checkin_radius_m!: number;
  /** Approved gigs reach the wallet only when on — finance must first confirm the TDS section. */
  @Prop({ type: Boolean, default: false }) gig_pay_enabled!: boolean;
  /**
   * When gig pay was first switched on. A gig approved before it counts from
   * this moment, so payouts made while pay was off keep paying the orders
   * they paid. Set once, never cleared.
   */
  @Prop({ type: Date, default: null }) gig_pay_enabled_at!: Date | null;

  /** How far the approval screen looks for existing network, in km. */
  @Prop({ type: Number, default: 5 })
  conflict_radius_km!: number;

  @Prop({ type: String }) updated_by?: string;
  @Prop({ type: Date }) updated_at?: Date;
}

export type SettingsDocument = HydratedDocument<Settings>;
export const SettingsSchema = SchemaFactory.createForClass(Settings);
