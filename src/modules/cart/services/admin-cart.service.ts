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

/** Every partner fits: Vistaar has hundreds, not thousands. */
const MAX_PARTNERS = 5_000;

/**
 * Head office's read of the carts partners are filling and have not ordered
 * — the "who is about to buy" list. The cart row names no partner (its `_id`
 * is derived from theirs), so the list starts from the partners.
 */
@Injectable()
export class AdminCartService {
  constructor(
    private readonly carts: CartRepository,
    private readonly agents: AgentsService,
    private readonly leads: LeadsService,
  ) {}

  async list(query: AdminCartsQueryDto): Promise<PageResult<AdminCartView>> {
    const { items: partners } = await this.agents.list(
      query.agent_id ? { agent_ids: [query.agent_id] } : {},
      { skip: 0, limit: MAX_PARTNERS, sort: { agent_id: 1 } },
    );
    const byCart = new Map<string, AgentRecord>();
    for (const a of partners) {
      if (a.agent_id) byCart.set(activeCartId(a.agent_id).toHexString(), a);
    }
    if (byCart.size === 0) return new PageResult([], 0, query);

    const [rows, total] = await this.carts.adminList(
      [...byCart.values()].map((a) => activeCartId(a.agent_id ?? '')),
      query.skip,
      query.limit,
    );
    const farmers = await this.leads.farmersByPii(
      rows.map((r) => r.pii_id).filter(Boolean),
    );
    const views = rows.flatMap((cart) => {
      const agent = byCart.get(cart._id.toHexString());
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
