import { Injectable } from '@nestjs/common';

import { badRequest, notFound } from '@common/errors/api-error';
import { DAY_MS, istMonthKey, istMonthStart } from '@common/utils/ist-day.util';
import { PageResult } from '@common/http/page-result';
import {
  AgentsService,
  type AgentRecord,
} from '@modules/agents/services/agents.service';
import type { OrderCommission } from '@modules/commission/services/commission.service';

import type {
  AdminOrderBreakdown,
  AdminOrderSummary,
  AdminOrderView,
  AdminOrdersQueryDto,
  OrderPartner,
} from '../dto/admin-order.dto';
import { istDate } from '@modules/attendance/attendance.domain';
import { ProductFactsService } from '@modules/spine/services/product-facts.service';

import {
  ORDER_STAGES,
  firstUrl,
  stageOf,
  statusesFor,
  type OrderStage,
} from '../orders.domain';
import type { AdminOrderFilter } from '../repositories/order.repository';
import { OrderRepository } from '../repositories/order.repository';
import type { OrderRecord } from '../schemas/order.schema';
import { checkedRange, orderView, OrderService } from './order.service';

/**
 * Head office's read of every partner's orders. Same mapping as the app's
 * `/orders` (one `orderView`), so HO and the partner see the same order.
 */
@Injectable()
export class AdminOrderService {
  constructor(
    private readonly orders: OrderRepository,
    private readonly agents: AgentsService,
    private readonly partnerOrders: OrderService,
    private readonly catalogue: ProductFactsService,
  ) {}

  async list(query: AdminOrdersQueryDto): Promise<PageResult<AdminOrderView>> {
    const [rows, total] = await this.orders.adminList(
      filterOf(query),
      query.skip,
      query.limit,
    );
    const views = await this.views(rows);
    return new PageResult(views, total, query);
  }

  /** The Orders screen's cards for the same filters as the list. */
  /**
   * The cards for a date range — this IST month when none is given, at most
   * a year: the sums read every matching order, so the range bounds the work.
   */
  async summary(query: AdminOrdersQueryDto): Promise<AdminOrderSummary> {
    const raw = await this.orders.adminSummary(windowOf(query));
    const stages = new Map<OrderStage, { count: number; value: number }>();
    for (const s of raw.by_status) {
      const stage = stageOf(s.status);
      const acc = stages.get(stage) ?? { count: 0, value: 0 };
      acc.count += s.count;
      acc.value += s.value;
      stages.set(stage, acc);
    }
    const by_stage = ORDER_STAGES.map((stage) => ({
      stage,
      count: stages.get(stage)?.count ?? 0,
      value: Math.round(stages.get(stage)?.value ?? 0),
    }));
    return {
      orders: by_stage.reduce((n, s) => n + s.count, 0),
      value: by_stage
        .filter((s) => s.stage !== 'cancelled' && s.stage !== 'returned')
        .reduce((n, s) => n + s.value, 0),
      partners: raw.partners,
      customers: raw.customers,
      by_stage,
    };
  }

