import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection, Types } from 'mongoose';

import {
  APP_CART_EVENT,
  APP_OPEN_EVENT,
  type KkdEventRow,
} from '../kkd-activity.domain';

interface EventDoc {
  _id: Types.ObjectId;
  user_id?: string | null;
  event_name?: string | null;
  created_at?: Date | null;
  event_values?: {
    total_price?: number | null;
    items?: { name?: string; quantity?: number }[] | null;
  } | null;
}

/**
 * The Katyayani app's own events in `kkd_events` (read-only), keyed by the
 * farmer's ten-digit mobile in `user_id`: app opens and abandoned carts.
 */
@Injectable()
export class KkdEventsRepository {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async since(
    phones: readonly string[],
    since: Date,
    cap: number,
  ): Promise<KkdEventRow[]> {
    if (phones.length === 0) return [];
    const rows = await this.connection
      .collection<EventDoc>('kkd_events')
      .find(
        {
          user_id: { $in: [...phones] },
          event_name: { $in: [APP_OPEN_EVENT, APP_CART_EVENT] },
          created_at: { $gte: since },
        },
        {
          projection: {
            _id: 1,
            user_id: 1,
            event_name: 1,
            created_at: 1,
            'event_values.total_price': 1,
            'event_values.items.name': 1,
            'event_values.items.quantity': 1,
          },
          sort: { created_at: -1 },
          limit: cap,
        },
      )
      .toArray();
    return rows.map((r) => ({
      _id: r._id.toHexString(),
      user_id: r.user_id ?? null,
      event_name: r.event_name ?? null,
      created_at: r.created_at ?? null,
      total_price: r.event_values?.total_price ?? null,
      items: r.event_values?.items ?? null,
    }));
  }
}
