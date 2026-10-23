import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import {
  SETTINGS_ID,
  Settings,
  type FarmerConsent,
  type FeedbackReasons,
  type SettingsDocument,
} from '../schemas/settings.schema';

export type { FarmerConsent, FeedbackReasons };

export interface SettingsRecord {
  default_owner_agent_id: string | null;
  lead_owner_agent_id: string | null;
  farmer_consent: FarmerConsent;
  lead_release_days: number;
  customer_release_days: number;
  testimonial_consent: FarmerConsent;
  return_window_days: number;
  min_withdrawal: number;
  max_withdrawal_pct: number;
  tds_rate_with_pan: number;
  tds_rate_without_pan: number;
  monthly_target: number;
  gig_payout: number;
  gig_min_farmers: number;
  gig_photos_required: number;
  gig_checkin_radius_m: number;
  gig_pay_enabled: boolean;
  gig_pay_enabled_at: Date | null;
  conflict_radius_km: number;
  feedback_reasons: FeedbackReasons | null;
  updated_by?: string;
  updated_at?: Date;
}

@Injectable()
export class SettingsRepository {
  constructor(
    @InjectModel(Settings.name) private readonly model: Model<SettingsDocument>,
  ) {}

  async read(): Promise<Partial<SettingsRecord> | null> {
    return this.model
      .findById(SETTINGS_ID)
      .select('-_id')
      .lean<Partial<SettingsRecord> | null>()
      .exec();
  }

  async write(set: Partial<SettingsRecord>): Promise<Partial<SettingsRecord>> {
    const doc = await this.model
      .findOneAndUpdate(
        { _id: SETTINGS_ID },
        { $set: { ...set, updated_at: new Date() } },
        { upsert: true, returnDocument: 'after' },
      )
      .select('-_id')
      .lean<Partial<SettingsRecord>>()
      .exec();
    return doc;
  }
}
