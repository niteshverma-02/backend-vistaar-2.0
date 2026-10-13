import { Injectable, Logger } from '@nestjs/common';

import { unavailable } from '@common/errors/api-error';

import {
  AddressRepository,
  type AddressFields,
  type AddressRecord,
} from '../repositories/address.repository';
import {
  OrgCounterRepository,
  type OrgCounterKey,
} from '../repositories/org-counter.repository';
import { ORG_DOC_SOURCE, PiiRepository } from '../repositories/pii.repository';

export type { AddressFields, AddressRecord, OrgCounterKey };

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
 * this service writes `piis`: it inserts a person nobody holds yet, mirrors
 * HO-verified KYC documents into `documents.<type>`, and files the addresses
 * Vistaar records. Also hands out org id numbers from `app_counters`.
 */
@Injectable()
export class PiiService {
  private readonly logger = new Logger(PiiService.name);

  constructor(
    private readonly piis: PiiRepository,
    private readonly addresses: AddressRepository,
    private readonly counters: OrgCounterRepository,
  ) {}

  /** The next number of an org id series (`L-`, `C0-`, `ADDR-`), shared with ko-sales. */
  nextOrgNumber(key: OrgCounterKey): Promise<number> {
    return this.counters.next(key);
  }

  /**
   * The person's address as `source` filed it: updated in place when that row
   * exists, otherwise a new `ADDR-n` row listed on `piis.addresses[]` —
   * primary only when the person has no address yet. Rows other writers filed
   * are never touched.
   */
  async saveAddress(
    piiId: string,
    fields: AddressFields,
    meta: { source: string; by: string },
  ): Promise<string> {
    const row = {
      address_line: fields.village,
      village: fields.village,
      district: fields.district,
      city: fields.district ?? '',
      state: fields.state,
      zipcode: fields.pincode ?? '',
    };
    const own = await this.addresses.ownRow(piiId, meta.source);
    if (own) {
      await this.addresses.update(own.address_id, row);
      return own.address_id;
    }

    const primary = !(await this.piis.hasAddresses(piiId));
    for (let attempt = 0; attempt < 3; attempt++) {
      const addressId = `ADDR-${await this.counters.next('addresses')}`;
      const inserted = await this.addresses.insert({
        ...row,
        address_id: addressId,
        pii_id: piiId,
        country: 'India',
        is_primary: primary,
        source: meta.source,
        created_by: meta.by,
      });
      if (inserted) {
        await this.piis.addAddressRef(piiId, addressId);
        return addressId;
      }
      this.logger.warn(
        `app_counters.addresses minted ${addressId}, already taken.`,
      );
    }
    throw unavailable(
      'IDENTITY_UNAVAILABLE',
      'Could not save the address right now. Please try again.',
    );
  }

  addressesBySource(
    piiIds: readonly string[],
    source: string,
  ): Promise<Map<string, AddressRecord>> {
    return this.addresses.bySource(piiIds, source);
  }

  /** The person on a phone, without creating one; same oldest-first rule as `resolve`. */
  findIdByPhone(phone: string): Promise<string | null> {
    return this.piis.findIdByPhone(phone);
  }

  phonesOf(piiIds: readonly string[]): Promise<Map<string, string>> {
    return this.piis.phonesOf(piiIds);
  }

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
      'Could not create your account right now. Please try again.',
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
