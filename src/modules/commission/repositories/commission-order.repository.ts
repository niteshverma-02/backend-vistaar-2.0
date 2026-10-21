import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

import {
  MARK_STATUSES,
  NOT_COUNTED,
  VISTAAR_MARKETPLACE,
  markTimes,
  personName,
} from '@modules/orders/orders.domain';

import type { OrderFact } from '../commission.domain';

interface FactRow {
  order_id: string;
  date?: Date;
  created_at?: Date;
  pii_id?: string | null;
  first_name?: string;
  last_name?: string;
  order_status?: string;
  items: { sku?: string; qty?: number; total?: number; free?: boolean }[];
  discount?: number;
  coin?: number;
  marks: { stage_name?: string; timestamp?: Date }[];
  last_at?: Date | null;
}

/**
 * A partner's orders as commission reads them, from Stockship's `orders_v2`
 * (read-only; the orders module reads the same rows for its screens). One
 * aggregation per partner on the `{ agent, order_status, date }` index; the
 * status history is cut down in the database to the entries that date a
 * delivery or a cancellation, so a partner with a thousand orders is ~300 KB
 * over the wire, not megabytes.
 */
@Injectable()
export class CommissionOrderRepository {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async factsFor(agentId: string): Promise<OrderFact[]> {
    const rows = await this.connection
      .collection('orders_v2')
      .aggregate<FactRow>([
        {
          $match: {
            agent: agentId,
            marketplace: VISTAAR_MARKETPLACE,
            order_status: { $nin: [...NOT_COUNTED] },
          },
        },
        {
          $project: {
            _id: 0,
            order_id: 1,
            date: 1,
            created_at: 1,
            pii_id: 1,
            first_name: '$customer.first_name',
            last_name: '$customer.last_name',
            order_status: 1,
            items: {
              $map: {
                input: { $ifNull: ['$items', []] },
                as: 'i',
                in: {
                  sku: '$$i.sku',
                  qty: '$$i.qty',
                  total: '$$i.total_price',
                  free: '$$i.is_free',
                },
              },
            },
            discount: { $sum: '$discounts.discount_amount' },
            coin: 1,
            marks: {
              $filter: {
                input: { $ifNull: ['$order_status_map', []] },
                as: 'e',
                cond: {
                  $in: [
                    {
                      $toLower: {
                        $trim: { input: { $ifNull: ['$$e.stage_name', ''] } },
                      },
                    },
                    MARK_STATUSES,
                  ],
                },
              },
            },
            last_at: { $max: '$order_status_map.timestamp' },
          },
        },
      ])
      .toArray();

    return rows.map((r) => {
      const placedAt = r.date ?? r.created_at ?? new Date(0);
      return {
        order_id: r.order_id,
        placed_at: placedAt,
        pii_id: r.pii_id ?? null,
        customer_name: personName(r.first_name, r.last_name),
        order_status: r.order_status ?? '',
        lines: r.items.map((i) => ({
          sku: i.sku ?? '',
          qty: num(i.qty),
          total: num(i.total),
          free: i.free === true,
        })),
        deduction: num(r.discount) + num(r.coin),
        ...markTimes(r.marks, r.order_status, r.last_at ?? placedAt),
      };
    });
  }
}

const num = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : 0;
