import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, mongo } from 'mongoose';

import { Address, type AddressDocument } from '../schemas/address.schema';

/** The address fields a writer fills; ids and timestamps are the repository's. */
export interface AddressFields {
  village: string;
  district: string | null;
  state: string;
  pincode: string | null;
}

export interface AddressRecord {
  address_id: string;
  pii_id: string;
  village: string | null;
  district: string | null;
  state: string;
  zipcode: string;
}

@Injectable()
export class AddressRepository {
  constructor(
    @InjectModel(Address.name) private readonly model: Model<AddressDocument>,
  ) {}

  /** The one row this `source` filed for the person, if any. */
  ownRow(piiId: string, source: string): Promise<AddressRecord | null> {
    return this.model
      .findOne({ pii_id: piiId, source })
      .select('address_id pii_id village district state zipcode')
      .lean<AddressRecord | null>()
      .exec();
  }

  /** The farm's GPS on the row this source filed — never another writer's. */
  async setGeo(
    piiId: string,
    source: string,
    geo: { lat: number; lng: number },
  ): Promise<void> {
    await this.model
      .updateOne(
        { pii_id: piiId, source },
        { $set: { geo, updated_at: new Date() } },
      )
      .exec();
  }

  /** `false` when `address_id` was already taken (the counter is behind). */
  async insert(
    row: Omit<Address, 'created_at' | 'updated_at'>,
  ): Promise<boolean> {
    const now = new Date();
    try {
      await this.model.create({ ...row, created_at: now, updated_at: now });
      return true;
    } catch (error) {
      if (error instanceof mongo.MongoServerError && error.code === 11000)
        return false;
      throw error;
    }
  }

  async update(
    addressId: string,
    set: Partial<
      Pick<
        Address,
        'address_line' | 'village' | 'district' | 'city' | 'state' | 'zipcode'
      >
    >,
  ): Promise<void> {
    await this.model
      .updateOne(
        { address_id: addressId },
        { $set: { ...set, updated_at: new Date() } },
      )
      .exec();
  }
}
