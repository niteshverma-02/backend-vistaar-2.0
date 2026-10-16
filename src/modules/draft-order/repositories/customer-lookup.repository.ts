import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

import type { DraftCustomer } from '../draft-order.domain';

interface PiiRow {
  pii_id: string;
  phone_number?: string[];
}

interface LeadRow {
  lead_id?: string;
  first_name?: string;
  last_name?: string;
}

interface ContactRow {
  contact_id?: string;
  pii_id?: string;
}

const isString = (v: string | null | undefined): v is string => !!v;

/** How `piiIdsFor` keys a draft: its contact, else its phone. */
export const draftKey = (d: {
  contact_id: string | null;
  contact_number: string | null;
}): string => `${d.contact_id ?? ''}|${d.contact_number ?? ''}`;

/**
 * Read-only lookups on ko-sales' identity records (`piis`, `leads_v2`,
 * `contacts_v2`), which a draft copies its customer fields from. Every read
 * here rides an index those collections already have on `pii_id`,
 * `phone_number` or `contact_id`. Nothing here writes.
 */
@Injectable()
export class CustomerLookupRepository {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async byPiiId(piiId: string): Promise<DraftCustomer | null> {
    const [pii, lead, contact] = await Promise.all([
      this.connection
        .collection<PiiRow>('piis')
        .findOne(
          { pii_id: piiId },
          { projection: { pii_id: 1, phone_number: 1 } },
        ),
      this.connection
        .collection<LeadRow & { pii_id: string; updated_at?: Date }>('leads_v2')
        .findOne(
          { pii_id: piiId },
          {
            sort: { updated_at: -1 },
            projection: { lead_id: 1, first_name: 1, last_name: 1 },
          },
        ),
      this.connection
        .collection<ContactRow>('contacts_v2')
        .findOne({ pii_id: piiId }, { projection: { contact_id: 1 } }),
    ]);

    if (!pii) return null;

    const name = [lead?.first_name, lead?.last_name]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(' ');

    return {
      pii_id: pii.pii_id,
      contact_id: contact?.contact_id ?? null,
      lead_id: lead?.lead_id ?? null,
      name: name || null,
      phone: pii.phone_number?.[0] ?? null,
    };
  }

  /**
   * `piiIdFor` for a page of drafts in two reads: contacts by `contact_id`,
   * then the rest by phone (oldest person first, as everywhere). Keyed by
   * `draftKey`.
   */
  async piiIdsFor(
    drafts: readonly {
      contact_id: string | null;
      contact_number: string | null;
    }[],
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const contactIds = [
      ...new Set(drafts.map((d) => d.contact_id).filter(isString)),
    ];
    const byContact = new Map<string, string>();
    if (contactIds.length) {
      const rows = await this.connection
        .collection<ContactRow>('contacts_v2')
        .find(
          { contact_id: { $in: contactIds } },
          { projection: { contact_id: 1, pii_id: 1 } },
        )
        .toArray();
      for (const r of rows)
        if (r.contact_id && r.pii_id) byContact.set(r.contact_id, r.pii_id);
    }

    const phones = [
      ...new Set(
        drafts
          .filter((d) => !(d.contact_id && byContact.has(d.contact_id)))
          .map((d) => d.contact_number)
          .filter(isString),
      ),
    ];
    const byPhone = new Map<string, string>();
    if (phones.length) {
      const rows = await this.connection
        .collection<PiiRow>('piis')
        .find(
          { phone_number: { $in: phones } },
          { projection: { pii_id: 1, phone_number: 1 }, sort: { _id: 1 } },
        )
        .toArray();
      for (const r of rows)
        for (const phone of r.phone_number ?? [])
          if (phones.includes(phone) && !byPhone.has(phone))
            byPhone.set(phone, r.pii_id);
    }

    for (const d of drafts) {
      const pii =
        (d.contact_id && byContact.get(d.contact_id)) ||
        (d.contact_number && byPhone.get(d.contact_number));
      if (pii) out.set(draftKey(d), pii);
    }
    return out;
  }

  /**
   * The person a draft was for. `draft_orders` holds no `pii_id`, so it is
   * found again through the contact, else the phone.
   */
  async piiIdFor(
    contactId: string | null,
    phone: string | null,
  ): Promise<string | null> {
    if (contactId) {
      const contact = await this.connection
        .collection<ContactRow>('contacts_v2')
        .findOne({ contact_id: contactId }, { projection: { pii_id: 1 } });
      if (contact?.pii_id) return contact.pii_id;
    }

    if (phone) {
      const pii = await this.connection.collection<PiiRow>('piis').findOne(
        { phone_number: phone },
        // Oldest person first, as `piiIdsFor` and everywhere else.
        { projection: { pii_id: 1 }, sort: { _id: 1 } },
      );
      if (pii) return pii.pii_id;
    }

    return null;
  }
}
