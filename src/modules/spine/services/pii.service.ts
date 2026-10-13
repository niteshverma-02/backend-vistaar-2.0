import { Injectable, Logger } from '@nestjs/common';

import { unavailable } from '@common/errors/api-error';

import { ORG_DOC_SOURCE, PiiRepository } from '../repositories/pii.repository';

export interface ResolvedPii {
  pii_id: string;
  /** `false` — the phone already belonged to a person on the shared spine. */
  created: boolean;
}

/** ko-sales' `piis.documents` entry, minus what this service fills in. */
export interface OrgDocument {
  id: string | null;
  image: string | null;
  back_image?: string;
}

/**
 * The person behind a phone, on the org's identity layer — the only place
 * this service writes `piis`: it inserts a person nobody holds yet, and
 * mirrors HO-verified KYC documents into `documents.<type>`.
 */
@Injectable()
export class PiiService {
  private readonly logger = new Logger(PiiService.name);

  constructor(private readonly piis: PiiRepository) {}

  /**
   * Read-then-insert, like ko-sales' own `create`: there is no unique phone
   * index on beta to upsert against, and Vistaar may not add one to a shared
   * collection. On an id collision (the counter behind the collection) the
   * phone is re-read; if nobody holds it, one retry with the next number.
   */
  async resolve(phone: string, countryCode: string): Promise<ResolvedPii> {
    const existing = await this.piis.findIdByPhone(phone);
    if (existing) return { pii_id: existing, created: false };

    for (let attempt = 0; attempt < 2; attempt++) {
      const piiId = `PII-${await this.piis.nextPiiNumber()}`;
      if (await this.piis.insert(piiId, phone, countryCode)) {
        return { pii_id: piiId, created: true };
      }
      const raced = await this.piis.findIdByPhone(phone);
      if (raced) return { pii_id: raced, created: false };
      this.logger.warn(`app_counters.piis minted ${piiId}, already taken.`);
    }

    throw unavailable(
      'IDENTITY_UNAVAILABLE',
      'We could not create your account right now. Please try again in a minute.',
    );
  }

  /**
   * A partner document HO verified, copied to the person's org record. Never
   * fails the review: the copy is best-effort, and verifying again retries it.
   */
  async recordVerifiedDocument(
    piiId: string,
    type: string,
    doc: OrgDocument,
  ): Promise<void> {
    try {
      const written = await this.piis.setOwnDocument(piiId, type, {
        ...doc,
        is_verified: true,
        validity: null,
        source: ORG_DOC_SOURCE,
        verified_at: new Date(),
      });
      if (!written)
        this.logger.log(
          `${piiId} documents.${type} belongs to another portal; left as is.`,
        );
    } catch (error) {
      this.logger.warn(`Could not copy ${type} to ${piiId}: ${String(error)}`);
    }
  }

  async unverifyDocument(piiId: string, type: string): Promise<void> {
    try {
      await this.piis.unverifyOwnDocument(piiId, type);
    } catch (error) {
      this.logger.warn(
        `Could not unverify ${type} on ${piiId}: ${String(error)}`,
      );
    }
  }
}
