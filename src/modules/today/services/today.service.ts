import { Injectable, Logger } from '@nestjs/common';

import type { PartnerRef } from '@common/auth/current-partner.decorator';
import { DraftOrdersQueryDto } from '@modules/draft-order/dto/draft-order-request.dto';
import { DraftOrderService } from '@modules/draft-order/services/draft-order.service';
import { EventsService } from '@modules/events/services/events.service';
import { FarmerLeadQueryDto } from '@modules/leads/dto/lead.dto';
import { LeadsService } from '@modules/leads/services/leads.service';
import { OrdersQueryDto } from '@modules/orders/dto/order-request.dto';
import { OrderService } from '@modules/orders/services/order.service';

import { todayOf, type TodaySources, type TodayView } from '../today.domain';

/** Enough for any one partner's day; the lists cap at it anyway. */
const MAX = 200;

/**
 * Home's "Today's tasks": the partner's due follow-ups, saved carts to remind,
 * events they hold a seat at today or tomorrow, and orders waiting for the
 * warehouse — four reads in parallel, nothing stored. Doing a task happens on
 * its own record (log the call, mark the cart reminded…); it then drops off.
 */
@Injectable()
export class TodayService {
  private readonly logger = new Logger(TodayService.name);

  constructor(
    private readonly leads: LeadsService,
    private readonly drafts: DraftOrderService,
    private readonly events: EventsService,
    private readonly orders: OrderService,
  ) {}

  async get(partner: PartnerRef): Promise<TodayView> {
    const [leads, carts, events, orders] = await Promise.allSettled([
      this.leads.listMine(
        partner,
        Object.assign(new FarmerLeadQueryDto(), { due: true, limit: MAX }),
      ),
      this.drafts.list(
        partner.agent_id,
        Object.assign(new DraftOrdersQueryDto(), { limit: MAX }),
      ),
      this.events.upcoming(partner.agent_id),
      this.orders.list(
        partner,
        Object.assign(new OrdersQueryDto(), { status: 'placed', limit: MAX }),
      ),
    ]);
    // One source down must not blank Home: its tasks are left out and logged.
    const sources: TodaySources = {
      dueLeads: this.settled('leads', leads)?.items ?? [],
      carts: this.settled('saved carts', carts)?.items ?? [],
      events: this.settled('events', events) ?? [],
      orders: this.settled('orders', orders)?.items ?? [],
    };
    return todayOf(sources, new Date());
  }

  private settled<T>(name: string, result: PromiseSettledResult<T>): T | null {
    if (result.status === 'fulfilled') return result.value;
    this.logger.warn(
      `Today's tasks without ${name}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
    );
    return null;
  }
}
