import { Injectable } from '@nestjs/common';

import { badRequest } from '@common/errors/api-error';
import { AccessService } from '@modules/access/services/access.service';

import type { UpdateSettingsDto } from '../dto/settings.dto';
import {
  SettingsRepository,
  type FarmerConsent,
  type FeedbackReasons,
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

/** The app's testimonial screen, until HO changes it. */
const FIRST_TESTIMONIAL_CONSENT: FarmerConsent = {
  version: 1,
  text: {
    en: 'Farmer agreed that Katyayani may show this video, photo or quote, with their name and village, on its product pages and to its partners.',
    hi: 'किसान ने सहमति दी है कि कात्यायनी यह वीडियो, फ़ोटो या बात, उनके नाम और गाँव के साथ, अपने प्रोडक्ट पेज पर और अपने पार्टनर्स को दिखा सकती है।',
  },
};

const DEFAULTS: SettingsRecord = {
  default_owner_agent_id: null,
  lead_owner_agent_id: null,
  farmer_consent: FIRST_CONSENT,
  lead_release_days: 15,
  customer_release_days: 45,
  testimonial_consent: FIRST_TESTIMONIAL_CONSENT,
  conflict_radius_km: 5,
  feedback_reasons: null,
};
const CACHE_MS = 60_000;

export type { FarmerConsent, FeedbackReasons, SettingsRecord };

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
      testimonial_consent:
        stored.testimonial_consent ?? FIRST_TESTIMONIAL_CONSENT,
    };
    this.cached = { at: Date.now(), value };
    return value;
  }

  async update(dto: UpdateSettingsDto, by: string): Promise<SettingsRecord> {
    const owners: [string, string | null | undefined][] = [
      ['default owner', dto.default_owner_agent_id],
      ['farmer-lead owner', dto.lead_owner_agent_id],
    ];
    const named = owners.filter((o): o is [string, string] => !!o[1]);
    const staff = await this.access.staffByIds(named.map(([, id]) => id));
    for (const [label, id] of named) {
      if (!staff.get(id)?.is_active) {
        throw badRequest(
          'OWNER_NOT_FOUND',
          `No active staff member was found with ID ${id}. Please check the ${label}.`,
        );
      }
    }
    const { farmer_consent_text, testimonial_consent_text, ...rest } = dto;
    const set: Partial<SettingsRecord> = { ...rest, updated_by: by };
    const current = await this.get();
    const farmer = nextConsent(current.farmer_consent, farmer_consent_text);
    if (farmer) set.farmer_consent = farmer;
    const testimonial = nextConsent(
      current.testimonial_consent,
      testimonial_consent_text,
    );
    if (testimonial) set.testimonial_consent = testimonial;
    await this.settings.write(set);
    this.cached = null;
    return this.get();
  }

  /** The feedback module validates the shape; this only stores it. */
  async setFeedbackReasons(
    reasons: FeedbackReasons,
    by: string,
  ): Promise<SettingsRecord> {
    await this.settings.write({ feedback_reasons: reasons, updated_by: by });
    this.cached = null;
    return this.get();
  }
}

/**
 * The next version when the words changed; `null` when they did not — the
 * same words keep the version, so consents given under it stay current.
 */
function nextConsent(
  current: FarmerConsent,
  text: FarmerConsent['text'] | undefined,
): FarmerConsent | null {
  if (!text) return null;
  const changed =
    current.text.en !== text.en || (current.text.hi ?? '') !== (text.hi ?? '');
  return changed ? { version: current.version + 1, text } : null;
}
