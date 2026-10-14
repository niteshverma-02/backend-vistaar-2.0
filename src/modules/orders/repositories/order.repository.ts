import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { VISTAAR_ORDER_SOURCE } from '../orders.domain';
import { Order, type OrderRecord } from '../schemas/order.schema';

/**
 * What the app shows. Everything else on an order — courier rate cards,
 * payment screenshots, ops messages — stays in Mongo.
 */
const PROJECTION = {
  order_id: 1,
  date: 1,
  pii_id: 1,
  customer: 1,
  shipping_address: 1,
  payment_mode: 1,
  items: 1,
  total_amount: 1,
  original_total_amount: 1,
  cod_amount: 1,
  prepaid_amount: 1,
  discounts: 1,
  coin: 1,
  extra_charges: 1,
  order_status: 1,
  order_status_map: 1,
  'booking_details.awb_number': 1,
  'booking_details.booking_courier': 1,
  created_at: 1,
} as const;

/** HO also needs whose order it is and where it ships (state / city / pincode filters). */
const ADMIN_PROJECTION = { ...PROJECTION, agent: 1 } as const;

/** One customer's confirmed business with one partner. */
export interface CustomerOrderStats {
  pii_id: string;
  orders: number;
  spend: number;
  last_order_at: Date;
  last_status: string;
}

/** What HO narrows the whole Vistaar book by. */
export interface AdminOrderFilter {
  statuses: string[] | null;
  agentId: string | null;
  /** Placed at or after (UTC instant of an IST midnight). */
  from: Date | null;
  /** Placed before. */
  to: Date | null;
}

/** Read-only: `orders_v2` belongs to Stockship. */
@Injectable()
export class OrderRepository {
  constructor(@InjectModel(Order.name) private readonly model: Model<Order>) {}

  /**
   * Rides Stockship's `{ agent, order_status, date }` index: `agent` narrows
   * to one partner's orders, and a status filter is an `$in` on the second key.
   */
  async list(
    partnerId: string,
    statuses: string[] | null,
    skip: number,
    limit: number,
    piiId: string | null = null,
  ): Promise<[OrderRecord[], number]> {
    const filter = {
      ...this.ownFilter(partnerId),
      ...(statuses ? { order_status: { $in: statuses } } : {}),
      ...(piiId ? { pii_id: piiId } : {}),
    };

    const rows = await this.model
      .find(filter, PROJECTION)
      .sort({ date: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean<OrderRecord[]>()
      .exec();
    // A short page is the last one, so the total is known without a count —
    // most partners have fewer orders than one page. A full page counts.
    if (rows.length < limit && (rows.length > 0 || skip === 0)) {
      return [rows, skip + rows.length];
    }
    return [rows, await this.model.countDocuments(filter).exec()];
  }

  findOne(partnerId: string, orderId: string): Promise<OrderRecord | null> {
    return this.model
      .findOne({ ...this.ownFilter(partnerId), order_id: orderId }, PROJECTION)
      .lean<OrderRecord>()
      .exec();
  }

  /**
   * Per farmer: the partner's orders in `statuses`, their total and the
   * latest. One pass over the partner's own orders (`{ agent, order_status,
   * date }` index) — a partner has hundreds, not millions.
   */
  customerStats(
    partnerId: string,
    statuses: readonly string[],
    piiIds?: readonly string[],
  ): Promise<CustomerOrderStats[]> {
    return this.model
      .aggregate<CustomerOrderStats>([
        {
          $match: {
            ...this.ownFilter(partnerId),
            order_status: { $in: statuses },
            pii_id: piiIds ? { $in: piiIds } : { $type: 'string' },
          },
        },
        { $sort: { date: -1 } },
        {
          $group: {
            _id: '$pii_id',
            orders: { $sum: 1 },
            spend: { $sum: { $ifNull: ['$total_amount', 0] } },
            last_order_at: { $first: '$date' },
            last_status: { $first: '$order_status' },
          },
        },
        {
          $project: {
            _id: 0,
            pii_id: '$_id',
            orders: 1,
            spend: 1,
            last_order_at: 1,
            last_status: 1,
          },
        },
      ])
      .exec();
  }

  /**
   * Every partner's orders. Rides Stockship's `{ source, order_status, date }`
   * index (or `{ agent, order_status, date }` with a partner), so the
   * channel's other orders are never scanned.
   */
  async adminList(
    filter: AdminOrderFilter,
    skip: number,
    limit: number,
  ): Promise<[OrderRecord[], number]> {
    const query = this.adminFilter(filter);
    const [rows, total] = await Promise.all([
      this.model
        .find(query, ADMIN_PROJECTION)
        .sort({ date: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean<OrderRecord[]>()
        .exec(),
      this.model.countDocuments(query).exec(),
    ]);
    return [rows, total];
  }

  adminFindOne(orderId: string): Promise<OrderRecord | null> {
    return this.model
      .findOne(
        { source: VISTAAR_ORDER_SOURCE, order_id: orderId },
        ADMIN_PROJECTION,
      )
      .lean<OrderRecord>()
      .exec();
  }

  private adminFilter(f: AdminOrderFilter) {
    const date: Record<string, Date> = {};
    if (f.from) date.$gte = f.from;
    if (f.to) date.$lt = f.to;
    return {
      source: VISTAAR_ORDER_SOURCE,
      ...(f.agentId ? { agent: f.agentId } : {}),
      ...(f.statuses ? { order_status: { $in: f.statuses } } : {}),
      ...(f.from || f.to ? { date } : {}),
    };
  }

  // `agent` + `source` are in every filter: they keep a partner to their own
  // orders, and Vistaar off every other channel's.
  private ownFilter(partnerId: string) {
    return { agent: partnerId, source: VISTAAR_ORDER_SOURCE };
  }
}
