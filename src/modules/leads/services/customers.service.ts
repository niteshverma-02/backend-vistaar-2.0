import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import type { PartnerRef } from '@common/auth/current-partner.decorator';
import { notFound, serviceUnavailable } from '@common/errors/api-error';
import { PageResult } from '@common/http/page-result';
import {
  OrderService,
  type CustomerBusiness,
} from '@modules/orders/services/order.service';
import type { OrderStage } from '@modules/orders/orders.domain';
import { SettingsService } from '@modules/settings/services/settings.service';

import type { CustomerQueryDto } from '../dto/customer.dto';
import {
  detailOf,
  viewOf,
  type LeadDetail,
  type LeadView,
} from '../lead-views';
import {
  MAX_ACTIVITIES,
  MAX_STAGE_HISTORY,
  SYSTEM_ACTOR,
  searchOf,
  type ReleaseWindow,
} from '../leads.domain';
import {
  VistaarLeadsRepository,
  type VistaarLeadBrief,
} from '../repositories/vistaar-leads.repository';
import type { LeadActivity } from '../schemas/vistaar-lead.schema';

/** A customer: the partner's won lead with their business together. */
export type CustomerView = LeadView & {
  orders: number;
  spend: number;
  /** Stage of the latest order (`shipped` = "Order in transit"). */
  last_order_stage: OrderStage | null;
};

export type CustomerDetail = LeadDetail &
  Omit<CustomerView, keyof LeadView> & { average_order: number };

export interface CustomerSummary {
  total: number;
  /** Ordered in the last 30 days. */
  active_30_days: number;
  /** Σ spend. */
  total_business: number;
  /** Crop chips, most customers first. */
  crops: { key: string; count: number }[];
}

/** What a confirmed-order call did, for the order service's log. */
export interface OrderEventResult {
  result: 'won' | 'updated' | 'ignored';
  reason?: 'not_a_vistaar_order' | 'not_confirmed' | 'no_buyer' | 'not_held';
  pii_id?: string;
}

const DAY_MS = 24 * 3600 * 1000;
const ACTIVE_DAYS = 30;
/** Tries when the lead changes between reading and writing it. */
const TRIES = 3;

type Sorter = (a: CustomerView, b: CustomerView) => number;

const SORTS: Record<string, Sorter> = {
  '-spend': (a, b) => b.spend - a.spend,
  name: (a, b) => a.name.localeCompare(b.name),
};
const byLatestOrder: Sorter = (a, b) =>
  (b.last_order_at?.getTime() ?? 0) - (a.last_order_at?.getTime() ?? 0);

/**
 * Customers (PRD C1–C3): a farmer becomes one with their first confirmed
 * order from the partner who holds them — no "add customer". The customer is
 * the partner's `vistaar_v2_leads` row at stage `won`; their business is read
 * from `orders_v2`, so it can never drift from Stockship's book.
 */
