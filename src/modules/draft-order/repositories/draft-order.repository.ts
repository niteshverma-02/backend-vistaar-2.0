import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';

import type { DraftFormData } from '../draft-order.domain';
import {
  DRAFT_ENTRY_PATH,
  DraftOrder,
  type DraftOrderRecord,
} from '../schemas/draft-order.schema';

/** The `app_counters` row every `draft_orders` writer takes its ids from. */
const COUNTER_ID = 'draft_orders';

interface CounterRow {
  _id: string;
  count: number;
}

/** What a draft write sets; ownership fields are the repository's job. */
export interface DraftWrite {
  contact_id: string | null;
  customer_name: string | null;
  contact_number: string | null;
  form_data: DraftFormData;
  grand_total: number;
}

/**
 * Which draft is "this customer's": phone and name for a customer, both
 * `null` for the partner's own stock. These two are on every writer's rows,
 * where `contact_id` is not.
 */
export interface CustomerKey {
  contact_number: string | null;
  customer_name: string | null;
}

@Injectable()
export class DraftOrderRepository {
  constructor(
    @InjectModel(DraftOrder.name)
    private readonly model: Model<DraftOrder>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /**
   * The next `DFT-n` count. The same atomic `$inc` the other writers make, so
   * the ids stay one series and the unique `draft_order_id` index holds.
   * Never upserted: the row is not ours to create.
   */
  async nextCount(): Promise<number | null> {
    const row = await this.connection
      .collection<CounterRow>('app_counters')
      .findOneAndUpdate(
        { _id: COUNTER_ID },
        { $inc: { count: 1 }, $set: { updated_at: new Date() } },
        { returnDocument: 'after', projection: { count: 1 } },
      );
    return row?.count ?? null;
  }

  findOpen(
    partnerId: string,
    key: CustomerKey,
  ): Promise<DraftOrderRecord | null> {
    return this.model
      .findOne({ ...this.openFilter(partnerId), ...key })
      .sort({ updated_at: -1 })
      .lean<DraftOrderRecord>()
      .exec();
  }

  /** Every open draft under the key, oldest first — one, unless two saves raced. */
  findAllOpen(
    partnerId: string,
    key: CustomerKey,
  ): Promise<DraftOrderRecord[]> {
    return this.model
      .find({ ...this.openFilter(partnerId), ...key })
      .sort({ created_at: 1, _id: 1 })
      .lean<DraftOrderRecord[]>()
      .exec();
  }

  findOne(partnerId: string, id: string): Promise<DraftOrderRecord | null> {
    return this.model
      .findOne({ ...this.openFilter(partnerId), draft_order_id: id })
      .lean<DraftOrderRecord>()
      .exec();
  }

  async insert(
    partnerId: string,
    draftOrderId: string,
    data: DraftWrite,
  ): Promise<DraftOrderRecord> {
    const created = await this.model.create({
      draft_order_id: draftOrderId,
      agent_id: partnerId,
      deal_id: null,
      status: 'draft',
      order_id: null,
      entry_path: DRAFT_ENTRY_PATH,
      reminder_sent: false,
      ...data,
    });
    return created.toObject<DraftOrderRecord>();
  }

  /** A fresh save resets the reminder: the cart it was about has changed. */
  replace(
    partnerId: string,
    id: string,
    data: DraftWrite,
  ): Promise<DraftOrderRecord | null> {
    return this.model
      .findOneAndUpdate(
        { ...this.openFilter(partnerId), draft_order_id: id },
        { $set: { ...data, reminder_sent: false }, $inc: { __v: 1 } },
        { returnDocument: 'after' },
      )
      .lean<DraftOrderRecord>()
      .exec();
  }

  /**
   * A partner keeps a handful of drafts, so the `agent_id` index narrows to
   * them and the sort runs over that handful.
   */
  async list(
    partnerId: string,
    skip: number,
    limit: number,
  ): Promise<[DraftOrderRecord[], number]> {
    const filter = this.openFilter(partnerId);

    return Promise.all([
      this.model
        .find(filter)
        .sort({ updated_at: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean<DraftOrderRecord[]>()
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);
  }

  /** HO's read: every partner's open drafts (or one partner's), last saved first. */
  async adminList(
    partnerId: string | null,
    skip: number,
    limit: number,
  ): Promise<[DraftOrderRecord[], number]> {
    const filter = {
      entry_path: DRAFT_ENTRY_PATH,
      status: 'draft' as const,
      ...(partnerId ? { agent_id: partnerId } : {}),
    };
    return Promise.all([
      this.model
        .find(filter)
        .sort({ updated_at: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean<DraftOrderRecord[]>()
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);
  }

  markReminderSent(
    partnerId: string,
    id: string,
  ): Promise<DraftOrderRecord | null> {
    return this.model
      .findOneAndUpdate(
        { ...this.openFilter(partnerId), draft_order_id: id },
        { $set: { reminder_sent: true } },
        { returnDocument: 'after' },
      )
      .lean<DraftOrderRecord>()
      .exec();
  }

  async delete(partnerId: string, id: string): Promise<boolean> {
    const result = await this.model
      .deleteOne({ ...this.openFilter(partnerId), draft_order_id: id })
      .exec();
    return result.deletedCount === 1;
  }

  // `agent_id` + `entry_path` are in every filter: they keep a partner to
  // their own drafts, and Vistaar off the B2B portal's and Sankalp's rows.
  private openFilter(partnerId: string) {
    return {
      agent_id: partnerId,
      entry_path: DRAFT_ENTRY_PATH,
      status: 'draft' as const,
    };
  }
}
