import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';

import { serviceUnavailable } from '@common/errors/api-error';
import { AgentsService } from '@modules/agents/services/agents.service';
import { PiiService } from '@modules/spine/services/pii.service';

import type { OrderIdView } from '../dto/order-id.dto';
import {
  ORDER_ID_COUNTER,
  ORDER_ID_PREFIX,
  vistaarOrderId,
} from '../orders.domain';
import { OrderIdRepository } from '../repositories/order-id.repository';
import { OrderRepository } from '../repositories/order.repository';
import type { OrderIdRecord } from '../schemas/order-id.schema';

/**
 * How many taken numbers one call may step over. The old Vistaar's `KSV-`
 * orders sit in runs (24 in a row on beta); a longer run only means the next
 * call carries on from where this one stopped. Every skip is one `$inc`.
 */
export const MAX_TAKEN_SKIPS = 100;

const view = (row: OrderIdRecord): OrderIdView => ({
  order_id: row.order_id,
  request_id: row.request_id,
  issued_at: row.created_at,
});

/**
 * Hands out Vistaar's order numbers (`KSV-n`). One number per checkout
 * attempt: the same `request_id` always gets the same number back, so a retry
 * never spends a second one. Checkout (COD at place-order, prepaid at the
 * payment webhook) calls `issue` with its own attempt id.
 */
@Injectable()
export class OrderIdService implements OnApplicationBootstrap {
  private readonly logger = new Logger(OrderIdService.name);
  /**
   * The `KSV-` numbers the old Vistaar already used. Read once, so no order
   * waits on a lookup in `orders_v2` — a full scan until Stockship indexes
   * `order_id`. Nothing else issues `KSV-` numbers (PROD-CHECKLIST), so the
   * set holds for the life of the process.
   */
  private legacyTaken: Promise<ReadonlySet<number>> | null = null;

  constructor(
    private readonly ids: OrderIdRepository,
    private readonly orders: OrderRepository,
    private readonly piis: PiiService,
    private readonly agents: AgentsService,
  ) {}

  /** Read before the first order, so no partner waits on the scan. */
  onApplicationBootstrap(): void {
    this.taken().catch(() => undefined);
  }

  /**
   * The app's route: only an approved, active partner places orders. The
   * payment webhook calls `issue` itself — money already taken still gets
   * its order, whatever happened to the account since.
   */
  async issueForPartner(
    agentId: string,
    requestId: string,
  ): Promise<OrderIdView> {
    await this.agents.requireWorkingPartner(agentId, 'place orders');
    return this.issue(agentId, requestId);
  }

  async issue(agentId: string, requestId: string): Promise<OrderIdView> {
    const held = await this.ids.findByRequest(agentId, requestId);
    if (held) return view(held);

    const taken = await this.taken().catch(() => {
      throw unavailable();
    });

    for (let skipped = 0; skipped <= MAX_TAKEN_SKIPS; skipped++) {
      const n = await this.piis.tryNextOrgNumber(ORDER_ID_COUNTER);
      if (n === null) {
        this.logger.error(`app_counters has no "${ORDER_ID_COUNTER}" row`);
        throw unavailable();
      }
      const orderId = vistaarOrderId(n);

      if (taken.has(n)) {
        this.logger.warn(`${orderId} is already an order; skipped.`);
        continue;
      }

      const row = await this.ids.insert(orderId, agentId, requestId);
      if (row) return view(row);

      // A concurrent copy of this request got its number first; this one is
      // left unused (a gap, as any failed checkout leaves).
      const winner = await this.ids.findByRequest(agentId, requestId);
      if (winner) return view(winner);
      throw new Error(`${agentId}:${requestId} held, then not found`);
    }

    this.logger.error(
      `No free ${ORDER_ID_COUNTER} number after ${MAX_TAKEN_SKIPS} skips.`,
    );
    throw unavailable();
  }

  /** Read once; a failed read is tried again by the next call. */
  private taken(): Promise<ReadonlySet<number>> {
    this.legacyTaken ??= this.orders
      .takenNumbers(ORDER_ID_PREFIX)
      .then((numbers) => {
        this.logger.log(
          `${numbers.length} old ${ORDER_ID_PREFIX} orders will be skipped.`,
        );
        return new Set(numbers);
      })
      .catch((err: unknown) => {
        this.legacyTaken = null;
        this.logger.error(
          `Could not read the old ${ORDER_ID_PREFIX} orders: ${String(err)}`,
        );
        throw err;
      });
    return this.legacyTaken;
  }
}

const unavailable = () =>
  serviceUnavailable(
    'ORDER_ID_UNAVAILABLE',
    'Orders cannot be placed right now. Please try again later.',
  );
