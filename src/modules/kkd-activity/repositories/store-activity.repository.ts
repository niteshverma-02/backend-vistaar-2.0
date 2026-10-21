import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

import type {
  PosOrderRow,
  PrescriptionRow,
  WalkinRow,
} from '../kkd-activity.domain';

/** A farmer by `pii_id`, else by mobile — many franchise rows carry only the phone. */
const anyOf = (piiIds: readonly string[], phones: readonly string[]) => ({
  $or: [
    ...(piiIds.length ? [{ pii_id: { $in: [...piiIds] } }] : []),
    ...(phones.length ? [{ phone: { $in: [...phones] } }] : []),
  ],
});

/**
 * What farmers do at a franchise / KKD store, from the franchise backend's
 * collections (read-only): walk-ins, crop advice (prescriptions) and the old
 * POS archive of orders made before the POS wrote to StockShip.
 */
@Injectable()
export class StoreActivityRepository {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async walkins(
    piiIds: readonly string[],
    phones: readonly string[],
    since: Date,
    cap: number,
  ): Promise<WalkinRow[]> {
    if (!piiIds.length && !phones.length) return [];
    return this.connection
      .collection<WalkinRow>('franchise_v2_walkins')
      .find(
        { ...anyOf(piiIds, phones), walked_in_at: { $gte: since } },
        {
          projection: {
            _id: 1,
            franchise_id: 1,
            walked_in_at: 1,
            pii_id: 1,
            phone: 1,
            status: 1,
            notes: 1,
            crop: 1,
          },
          sort: { walked_in_at: -1 },
          limit: cap,
        },
      )
      .toArray();
  }

  async prescriptions(
    piiIds: readonly string[],
    phones: readonly string[],
    since: Date,
    cap: number,
  ): Promise<PrescriptionRow[]> {
    if (!piiIds.length && !phones.length) return [];
    return this.connection
      .collection<PrescriptionRow>('franchise_v2_prescriptions')
      .find(
        { ...anyOf(piiIds, phones), rx_date: { $gte: since } },
        {
          projection: {
            _id: 1,
            rx_id: 1,
            franchise_id: 1,
            rx_date: 1,
            pii_id: 1,
            phone: 1,
            crop: 1,
            problem: 1,
            solution: 1,
            'products.name': 1,
            'products.sku': 1,
          },
          sort: { rx_date: -1 },
          limit: cap,
        },
      )
      .toArray();
  }

  async posOrders(
    piiIds: readonly string[],
    phones: readonly string[],
    since: Date,
    cap: number,
  ): Promise<PosOrderRow[]> {
    if (!piiIds.length && !phones.length) return [];
    const rows = await this.connection
      .collection<PosOrderRow>('franchise_v2_pos_orders')
      .find(
        { ...anyOf(piiIds, phones), order_date: { $gte: since } },
        {
          projection: {
            _id: 0,
            order_id: 1,
            franchise_id: 1,
            order_date: 1,
            pii_id: 1,
            phone: 1,
            amount: 1,
            in_stockship: 1,
            'items.product': 1,
            'items.sku': 1,
            'items.quantity': 1,
          },
          sort: { order_date: -1 },
          limit: cap,
        },
      )
      .toArray();
    return rows.map((r) => ({ ...r, items: r.items ?? [] }));
  }
}
