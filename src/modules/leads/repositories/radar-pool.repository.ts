import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

import { KKD_SOURCES, type PinPeople } from '../radar.domain';

const PIN = /^\d{6}$/;
/**
 * The pool reads scan; a secondary takes them, so the primary's writes never
 * wait on a radar build. 500 pincodes per round trip.
 */
const POOL_READ = {
  allowDiskUse: true,
  batchSize: 500,
  readPreference: 'secondaryPreferred',
} as const;

/** One KKD lead, as a pincode's list shows it. */
export interface KkdLeadRow {
  pii_id: string;
  first_name?: string | null;
  last_name?: string | null;
  state?: string | null;
  pin_code?: string | null;
  source?: string | null;
  has_app?: boolean | null;
  created_at?: Date | null;
}

/** One org customer, as a pincode's list shows it. */
export interface OrgCustomerRow {
  pii_id: string;
  first_name?: string | null;
  last_name?: string | null;
  number?: string | null;
  pincode?: string | number | null;
  pinCode?: string | number | null;
  order_count?: number | null;
  last_order_date?: Date | null;
}

/**
 * The tail every pool read shares: one row per person at their newest
 * pincode (`top`), then one row per pincode with its people newest first.
 * The database does the grouping, so a build moves ~32k rows, not ~480k
 * (main, 2026-10-27: 1–40 s per collection, by the cluster's load).
 */
const byPincode = [
  {
    $group: {
      _id: '$top.pin',
      people: { $push: { i: '$_id', t: '$top.t' } },
    },
  },
  {
    $project: {
      _id: 0,
      pin: '$_id',
      ids: {
        $map: {
          input: { $sortArray: { input: '$people', sortBy: { t: -1, i: 1 } } },
          in: '$$this.i',
        },
      },
    },
  },
];

const toFiled = (r: { pin?: unknown; ids?: unknown }): PinPeople => ({
  pin: String(r.pin),
  ids: Array.isArray(r.ids)
    ? r.ids.filter((i): i is string => typeof i === 'string')
    : [],
});

/**
 * The org's `leads_v2` (KKD channels) and `customers`, **read-only** — no
 * schema or index is declared on either; both are ko-sales' collections.
 * The two pool reads scan once an hour; the page reads ride `{pii_id}`.
 */
@Injectable()
export class RadarPoolRepository {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  /** KKD leads by pincode: each person once, at their newest lead's pincode. */
  async *kkdByPincode(): AsyncGenerator<PinPeople> {
    const cursor = this.connection.collection('leads_v2').aggregate(
      [
        {
          $match: {
            source: { $in: [...KKD_SOURCES] },
            pin_code: { $regex: PIN },
            pii_id: { $type: 'string' },
          },
        },
        {
          $group: {
            _id: '$pii_id',
            // A document's max compares field by field, `t` first: the
            // newest lead's pincode, without a sort ($top took 3× longer).
            top: { $max: { t: '$created_at', pin: '$pin_code' } },
          },
        },
        ...byPincode,
      ],
      POOL_READ,
    );
    for await (const r of cursor) yield toFiled(r);
  }

  /**
   * Org customers by pincode: each person once, at their latest order's row.
   * Rows carry `pincode` or the older `pinCode`.
   */
  async *customersByPincode(): AsyncGenerator<PinPeople> {
    const asText = (field: string) => ({
      $convert: { input: field, to: 'string', onError: '', onNull: '' },
    });
    const cursor = this.connection.collection('customers').aggregate(
      [
        { $match: { pii_id: { $type: 'string' } } },
        {
          $project: {
            pii_id: 1,
            t: '$last_order_date',
            a: asText('$pincode'),
            b: asText('$pinCode'),
          },
        },
        {
          $project: {
            pii_id: 1,
            t: 1,
            pin: {
              $cond: [{ $regexMatch: { input: '$a', regex: PIN } }, '$a', '$b'],
            },
          },
        },
        { $match: { pin: { $regex: PIN } } },
        {
          $group: {
            _id: '$pii_id',
            top: { $max: { t: '$t', pin: '$pin' } },
          },
        },
        ...byPincode,
      ],
      POOL_READ,
    );
    for await (const r of cursor) yield toFiled(r);
  }

  /** These people's KKD leads (a person may have one per channel). */
  kkdLeads(piiIds: readonly string[]): Promise<KkdLeadRow[]> {
    return this.connection
      .collection<KkdLeadRow>('leads_v2')
      .find(
        { pii_id: { $in: [...piiIds] }, source: { $in: [...KKD_SOURCES] } },
        {
          projection: {
            _id: 0,
            pii_id: 1,
            first_name: 1,
            last_name: 1,
            state: 1,
            pin_code: 1,
            source: 1,
            has_app: 1,
            created_at: 1,
          },
        },
      )
      .toArray();
  }

  /** These people's org customer rows. */
  customers(piiIds: readonly string[]): Promise<OrgCustomerRow[]> {
    return this.connection
      .collection<OrgCustomerRow>('customers')
      .find(
        { pii_id: { $in: [...piiIds] } },
        {
          projection: {
            _id: 0,
            pii_id: 1,
            first_name: 1,
            last_name: 1,
            number: 1,
            pincode: 1,
            pinCode: 1,
            order_count: 1,
            last_order_date: 1,
          },
        },
      )
      .toArray();
  }
}