  /**
   * The sales panels (per day, partner, state, city, pack, category, repeat
   * buyers) for the same filters and window as the cards. Cancelled and
   * returned orders are not sales, so they are left out.
   */
  async breakdown(query: AdminOrdersQueryDto): Promise<AdminOrderBreakdown> {
    const filter = windowOf(query);
    const raw = await this.orders.adminBreakdown(filter, [
      ...statusesFor('cancelled'),
      ...statusesFor('returned'),
    ]);
    const skus = raw.by_sku.filter(
      (s): s is typeof s & { _id: string } => !!s._id,
    );
    const top = [...skus]
      .sort((a, b) => b.value - a.value)
      .slice(0, TOP_PRODUCTS);
    const [names, products, catalogue] = await Promise.all([
      this.agents.partnersByAgentIds(
        raw.by_partner.flatMap((p) => (p._id ? [p._id] : [])),
      ),
      this.partnerOrders.productsFor(top.map((t) => t._id)),
      this.catalogue.facts(),
    ]);
    const byCategory = new Map<string, number>();
    for (const s of skus) {
      const name = catalogue.get(s._id)?.category ?? 'Other';
      byCategory.set(name, (byCategory.get(name) ?? 0) + s.value);
    }
    const categoryTotal = [...byCategory.values()].reduce((a, b) => a + b, 0);
    const round = (n: number) => Math.round(n);
    return {
      from: istDate(filter.from ?? new Date()),
      to: istDate(
        new Date((filter.to ?? new Date(Date.now() + 1)).getTime() - 1),
      ),
      by_day: raw.by_day.map((d) => ({
        day: d._id ?? '',
        orders: d.orders,
        value: round(d.value),
      })),
      by_partner: raw.by_partner.map((p) => ({
        agent_id: p._id ?? '',
        name: (p._id && names.get(p._id)?.name) || null,
        orders: p.orders,
        value: round(p.value),
      })),
      by_state: raw.by_state.map((p) => ({
        state: p._id ?? '',
        orders: p.orders,
        value: round(p.value),
      })),
      by_city: raw.by_city.map((p) => ({
        city: p._id ?? '',
        orders: p.orders,
        value: round(p.value),
      })),
      by_product: top.map((t) => ({
        sku: t._id,
        name: products.get(t._id)?.name ?? t._id,
        image: firstUrl(products.get(t._id)?.hero_image),
        qty: t.qty,
        value: round(t.value),
      })),
      by_category: [...byCategory]
        .map(([name, value]) => ({
          name,
          value: round(value),
          pct: categoryTotal ? Math.round((value * 100) / categoryTotal) : 0,
        }))
        .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name)),
      repeat_buyers: raw.repeat[0]?.n ?? 0,
    };
  }

  /** One order, with its commission (a list leaves it `null`: one book per partner on the page is too many reads). */
  async get(id: string): Promise<AdminOrderView> {
    const order = await this.orders.adminFindOne(id);
    if (!order) throw notFound('This order could not be found.');
    const commission = await this.partnerOrders.commissionOf(
      order.agent ?? '',
      !!order.agent,
    );
    const [view] = await this.views([order], commission);
    return view;
  }

  /** One product lookup and one partner lookup for the whole page. */
  private async views(
    rows: OrderRecord[],
    commission: Map<string, OrderCommission> = new Map(),
  ): Promise<AdminOrderView[]> {
    const ids = [
      ...new Set(rows.map((o) => o.agent).filter((a): a is string => !!a)),
    ];
    const [products, partners] = await Promise.all([
      this.partnerOrders.productsFor(
        rows.flatMap((o) => (o.items ?? []).map((i) => i.sku)),
      ),
      ids.length
        ? this.agents.list(
            { agent_ids: ids },
            { skip: 0, limit: ids.length, sort: { agent_id: 1 } },
          )
        : Promise.resolve({ items: [] as AgentRecord[], total: 0 }),
    ]);
    const byId = new Map(partners.items.map((a) => [a.agent_id ?? '', a]));

    return rows.map((o) => {
      const agent = o.agent ? byId.get(o.agent) : undefined;
      // The partner's own pii decides "Self (shop stock)", as in the app.
      const view = orderView(
        o,
        { agent_id: o.agent ?? '', pii_id: agent?.pii_id ?? '' },
        products,
        commission.get(o.order_id) ?? null,
      );
      return {
        ...view,
        partner: o.agent ? partnerOf(o.agent, agent) : null,
        ship_to: {
          city: o.shipping_address?.city ?? null,
          state: o.shipping_address?.state ?? null,
          pincode: o.shipping_address?.pincode ?? null,
        },
      };
    });
  }
}

/** The partner as every HO list names them; also used by HO carts and saved carts. */
export function partnerOf(
  agentId: string,
  a: AgentRecord | undefined,
): OrderPartner {
  return {
    agent_id: agentId,
    name: a?.profile?.name ?? a?.preview?.name ?? null,
    phone: a?.phone ?? null,
    cohort: a?.cohort ?? null,
    district: a?.profile?.district ?? a?.preview?.district ?? null,
    state: a?.profile?.state ?? a?.preview?.state ?? null,
  };
}

/** An order id, or the end of a phone number. */
const ORDER_ID = /^[A-Z0-9][A-Z0-9_/-]{1,39}$/;

/** The longest range the order cards sum over. */
const MAX_SUMMARY_DAYS = 366;

function filterOf(query: AdminOrdersQueryDto): AdminOrderFilter {
  const { from, to } = checkedRange(query.from, query.to);
  const q = query.q?.toUpperCase() ?? '';
  const digits = q.replace(/\D/g, '');
  const isPhone = /^[\d\s+-]+$/.test(q) && digits.length >= 4;
  // A search that is neither must not quietly become "every order".
  if (q && !isPhone && !ORDER_ID.test(q)) {
    throw badRequest(
      'VALIDATION_FAILED',
      'Search by an order number (e.g. KSK-341382) or at least 4 digits of the phone.',
    );
  }
  return {
    statuses: query.status ? statusesFor(query.status) : null,
    agentId: query.agent_id ?? null,
    from,
    to,
    piiId: query.customer ?? null,
    paymentMode: query.payment_mode ?? null,
    state: query.state || null,
    orderId: !isPhone && ORDER_ID.test(q) ? q : null,
    phoneEnd: isPhone ? digits.slice(-10) : null,
  };
}

/** Packs on the best-selling panel. */
const TOP_PRODUCTS = 10;

/**
 * The cards' and panels' filter: this IST month when no dates are given, at
 * most a year — their sums read every matching order, so the range bounds
 * the work.
 */
function windowOf(query: AdminOrdersQueryDto): AdminOrderFilter {
  const filter = filterOf(query);
  if (!filter.from && !filter.to) {
    filter.from = istMonthStart(istMonthKey(new Date()));
  }
  const span =
    (filter.to ?? new Date()).getTime() -
    (filter.from ?? new Date(0)).getTime();
  if (!filter.from || span > MAX_SUMMARY_DAYS * DAY_MS) {
    throw badRequest(
      'VALIDATION_FAILED',
      `Please choose a range of ${MAX_SUMMARY_DAYS} days or less.`,
    );
  }
  return filter;
}
