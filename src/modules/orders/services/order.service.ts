import { Injectable } from '@nestjs/common';

import type { PartnerRef } from '@common/auth/current-partner.decorator';
import { notFound } from '@common/errors/api-error';
import { PageResult } from '@common/http/page-result';

import type { OrdersQueryDto } from '../dto/order-request.dto';
import type { OrderView } from '../dto/order-view.dto';
import {
  addressLine,
  firstUrl,
  personName,
  sizeLabel,
  stageOf,
  statusesFor,
  trackingSteps,
} from '../orders.domain';
import { OrderRepository } from '../repositories/order.repository';
import {
  ProductLookupRepository,
  type OrderProduct,
} from '../repositories/product-lookup.repository';
import type { OrderRecord } from '../schemas/order.schema';

/** The app's `selfLabel`: whose name a shop-stock order shows. */
const SELF_LABEL = 'Self (shop stock)';

@Injectable()
export class OrderService {
  constructor(
    private readonly orders: OrderRepository,
    private readonly products: ProductLookupRepository,
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
    );
    // One lookup for the whole page, not one per order.
    const products = await this.products.bySku(
      rows.flatMap((o) => (o.items ?? []).map((i) => i.sku)),
    );

    return new PageResult(
      rows.map((o) => orderView(o, partner, products)),
      total,
      query,
    );
  }

  async get(partner: PartnerRef, id: string): Promise<OrderView> {
    const order = await this.orders.findOne(partner.agent_id, id);
    if (!order) throw notFound('This order could not be found.');

    const products = await this.products.bySku(
      (order.items ?? []).map((i) => i.sku),
    );
    return orderView(order, partner, products);
  }
}

/** One `orders_v2` row as the app shows it; HO's view adds the partner on top. */
export function orderView(
  order: OrderRecord,
  partner: PartnerRef,
  products: Map<string, OrderProduct>,
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
  };
}
