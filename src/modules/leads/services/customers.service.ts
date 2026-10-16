import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import type { PartnerRef } from '@common/auth/current-partner.decorator';
import { notFound, serviceUnavailable } from '@common/errors/api-error';
import { PageResult } from '@common/http/page-result';
import { istMonthKey, istMonthStart } from '@common/utils/ist-day.util';
import {
  OrderService,
  type CustomerBusiness,
} from '@modules/orders/services/order.service';
import type { OrderStage } from '@modules/orders/orders.domain';
import { SettingsService } from '@modules/settings/services/settings.service';

import type {
  AdminCustomerQueryDto,
  CustomerQueryDto,
  OrderEventDto,
} from '../dto/customer.dto';
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
import {
  LeadsService,
  type AdminLeadDetail,
  type PartnerLeadView,
} from './leads.service';

/** A customer on HO's list: the lead row, its partner, and the business. */
export type AdminCustomerView = PartnerLeadView & {
  orders: number;
  spend: number;
  last_order_stage: OrderStage | null;
};

export type AdminCustomerDetail = AdminLeadDetail & {
  orders: number;
  spend: number;
  last_order_stage: OrderStage | null;
  average_order: number;
};

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
  /** Shop stock, or a farmer this partner does not hold. */
  reason?: 'not_held';
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
 * order from the partner who holds them — no "add customer"; the order
 * service (TL) says when. The customer is the partner's `vistaar_v2_leads`
 * row at stage `won`; their orders and spend are read from `orders_v2` for
 * the lists.
 */
@Injectable()
export class CustomersService {
  constructor(
    private readonly rows: VistaarLeadsRepository,
    private readonly orders: OrderService,
    private readonly settings: SettingsService,
    private readonly leads: LeadsService,
  ) {}

  // ── HO ───────────────────────────────────────────────────────────────

  /**
   * Every partner's customers (won leads), filtered and paged as
   * `/admin/leads`, each with their confirmed Vistaar business — one orders
   * read for the page.
   */
  async adminList(
    query: AdminCustomerQueryDto,
  ): Promise<PageResult<AdminCustomerView>> {
    query.stage = 'won';
    const page = await this.leads.list(query);
    const business = await this.orders.businessOfBuyers(
      page.items.map((r) => r.pii_id),
    );
    return new PageResult(
      page.items.map((r) => ({
        ...r,
        ...businessOf(business.get(r.pii_id)),
        last_order_at: business.get(r.pii_id)?.last_order_at ?? r.last_order_at,
      })),
      page.total,
      query,
    );
  }

  /** HO's customer cards; order value is `/admin/orders/summary`. */
  async adminSummary() {
    const now = new Date();
    const summary = await this.rows.customerSummary({
      active: new Date(now.getTime() - ACTIVE_DAYS * DAY_MS),
      month: istMonthStart(istMonthKey(now)),
    });
    const names = await this.leads.partnerNames(
      summary.by_partner.map((p) => p.key),
    );
    return {
      ...summary,
      by_partner: summary.by_partner.map((p) => ({
        ...p,
        name: names.get(p.key)?.name ?? null,
      })),
    };
  }

  /** One customer as HO sees them; their orders are `/admin/orders?customer=`. */
  async adminGet(piiId: string): Promise<AdminCustomerDetail> {
    const lead = await this.leads.get(piiId);
    if (lead.stage !== 'won') throw notFound('Customer not found.');
    const mine = (await this.orders.businessOfBuyers([lead.pii_id])).get(
      lead.pii_id,
    );
    const done = businessOf(mine);
    return {
      ...lead,
      ...done,
      last_order_at: mine?.last_order_at ?? lead.last_order_at,
      average_order: done.orders ? Math.round(done.spend / done.orders) : 0,
    };
  }

  /**
   * The order service says an order is confirmed (TL's order API) — trusted
   * as sent. The first one makes the lead won, once; later ones move the last
   * order. Safe to repeat.
   */
  async recordOrder(event: OrderEventDto): Promise<OrderEventResult> {
    const date = event.order_date ? new Date(event.order_date) : new Date();
    for (let attempt = 0; attempt < TRIES; attempt++) {
      const row = await this.rows.findByPii(event.pii_id);
      // Shop stock (the partner's own pii) and farmers they do not hold.
      if (!row || row.agent_id !== event.agent_id) {
        return { result: 'ignored', reason: 'not_held' };
      }
      if (row.customer_at) {
        await this.rows.update(row.pii_id, row.agent_id, {
          $max: { last_order_at: date },
          $min: { customer_at: date },
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
            customer_at: date,
            last_order_at: date,
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
                  `First order ${event.order_id} confirmed — now a customer`,
                  now,
                ),
              ],
              $slice: -MAX_ACTIVITIES,
            },
          },
        },
        { stage: row.stage, customer_at: null },
      );
      if (won) {
        await this.leads.mirrorFollowUp(
          won.lead_id,
          row.next_follow_up,
          won.next_follow_up,
        );
        return { result: 'won', pii_id: row.pii_id };
      }
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
    const [customers, orderedIn] = await Promise.all([
      this.customersOf(partner, query.q),
      query.ordered_in
        ? this.orders.buyersIn(partner.agent_id, query.ordered_in)
        : null,
    ]);
    const all = customers.filter(
      (c) =>
        (!crop || c.crops.some((x) => x.toLowerCase() === crop)) &&
        (!orderedIn || orderedIn.has(c.pii_id)),
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
    // Only this farmer's orders, not the partner's whole book.
    const [business, window] = await Promise.all([
      this.orders.businessByCustomer(partner.agent_id, [row.pii_id]),
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
