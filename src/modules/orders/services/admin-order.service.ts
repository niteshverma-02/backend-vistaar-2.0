import { Injectable } from '@nestjs/common';

import { notFound } from '@common/errors/api-error';
import { PageResult } from '@common/http/page-result';
import {
  AgentsService,
  type AgentRecord,
} from '@modules/agents/services/agents.service';
import type { OrderCommission } from '@modules/commission/services/commission.service';

import type {
  AdminOrderView,
  AdminOrdersQueryDto,
  OrderPartner,
} from '../dto/admin-order.dto';
import { statusesFor } from '../orders.domain';
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
  ) {}

  async list(query: AdminOrdersQueryDto): Promise<PageResult<AdminOrderView>> {
    const { from, to } = checkedRange(query.from, query.to);

    const [rows, total] = await this.orders.adminList(
      {
        statuses: query.status ? statusesFor(query.status) : null,
        agentId: query.agent_id ?? null,
        from,
        to,
      },
      query.skip,
      query.limit,
    );
    const views = await this.views(rows);
    return new PageResult(views, total, query);
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
