import { Injectable } from '@nestjs/common';

import { PageResult } from '@common/http/page-result';
import { AgentsService } from '@modules/agents/services/agents.service';
import type { AdminCartsQueryDto } from '@modules/cart/dto/admin-cart.dto';
import { partnerOf } from '@modules/orders/services/admin-order.service';

import type { AdminDraftOrderView } from '../dto/draft-order-view.dto';
import {
  CustomerLookupRepository,
  draftKey,
} from '../repositories/customer-lookup.repository';
import { DraftOrderRepository } from '../repositories/draft-order.repository';
import { draftView } from './draft-order.service';

/**
 * Head office's read of the carts partners saved for later — the open drafts
 * still waiting for an order, and whether the partner sent the WhatsApp
 * reminder. Same mapping as the app's `/draft-orders` (one `draftView`).
 */
@Injectable()
export class AdminDraftOrderService {
  constructor(
    private readonly drafts: DraftOrderRepository,
    private readonly customers: CustomerLookupRepository,
    private readonly agents: AgentsService,
  ) {}

  async list(
    query: AdminCartsQueryDto,
  ): Promise<PageResult<AdminDraftOrderView>> {
    const [rows, total] = await this.drafts.adminList(
      query.agent_id ?? null,
      query.skip,
      query.limit,
    );
    const ids = [...new Set(rows.map((d) => d.agent_id))];
    const [piis, partners] = await Promise.all([
      this.customers.piiIdsFor(
        rows.map((d) => ({
          contact_id: d.contact_id ?? null,
          contact_number: d.contact_number ?? null,
        })),
      ),
      ids.length
        ? this.agents.list(
            { agent_ids: ids },
            { skip: 0, limit: ids.length, sort: { agent_id: 1 } },
          )
        : Promise.resolve({ items: [], total: 0 }),
    ]);
    const byId = new Map(partners.items.map((a) => [a.agent_id ?? '', a]));
    const views = rows.map((d) => ({
      ...draftView(
        d,
        piis.get(
          draftKey({
            contact_id: d.contact_id ?? null,
            contact_number: d.contact_number ?? null,
          }),
        ) ?? null,
      ),
      partner: partnerOf(d.agent_id, byId.get(d.agent_id)),
    }));
    return new PageResult(views, total, query);
  }
}
