import { Injectable } from '@nestjs/common';

import { PageResult } from '@common/http/page-result';
import {
  AgentsService,
  type AgentRecord,
} from '@modules/agents/services/agents.service';
import {
  LeadsService,
  type FarmerCard,
} from '@modules/leads/services/leads.service';
import { partnerOf } from '@modules/orders/services/admin-order.service';

import type {
  AdminCartLine,
  AdminCartsQueryDto,
  AdminCartView,
} from '../dto/admin-cart.dto';
import { activeCartId, CartRepository } from '../repositories/cart.repository';
import type { CartLine, CartRecord } from '../schemas/cart.schema';

/**
 * Head office's read of the carts partners are filling and have not ordered
 * — the "who is about to buy" list. The cart row names no partner (its `_id`
 * is derived from theirs), so the cart ids come from the partners' ids (ids
 * only, however many partners), and only the page's partners are read in full.
 */
@Injectable()
export class AdminCartService {
  constructor(
    private readonly carts: CartRepository,
    private readonly agents: AgentsService,
    private readonly leads: LeadsService,
  ) {}

  async list(query: AdminCartsQueryDto): Promise<PageResult<AdminCartView>> {
    const agentIds = query.agent_id
      ? [query.agent_id]
      : await this.agents.verifiedAgentIds();
    if (agentIds.length === 0) return new PageResult([], 0, query);
    const byCart = new Map(
      agentIds.map((id) => [activeCartId(id).toHexString(), id]),
    );

    const [rows, total] = await this.carts.adminList(
      agentIds.map((id) => activeCartId(id)),
      query.skip,
      query.limit,
    );
    const onPage = [
      ...new Set(rows.flatMap((r) => byCart.get(r._id.toHexString()) ?? [])),
    ];
    const [partners, farmers] = await Promise.all([
      onPage.length
        ? this.agents.list(
            { agent_ids: onPage },
            { skip: 0, limit: onPage.length, sort: { agent_id: 1 } },
          )
        : Promise.resolve({ items: [] as AgentRecord[], total: 0 }),
      this.leads.farmersByPii(rows.map((r) => r.pii_id).filter(Boolean)),
    ]);
    const agentOf = new Map(partners.items.map((a) => [a.agent_id ?? '', a]));
    const views = rows.flatMap((cart) => {
      const agent = agentOf.get(byCart.get(cart._id.toHexString()) ?? '');
      return agent?.agent_id ? [viewOf(cart, agent, farmers)] : [];
    });
    return new PageResult(views, total, query);
  }
}

function viewOf(
  cart: CartRecord,
  agent: AgentRecord,
  farmers: Map<string, FarmerCard>,
): AdminCartView {
  // The partner's own pii is shop stock, as the app shows it.
  const piiId =
    cart.pii_id && cart.pii_id !== agent.pii_id ? cart.pii_id : null;
  const items = cart.items.map(lineOf);
  return {
    partner: partnerOf(agent.agent_id ?? '', agent),
    pii_id: piiId,
    customer: piiId ? (farmers.get(piiId) ?? null) : null,
    items,
    item_count: items.reduce((n, l) => n + l.quantity, 0),
    subtotal: cart.subtotal ?? items.reduce((n, l) => n + l.line_total, 0),
    updated_at: cart.updated_at ?? null,
  };
}

function lineOf(l: CartLine): AdminCartLine {
  return {
    sku: l.sku,
    product_name: l.product_name,
    product_image: l.product_image ?? null,
    size_label: [l.packaging_size, l.uom].filter(Boolean).join(' '),
    price: l.price,
    quantity: l.quantity,
    line_total: l.total ?? l.price * l.quantity,
  };
}
