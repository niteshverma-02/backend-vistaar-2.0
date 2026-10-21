import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

import {
  APP_MARKETPLACES,
  STORE_MARKETPLACE,
  type FarmerOrderRow,
} from '../kkd-activity.domain';

import { idString } from './stored-id';

interface OrderDoc {
  order_id: string;
  date?: Date | null;
  created_at?: Date | null;
  pii_id?: string | null;
  marketplace?: string | null;
  sub_source?: string | null;
  created_by?: string | null;
  warehouse?: { warehouse_id?: unknown } | null;
  order_status?: string | null;
  total_amount?: number | null;
  items?: { sku?: string; qty?: number }[];
}

const MARKETPLACES = [...Object.keys(APP_MARKETPLACES), STORE_MARKETPLACE];

/**
 * The farmers' own orders in StockShip's `orders_v2` (read-only): app and
 * website (MKTP-2 / MKTP-3) and store (MKTP-4). Rides `{pii_id, date}`.
 */
@Injectable()
export class FarmerOrdersRepository {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async since(
    piiIds: readonly string[],
    since: Date,
    cap: number,
  ): Promise<FarmerOrderRow[]> {
    if (piiIds.length === 0) return [];
    const rows = await this.connection
      .collection<OrderDoc>('orders_v2')
      .find(
        {
          pii_id: { $in: [...piiIds] },
          marketplace: { $in: MARKETPLACES },
          date: { $gte: since },
        },
        {
          projection: {
            _id: 0,
            order_id: 1,
            date: 1,
            created_at: 1,
            pii_id: 1,
            marketplace: 1,
            sub_source: 1,
            created_by: 1,
            'warehouse.warehouse_id': 1,
            order_status: 1,
            total_amount: 1,
            'items.sku': 1,
            'items.qty': 1,
          },
          sort: { date: -1 },
          limit: cap,
        },
      )
      .toArray();
    return rows.map((r) => ({
      order_id: r.order_id,
      date: r.date ?? null,
      created_at: r.created_at ?? null,
      pii_id: r.pii_id ?? null,
      marketplace: r.marketplace ?? null,
      sub_source: r.sub_source ?? null,
      created_by: r.created_by ?? null,
      warehouse_id: idString(r.warehouse?.warehouse_id),
      order_status: r.order_status ?? null,
      total_amount: r.total_amount ?? null,
      items: r.items ?? [],
    }));
  }
}