@Injectable()
export class CustomersService {
  constructor(
    private readonly rows: VistaarLeadsRepository,
    private readonly orders: OrderService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Stockship confirmed an order (the order service calls). The order is read
   * again from `orders_v2`, so the call carries nothing to trust. The first
   * confirmed order makes the lead won, once; later ones move the last order.
   * Safe to repeat.
   */
  async recordOrder(orderId: string): Promise<OrderEventResult> {
    const order = await this.orders.facts(orderId);
    if (!order) return { result: 'ignored', reason: 'not_a_vistaar_order' };
    if (!order.confirmed) return { result: 'ignored', reason: 'not_confirmed' };
    if (!order.pii_id || !order.agent) {
      return { result: 'ignored', reason: 'no_buyer' };
    }

    for (let attempt = 0; attempt < TRIES; attempt++) {
      const row = await this.rows.findByPii(order.pii_id);
      // Shop stock (the partner's own pii) and farmers they do not hold.
      if (!row || row.agent_id !== order.agent) {
        return { result: 'ignored', reason: 'not_held' };
      }
      if (row.customer_at) {
        await this.rows.update(row.pii_id, row.agent_id, {
          $max: { last_order_at: order.date },
          $min: { customer_at: order.date },
        });
        return { result: 'updated', pii_id: row.pii_id };
      }
      const now = new Date();
      const won = await this.rows.update(
        row.pii_id,
        row.agent_id,
        {
          $set: {
            stage: 'won',
            customer_at: order.date,
            last_order_at: order.date,
            lost_reason: null,
            next_follow_up: null,
          },
          $push: {
            stage_history: {
              $each: [
                { from: row.stage, to: 'won', at: now, by: SYSTEM_ACTOR },
              ],
              $slice: -MAX_STAGE_HISTORY,
            },
            activities: {
              $each: [
                activity(
                  `First order ${order.order_id} confirmed — now a customer`,
                  now,
                ),
              ],
              $slice: -MAX_ACTIVITIES,
            },
          },
        },
        { stage: row.stage, customer_at: null },
      );
      if (won) return { result: 'won', pii_id: row.pii_id };
      // The partner moved the lead meanwhile: read it again.
    }
    throw serviceUnavailable(
      'LEADS_UNAVAILABLE',
      'The lead kept changing — send the order again.',
    );
  }

  /** The Customers screen: search, a crop chip, then the app's sorts. */
  async list(
    partner: PartnerRef,
    query: CustomerQueryDto,
  ): Promise<PageResult<CustomerView>> {
    const crop = query.crop?.toLowerCase();
    const all = (await this.customersOf(partner, query.q)).filter(
      (c) => !crop || c.crops.some((x) => x.toLowerCase() === crop),
    );
    all.sort(SORTS[query.sort] ?? byLatestOrder);
    return new PageResult(
      all.slice(query.skip, query.skip + query.limit),
      all.length,
      query,
    );
  }

  /** The Customers screen's tiles and crop chips. */
  async summary(partner: PartnerRef): Promise<CustomerSummary> {
    const all = await this.customersOf(partner);
    const since = Date.now() - ACTIVE_DAYS * DAY_MS;
    // One chip per crop whatever its case, as the crop filter matches.
    const crops = new Map<string, { key: string; count: number }>();
    for (const c of all) {
      for (const crop of new Set(c.crops.map((x) => x.toLowerCase()))) {
        const chip = crops.get(crop);
        if (chip) chip.count += 1;
        else
          crops.set(crop, {
            key: c.crops.find((x) => x.toLowerCase() === crop) ?? crop,
            count: 1,
          });
      }
    }
    return {
      total: all.length,
      active_30_days: all.filter(
        (c) => (c.last_order_at?.getTime() ?? 0) >= since,
      ).length,
      total_business: all.reduce((sum, c) => sum + c.spend, 0),
      crops: [...crops.values()].sort(
        (a, b) => b.count - a.count || a.key.localeCompare(b.key),
      ),
    };
  }

  /** One customer; their orders are `GET /orders?customer=<pii_id>`. */
  async get(partner: PartnerRef, piiId: string): Promise<CustomerDetail> {
    const row = await this.rows.findByPii(piiId.toUpperCase());
    if (!row || row.agent_id !== partner.agent_id || row.stage !== 'won') {
      throw notFound('Customer not found.');
    }
    const [business, window] = await Promise.all([
      this.orders.businessByCustomer(partner.agent_id),
      this.window(),
    ]);
    const mine = business.get(row.pii_id);
    const done = businessOf(mine);
    return {
      ...detailOf(row, window),
      ...done,
      last_order_at: mine?.last_order_at ?? row.last_order_at,
      average_order: done.orders ? Math.round(done.spend / done.orders) : 0,
    };
  }

  private async customersOf(
    partner: PartnerRef,
    q?: string,
  ): Promise<CustomerView[]> {
    const [rows, business, window] = await Promise.all([
      this.rows.all({
        agent_id: partner.agent_id,
        stage: 'won',
        ...searchOf(q),
      }),
      this.orders.businessByCustomer(partner.agent_id),
      this.window(),
    ]);
    return rows.map((row) => customerOf(row, business.get(row.pii_id), window));
  }

  private async window(): Promise<ReleaseWindow> {
    const s = await this.settings.get();
    return {
      lead_days: s.lead_release_days,
      customer_days: s.customer_release_days,
    };
  }
}

function businessOf(b: CustomerBusiness | undefined) {
  return {
    orders: b?.orders ?? 0,
    spend: b?.spend ?? 0,
    last_order_stage: b?.last_order_stage ?? null,
  };
}

function customerOf(
  row: VistaarLeadBrief,
  business: CustomerBusiness | undefined,
  window: ReleaseWindow,
): CustomerView {
  return {
    ...viewOf(row, window),
    ...businessOf(business),
    last_order_at: business?.last_order_at ?? row.last_order_at,
  };
}

function activity(text: string, at: Date): LeadActivity {
  return { id: randomUUID(), type: 'stage_change', text, at, by: SYSTEM_ACTOR };
}
