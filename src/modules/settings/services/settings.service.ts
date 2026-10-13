import { Injectable } from '@nestjs/common';

import { badRequest } from '@common/errors/api-error';
import { AccessService } from '@modules/access/services/access.service';

import type { UpdateSettingsDto } from '../dto/settings.dto';
import {
  SettingsRepository,
  type FarmerConsent,
  type SettingsRecord,
} from '../repositories/settings.repository';

/** The app's own wording (Lovable add-lead screen), until HO changes it. */
const FIRST_CONSENT: FarmerConsent = {
  version: 1,
  text: {
    en: 'Farmer agreed to be contacted by Katyayani — calls, SMS and WhatsApp about orders, offers and crop advice.',
    hi: 'किसान ने कात्यायनी द्वारा संपर्क किए जाने की सहमति दी है — ऑर्डर, ऑफ़र और फसल सलाह के लिए कॉल, SMS और WhatsApp।',
  },
};

const DEFAULTS: SettingsRecord = {
  default_owner_agent_id: null,
  lead_owner_agent_id: null,
  farmer_consent: FIRST_CONSENT,
  conflict_radius_km: 5,
};
const CACHE_MS = 60_000;

export type { FarmerConsent, SettingsRecord };

@Injectable()
export class SettingsService {
  private cached: { at: number; value: SettingsRecord } | null = null;

  constructor(
    private readonly settings: SettingsRepository,
    private readonly access: AccessService,
  ) {}

  /** Read on every signup, so held for a minute rather than read each time. */
  async get(): Promise<SettingsRecord> {
    if (this.cached && Date.now() - this.cached.at < CACHE_MS)
      return this.cached.value;
    const stored = (await this.settings.read()) ?? {};
    const value = {
      ...DEFAULTS,
      ...stored,
      farmer_consent: stored.farmer_consent ?? FIRST_CONSENT,
    };
    this.cached = { at: Date.now(), value };
    return value;
  }

  async update(dto: UpdateSettingsDto, by: string): Promise<SettingsRecord> {
    const owners = [dto.default_owner_agent_id, dto.lead_owner_agent_id].filter(
      (id): id is string => !!id,
    );
    const staff = await this.access.staffByIds(owners);
    for (const id of owners) {
      if (!staff.get(id)?.is_active) {
        throw badRequest(
          'OWNER_NOT_FOUND',
          `${id} must be an active account in agents_v2.`,
        );
      }
    }
    const { farmer_consent_text, ...rest } = dto;
    const set: Partial<SettingsRecord> = { ...rest, updated_by: by };
    if (farmer_consent_text) {
      const current = (await this.get()).farmer_consent;
      const changed =
        current.text.en !== farmer_consent_text.en ||
        (current.text.hi ?? '') !== (farmer_consent_text.hi ?? '');
      // Same words, same version: leads already given under it stay current.
      if (changed) {
        set.farmer_consent = {
          version: current.version + 1,
          text: farmer_consent_text,
        };
      }
    }
    await this.settings.write(set);
    this.cached = null;
    return this.get();
  }
}
