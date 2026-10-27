import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { mongo, type Connection } from 'mongoose';

import { stockshipStatus, type StoreCandidate } from '../radar.domain';

/** Far above the store count (one real store on main); only a bound on a runaway read. */
const READ_CAP = 5_000;

interface StockshipFranchiseDoc {
  _id: mongo.ObjectId;
  franchiseId?: string;
  city?: string;
  state?: string;
  address?: string;
  pincode?: number | string;
  contact?: number | string;
  location?: { coordinates?: number[] };
  warehouse?: { warehouseId?: mongo.ObjectId | string | null };
  createdAt?: Date;
}

interface OwnFranchiseDoc {
  _id: string;
  city?: string | null;
  state?: string | null;
  address?: string | null;
  pincode?: string | null;
  phone?: string | null;
  status?: string;
  created_at?: Date;
}

const text = (v: unknown): string | null =>
  typeof v === 'string'
    ? v.trim() || null
    : typeof v === 'number'
      ? String(v)
      : null;

const pointOf = (lat: unknown, lng: unknown) =>
  typeof lat === 'number' &&
  typeof lng === 'number' &&
  Number.isFinite(lat) &&
  Number.isFinite(lng)
    ? { lat, lng }
    : null;

/**
 * The offline franchise master, **read-only**, merged the way the offline hub
 * merges it (`GET /api/v2/franchises`): StockShip's `franchises` (status from
 * its warehouse) and head office's `franchise_v2_franchises` — StockShip's
 * record wins once it carries the same FR id — with HO's map pin from
 * `franchise_v2_settings`. No schema or index is declared on any of them.
 */
@Injectable()
export class KkdStoreRepository {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async all(): Promise<StoreCandidate[]> {
    const db = this.connection;
    const [stockship, own, settings] = await Promise.all([
      db
        .collection<StockshipFranchiseDoc>('franchises')
        .find(
          { franchiseId: { $type: 'string' } },
          {
            projection: {
              franchiseId: 1,
              city: 1,
              state: 1,
              address: 1,
              pincode: 1,
              contact: 1,
              location: 1,
              warehouse: 1,
              createdAt: 1,
            },
            limit: READ_CAP,
          },
        )
        .toArray(),
      db
        .collection<OwnFranchiseDoc>('franchise_v2_franchises')
        .find(
          {},
          {
            projection: {
              city: 1,
              state: 1,
              address: 1,
              pincode: 1,
              phone: 1,
              status: 1,
              created_at: 1,
            },
            limit: READ_CAP,
          },
        )
        .toArray(),
      db
        .collection<{
          _id: string;
          location?: { lat?: number; lng?: number };
        }>('franchise_v2_settings')
        .find(
          { location: { $type: 'object' } },
          { projection: { location: 1 }, limit: READ_CAP },
        )
        .toArray(),
    ]);

    const warehouseIds = stockship.flatMap((d) => {
      const id = d.warehouse?.warehouseId;
      if (id instanceof mongo.ObjectId) return [id];
      return typeof id === 'string' && mongo.ObjectId.isValid(id)
        ? [new mongo.ObjectId(id)]
        : [];
    });
    const warehouses = new Map(
      (
        await db
          .collection<{
            _id: mongo.ObjectId;
            isActive?: boolean;
          }>('warehouses')
          .find({ _id: { $in: warehouseIds } }, { projection: { isActive: 1 } })
          .toArray()
      ).map((w) => [String(w._id), w]),
    );
    const pins = new Map(
      settings.flatMap((s) => {
        const p = pointOf(s.location?.lat, s.location?.lng);
        return p ? [[s._id, p] as const] : [];
      }),
    );

    const fromStockship = stockship.map((d): StoreCandidate => {
      const id = String(d.franchiseId);
      // GeoJSON order: [lng, lat].
      const [lng, lat] = d.location?.coordinates ?? [];
      const warehouseId = d.warehouse?.warehouseId;
      return {
        id,
        // As the hub reads it: a warehouse on the record trades unless it is
        // switched off — even when its row cannot be found.
        status: stockshipStatus(
          warehouseId ? (warehouses.get(String(warehouseId)) ?? {}) : null,
        ),
        city: text(d.city),
        state: text(d.state),
        address: text(d.address),
        pincode: text(d.pincode),
        phone: text(d.contact),
        point: pins.get(id) ?? pointOf(lat, lng),
        created_at: d.createdAt ?? null,
      };
    });
    const inStockship = new Set(fromStockship.map((c) => c.id));
    const fromHo = own
      .filter((o) => !inStockship.has(o._id))
      .map((o): StoreCandidate => ({
        id: o._id,
        status: o.status ?? 'setup_pending',
        city: text(o.city),
        state: text(o.state),
        address: text(o.address),
        pincode: text(o.pincode),
        phone: text(o.phone),
        point: pins.get(o._id) ?? null,
        created_at: o.created_at ?? null,
      }));
    return [...fromStockship, ...fromHo];
  }
}
