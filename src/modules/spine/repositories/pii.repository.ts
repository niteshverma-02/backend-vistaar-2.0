import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, mongo } from 'mongoose';

import {
  AppCounter,
  type AppCounterDocument,
} from '../schemas/app-counter.schema';
import { Pii, type PiiDocument } from '../schemas/pii.schema';

/** Marks the `piis.documents` entries this service wrote. */
export const ORG_DOC_SOURCE = 'vistaar';

@Injectable()
export class PiiRepository {
  constructor(
    @InjectModel(Pii.name) private readonly piis: Model<PiiDocument>,
    @InjectModel(AppCounter.name)
    private readonly counters: Model<AppCounterDocument>,
  ) {}

  /**
   * Oldest first. Beta has no unique index on the phone and duplicates exist;
   * the oldest PII is the one other portals have been attaching records to,
   * so every lookup lands on the same person.
   */
  async findIdByPhone(phone: string): Promise<string | null> {
    const doc = await this.piis
      .findOne({ phone_number: phone })
      .sort({ _id: 1 })
      .select('pii_id')
      .lean<{ pii_id: string } | null>()
      .exec();
    return doc?.pii_id ?? null;
  }

  async hasAddresses(piiId: string): Promise<boolean> {
    const doc = await this.piis
      .findOne({ pii_id: piiId, 'addresses.0': { $exists: true } })
      .select('_id')
      .lean()
      .exec();
    return doc !== null;
  }

  async addAddressRef(piiId: string, addressId: string): Promise<void> {
    await this.piis
      .updateOne(
        { pii_id: piiId },
        {
          $addToSet: { addresses: addressId },
          $set: { updated_at: new Date() },
        },
      )
      .exec();
  }

  async nextPiiNumber(): Promise<number> {
    const doc = await this.counters
      .findOneAndUpdate(
        { _id: 'piis' },
        { $inc: { count: 1 }, $set: { updated_at: new Date() } },
        { upsert: true, returnDocument: 'after' },
      )
      .lean<{ count: number }>()
      .exec();
    return doc.count;
  }

  /** `false` when the `pii_id` (or, on prod, the phone) was already taken. */
  async insert(
    piiId: string,
    phone: string,
    countryCode: string,
  ): Promise<boolean> {
    try {
      await this.piis.create({
        pii_id: piiId,
        phone_number: [phone],
        country_code: countryCode,
        addresses: [],
        gst_numbers: [],
      });
      return true;
    } catch (error) {
      if (error instanceof mongo.MongoServerError && error.code === 11000) {
        return false;
      }
      throw error;
    }
  }

  /**
   * `documents.<type>` replaced only while the slot is empty or already ours,
   * so another portal's entry is never overwritten. Always a dotted path: a
   * `$set` of the whole `documents` would erase every other type.
   */
  async setOwnDocument(
    piiId: string,
    type: string,
    entry: Record<string, unknown>,
  ): Promise<boolean> {
    const slot = `documents.${type}`;
    const res = await this.piis
      .updateOne(
        {
          pii_id: piiId,
          $or: [
            { [slot]: { $exists: false } },
            { [slot]: null },
            { [`${slot}.source`]: ORG_DOC_SOURCE },
          ],
        },
        { $set: { [slot]: entry, updated_at: new Date() } },
      )
      .exec();
    return res.matchedCount === 1;
  }

  async unverifyOwnDocument(piiId: string, type: string): Promise<void> {
    const slot = `documents.${type}`;
    await this.piis
      .updateOne(
        { pii_id: piiId, [`${slot}.source`]: ORG_DOC_SOURCE },
        { $set: { [`${slot}.is_verified`]: false, updated_at: new Date() } },
      )
      .exec();
  }
}
