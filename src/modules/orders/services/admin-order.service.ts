import { Injectable } from '@nestjs/common';

import { badRequest, notFound } from '@common/errors/api-error';
import { PageResult } from '@common/http/page-result';
import {
  AgentsService,
  type AgentRecord,
} from '@modules/agents/services/agents.service';

import type {
  AdminOrderView,
  AdminOrdersQueryDto,
  OrderPartner,
} from '../dto/admin-order.dto';
import { statusesFor } from '../orders.domain';
import { OrderRepository } from '../repositories/order.repository';
import { ProductLookupRepository } from '../repositories/product-lookup.repository';
import type { OrderRecord } from '../schemas/order.schema';
import { orderView } from './order.service';

/** IST is UTC+05:30; a `YYYY-MM-DD` filter means the IST calendar day. */
const IST_OFFSET = '+05:30';
const DAY_MS = 86_400_000;

/**
 * Head office's read of every partner's orders. Same mapping as the app's
 * `/orders` (one `orderView`), so HO and the partner see the same order.
 */
@Injectable()
export class AdminOrderService {
  constructor(
    private readonly orders: OrderRepository,
    private readonly products: ProductLookupRepository,
    private readonly agents: AgentsService,
  ) {}

  async list(query: AdminOrdersQueryDto): Promise<PageResult<AdminOrderView>> {
    const from = query.from
      ? new Date(`${query.from}T00:00:00${IST_OFFSET}`)
      : null;
    const to = query.to
      ? new Date(
          new Date(`${query.to}T00:00:00${IST_OFFSET}`).getTime() + DAY_MS,
        )
      : null;
    if (from && to && from >= to)
      throw badRequest(
        'VALIDATION_FAILED',
        'The start date must be on or before the end date.',
      );

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

  async get(id: string): Promise<AdminOrderView> {
    const order = await this.orders.adminFindOne(id);
    if (!order) throw notFound('This order could not be found.');
    const [view] = await this.views([order]);
    return view;
  }

  /** One product lookup and one partner lookup for the whole page. */
  private async views(rows: OrderRecord[]): Promise<AdminOrderView[]> {
    const ids = [
      ...new Set(rows.map((o) => o.agent).filter((a): a is string => !!a)),
    ];
    const [products, partners] = await Promise.all([
      this.products.bySku(
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

function partnerOf(agentId: string, a: AgentRecord | undefined): OrderPartner {
  return {
    agent_id: agentId,
    name: a?.profile?.name ?? a?.preview?.name ?? null,
    phone: a?.phone ?? null,
    cohort: a?.cohort ?? null,
    district: a?.profile?.district ?? a?.preview?.district ?? null,
    state: a?.profile?.state ?? a?.preview?.state ?? null,
  };
}
