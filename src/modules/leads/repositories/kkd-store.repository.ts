import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

/** One Katyayani Krishi Kendra (a franchise store) as the radar shows it. */
export interface KkdStoreRow {
  id: string;
  city: string | null;
  state: string | null;
  address: string | null;
  pincode: string | null;
  phone: string | null;
  lat: number;
  lng: number;
}

/** Far above the store count (4 on beta); only a bound on a runaway read. */
const READ_CAP = 5_000;

/**
 * The franchise app's `franchises`, **read-only** — no schema or index is
 * declared on it. Only stores with a map point are read.
 */
@Injectable()
export class KkdStoreRepository {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async all(): Promise<KkdStoreRow[]> {
    const rows = await this.connection
      .collection<{
        franchiseId?: string;
        city?: string;
        state?: string;
        address?: string;
        pincode?: number | string;
        contact?: number | string;
        location?: { coordinates?: number[] };
      }>('franchises')
      .find(
        { 'location.coordinates.1': { $exists: true } },
        {
          projection: {
            franchiseId: 1,
            city: 1,
            state: 1,
            address: 1,
            pincode: 1,
            contact: 1,
            location: 1,
          },
          limit: READ_CAP,
        },
      )
      .toArray();
    return rows.flatMap((r) => {
      // GeoJSON order: [lng, lat].
      const [lng, lat] = r.location?.coordinates ?? [];
      if (typeof lat !== 'number' || typeof lng !== 'number') return [];
      return [
        {
          id: r.franchiseId ?? String(r._id),
          city: r.city ?? null,
          state: r.state ?? null,
          address: r.address ?? null,
          pincode: r.pincode != null ? String(r.pincode) : null,
          phone: r.contact != null ? String(r.contact) : null,
          lat,
          lng,
        },
      ];
    });
  }
}
