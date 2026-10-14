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
