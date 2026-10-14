import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { Pincode, type PincodeDocument } from '../schemas/pincode.schema';

export interface PincodeInfo {
  pincode: string;
  state: string | null;
  district: string | null;
  taluk: string | null;
}

/** One row of the whole book, as the in-memory map holds it. */
export interface PincodeRow extends PincodeInfo {
  lat: number | null;
  lng: number | null;
}

@Injectable()
export class PincodeRepository {
  constructor(
    @InjectModel(Pincode.name) private readonly model: Model<PincodeDocument>,
  ) {}

  /**
   * The whole book (~19,400 rows, ~2.4 MB) in one read — far cheaper than a
   * scan per lookup, since `pincode_map_v2` has no index on `pincode`.
   */
  async all(): Promise<PincodeRow[]> {
    const docs = await this.model
      .find({ pincode: { $type: 'string' } })
      .select('-_id pincode state district taluk geo')
      .lean<
        (Partial<PincodeInfo> & {
          pincode: string;
          geo?: { lat?: number | null; lng?: number | null };
        })[]
      >()
      .exec();
    return docs.map((d) => ({
      pincode: d.pincode,
      state: d.state ?? null,
      district: d.district ?? null,
      taluk: d.taluk ?? null,
      lat: typeof d.geo?.lat === 'number' ? d.geo.lat : null,
      lng: typeof d.geo?.lng === 'number' ? d.geo.lng : null,
    }));
  }

  async find(pincode: string): Promise<PincodeInfo | null> {
    const doc = await this.model
      .findOne({ pincode })
      .select('pincode state district taluk')
      .lean<Partial<PincodeInfo> | null>()
      .exec();
    if (!doc) return null;
    return {
      pincode,
      state: doc.state ?? null,
      district: doc.district ?? null,
      taluk: doc.taluk ?? null,
    };
  }
}
