import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

import {
  type FranchiseRow,
  type FranchiseV2Row,
  type StoreDirectoryRows,
} from '../kkd-activity.domain';

import { idString } from './stored-id';

interface FranchiseDoc {
  franchiseId: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | number | null;
  contact?: string | number | null;
  email?: string | null;
  location?: { coordinates?: number[] | null } | null;
  warehouse?: { warehouseId?: unknown } | null;
}

/** A handful of stores org-wide; only a bound on a runaway read. */
const STORE_CAP = 5000;

/**
 * Every franchise / KKD store, read-only: StockShip's `franchises` (map point,
 * warehouse), the franchise HO portal's `franchise_v2_franchises` (newer
 * stores) and StockShip's POS logins (`employees` with a `franchiseId` — only
 * email and store, never anything else of theirs).
 */
@Injectable()
export class StoreDirectoryRepository {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async load(): Promise<StoreDirectoryRows> {
    const db = this.connection;
    const [franchiseDocs, v2, logins] = await Promise.all([
      db
        .collection<FranchiseDoc>('franchises')
        .find(
          {},
          {
            projection: {
              _id: 0,
              franchiseId: 1,
              address: 1,
              city: 1,
              state: 1,
              pincode: 1,
              contact: 1,
              email: 1,
              'location.coordinates': 1,
              'warehouse.warehouseId': 1,
            },
            limit: STORE_CAP,
          },
        )
        .toArray(),
      db
        .collection<FranchiseV2Row>('franchise_v2_franchises')
        .find(
          {},
          {
            projection: {
              _id: 0,
              franchise_id: 1,
              address: 1,
              city: 1,
              state: 1,
              pincode: 1,
              phone: 1,
              email: 1,
            },
            limit: STORE_CAP,
          },
        )
        .toArray(),
      db
        .collection<{ email?: string | null; franchiseId?: string | null }>(
          'employees',
        )
        .find(
          { franchiseId: { $nin: [null, ''] }, email: { $nin: [null, ''] } },
          {
            projection: { _id: 0, email: 1, franchiseId: 1 },
            limit: STORE_CAP,
          },
        )
        .toArray(),
    ]);

    const franchises: FranchiseRow[] = franchiseDocs
      .filter((f) => f.franchiseId)
      .map((f) => ({
        franchiseId: f.franchiseId,
        address: f.address ?? null,
        city: f.city ?? null,
        state: f.state ?? null,
        pincode: f.pincode ?? null,
        contact: f.contact ?? null,
        email: f.email ?? null,
        coordinates: f.location?.coordinates ?? null,
        warehouse_id: idString(f.warehouse?.warehouseId),
      }));

    return {
      franchises,
      v2: v2.filter((v) => v.franchise_id),
      logins: logins.flatMap((l) =>
        l.email && l.franchiseId
          ? [{ email: l.email, franchiseId: l.franchiseId }]
          : [],
      ),
    };
  }
}
