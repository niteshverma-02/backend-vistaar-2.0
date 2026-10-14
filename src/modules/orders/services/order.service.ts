import { Injectable, Logger } from '@nestjs/common';

import type { PartnerRef } from '@common/auth/current-partner.decorator';
import { badRequest, notFound } from '@common/errors/api-error';
import { PageResult } from '@common/http/page-result';
import {
  addMonths,
  istDayRange,
  istMonthStart,
} from '@common/utils/ist-day.util';
import {
  CommissionService,
  type OrderCommission,
} from '@modules/commission/services/commission.service';

import type { OrdersQueryDto } from '../dto/order-request.dto';
import type { OrderView } from '../dto/order-view.dto';
import {
  BUSINESS_STATUSES,
  NOT_COUNTED,
  SELF_LABEL,
  addressLine,
  firstUrl,
  lastStatusAt,
  markTimes,
  personName,
  sizeLabel,
  stageOf,
  statusesFor,
  trackingSteps,
  type OrderStage,
} from '../orders.domain';
import { OrderRepository } from '../repositories/order.repository';
import {
  ProductLookupRepository,
  type OrderProduct,
} from '../repositories/product-lookup.repository';
import type { OrderRecord } from '../schemas/order.schema';

/** A customer's confirmed business with their partner (returns and cancellations left out). */
export interface CustomerBusiness {
  orders: number;
  spend: number;
  last_order_at: Date;
  last_order_stage: OrderStage;
}

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    private readonly orders: OrderRepository,
    private readonly products: ProductLookupRepository,
    private readonly commission: CommissionService,
  ) {}

  async list(
    partner: PartnerRef,
    query: OrdersQueryDto,
  ): Promise<PageResult<OrderView>> {
    const [rows, total] = await this.orders.list(
      partner.agent_id,
      query.status ? statusesFor(query.status) : null,
      query.skip,
      query.limit,
      query.customer ?? null,
      checkedRange(query.from, query.to),
    );
    // One lookup for the whole page, not one per order.
    const [products, commission] = await Promise.all([
      this.products.bySku(
        rows.flatMap((o) => (o.items ?? []).map((i) => i.sku)),
      ),
      this.commissionOf(partner.agent_id, rows.length > 0),
    ]);

    return new PageResult(
      rows.map((o) =>
        orderView(o, partner, products, commission.get(o.order_id) ?? null),
      ),
      total,
      query,
    );
  }

  /** Each of the partner's customers' business, by `pii_id` (only these, when given). */
  async businessByCustomer(
    agentId: string,
    piiIds?: readonly string[],
  ): Promise<Map<string, CustomerBusiness>> {
    if (piiIds && piiIds.length === 0) return new Map();
    const rows = await this.orders.customerStats(
      agentId,
      BUSINESS_STATUSES,
      piiIds,
    );
    return new Map(
      rows.map((r) => [
        r.pii_id,
        {
          orders: r.orders,
          spend: r.spend,
          last_order_at: r.last_order_at,
          last_order_stage: stageOf(r.last_status),
        },
      ]),
    );
  }

  /** Who the partner ordered for in IST month `YYYY-MM` (cancelled orders and non-orders left out). */
  async buyersIn(agentId: string, month: string): Promise<Set<string>> {
    const ids = await this.orders.buyersBetween(
      agentId,
      istMonthStart(month),
      istMonthStart(addMonths(month, 1)),
      [...NOT_COUNTED, ...statusesFor('cancelled')],
    );
    return new Set(ids);
  }

  async get(partner: PartnerRef, id: string): Promise<OrderView> {
    const order = await this.orders.findOne(partner.agent_id, id);
    if (!order) throw notFound('This order could not be found.');

    const [products, commission] = await Promise.all([
      this.products.bySku((order.items ?? []).map((i) => i.sku)),
      this.commissionOf(partner.agent_id, true),
    ]);
    return orderView(
      order,
      partner,
      products,
      commission.get(order.order_id) ?? null,
    );
  }

  /**
   * The partner's commission per order (`CommissionService`, a minute's
   * cache). An order screen still opens if it cannot be worked out.
   */
  async commissionOf(
    agentId: string,
    wanted: boolean,
  ): Promise<Map<string, OrderCommission>> {
    if (!wanted) return new Map();
    try {
      return await this.commission.forOrders(agentId);
    } catch (error) {
      this.logger.warn(
        `Commission not shown for ${agentId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return new Map();
    }
  }
}

/** `from` / `to` IST days as instants; 400 when the start is after the end. */
export function checkedRange(
  from?: string,
  to?: string,
): { from: Date | null; to: Date | null } {
  const range = istDayRange(from, to);
  if (range.from && range.to && range.from >= range.to)
    throw badRequest(
      'VALIDATION_FAILED',
      'The start date must be on or before the end date.',
    );
  return range;
}

/** One `orders_v2` row as the app shows it; HO's view adds the partner on top. */
export function orderView(
  order: OrderRecord,
  partner: PartnerRef,
  products: Map<string, OrderProduct>,
  commission: OrderCommission | null = null,
): OrderView {
  const isSelf = !order.pii_id || order.pii_id === partner.pii_id;
  const items = (order.items ?? []).map((item) => {
    const product = products.get(item.sku);
    return {
      sku: item.sku,
      product_name: product?.name ?? item.sku,
      product_image: firstUrl(product?.hero_image ?? product?.images?.[0]),
      size_label: sizeLabel(product?.variant, product?.item_qty),
      quantity: item.qty ?? 0,
      unit_price: item.unit_price ?? 0,
      line_total: item.total_price ?? 0,
      is_free: item.is_free ?? false,
    };
  });
  const lineSum = items.reduce((sum, l) => sum + l.line_total, 0);
  const status = order.order_status ?? '';
  const placedAt = order.date ?? order.created_at ?? null;

  return {
    id: order.order_id,
    status: stageOf(status),
    order_status: status,
    customer_id: isSelf ? null : (order.pii_id ?? null),
    customer_name: isSelf
      ? SELF_LABEL
      : personName(order.customer?.first_name, order.customer?.last_name),
    customer_phone: order.customer?.phone ?? null,
    items,
    item_count: items.reduce((sum, l) => sum + l.quantity, 0),
    // Some older rows carry 0 in both; the amount charged is then all there is.
    subtotal:
      order.original_total_amount || lineSum || (order.total_amount ?? 0),
    discount: (order.discounts ?? []).reduce(
      (sum, d) => sum + (d.discount_amount ?? 0),
      0,
    ),
    coins_used: order.coin ?? 0,
    delivery_charge: order.extra_charges?.delivery_charge ?? 0,
    total: order.total_amount ?? 0,
    payment_mode: order.payment_mode ?? '',
    cod_amount: order.cod_amount ?? 0,
    prepaid_amount: order.prepaid_amount ?? 0,
    delivery_address: addressLine(order.shipping_address),
    awb: order.booking_details?.awb_number || null,
    courier: order.booking_details?.booking_courier || null,
    tracking_steps: trackingSteps(status, order.order_status_map, placedAt),
    created_at: placedAt ?? new Date(0),
    delivered_at: markTimes(
      order.order_status_map ?? [],
      status,
      lastStatusAt(order.order_status_map) ?? placedAt,
    ).delivered_at,
    commission,
  };
}
