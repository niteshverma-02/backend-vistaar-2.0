import { HttpException } from '@nestjs/common';
import { Types } from 'mongoose';

import { OrdersQueryDto } from '../dto/order-request.dto';
import type { OrderRepository } from '../repositories/order.repository';
import type { ProductLookupRepository } from '../repositories/product-lookup.repository';
import type { OrderRecord } from '../schemas/order.schema';
import { OrderService } from './order.service';

const PARTNER = { agent_id: 'VST-1', pii_id: 'PII-9' };

function order(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    _id: new Types.ObjectId(),
    order_id: 'KSK-1',
    date: new Date('2026-10-12T08:00:00Z'),
    pii_id: 'PII-1',
    customer: { first_name: 'Mohan', last_name: 'Rao', phone: '8247554977' },
    items: [{ sku: 'K-1', qty: 2, unit_price: 100, total_price: 200 }],
    total_amount: 180,
    original_total_amount: 200,
    discounts: [{ discount_amount: 20 }],
    payment_mode: 'cod',
    order_status: 'created',
    order_status_map: [],
    source: 'vistaar',
    agent: 'VST-1',
    ...overrides,
  };
}

describe('OrderService', () => {
  let list: jest.Mock;
  let findOne: jest.Mock;
  let bySku: jest.Mock;
  let service: OrderService;

  beforeEach(() => {
    list = jest.fn();
    findOne = jest.fn();
    bySku = jest.fn().mockResolvedValue(
      new Map([
        [
          'K-1',
          {
            name: 'Humic',
            hero_image: 'https://x/h.png',
            variant: { value: '1', uom: 'KG' },
          },
        ],
      ]),
    );
    service = new OrderService(
      { list, findOne } as unknown as OrderRepository,
      { bySku } as unknown as ProductLookupRepository,
    );
  });

  it('lists only the caller’s orders and maps a stage filter to raw statuses', async () => {
    list.mockResolvedValue([[order()], 1]);
    const query = Object.assign(new OrdersQueryDto(), { status: 'shipped' });

    const page = await service.list(PARTNER, query);

    const [partnerId, statuses] = list.mock.calls[0] as [string, string[]];
    expect(partnerId).toBe('VST-1');
    expect(statuses).toEqual(
      expect.arrayContaining(['in_transit', 'dispatched']),
    );
    expect(page.items[0]).toMatchObject({
      id: 'KSK-1',
      status: 'placed',
      customer_id: 'PII-1',
      customer_name: 'Mohan Rao',
      subtotal: 200,
      discount: 20,
      total: 180,
    });
    expect(page.items[0].items[0]).toMatchObject({
      product_name: 'Humic',
      size_label: '1 KG',
      line_total: 200,
    });
  });

  it('passes no status filter when none is asked for', async () => {
    list.mockResolvedValue([[], 0]);
    await service.list(PARTNER, new OrdersQueryDto());
    const [, statuses] = list.mock.calls[0] as [string, string[] | null];
    expect(statuses).toBeNull();
  });

  it("narrows to one customer's orders (the Orders tab)", async () => {
    list.mockResolvedValue([[], 0]);
    await service.list(
      PARTNER,
      Object.assign(new OrdersQueryDto(), { customer: 'PII-7' }),
    );
    const call = list.mock.calls[0] as unknown[];
    expect(call[4]).toBe('PII-7');
  });

  it('shows a shop-stock order (the partner’s own pii) as self', async () => {
    findOne.mockResolvedValue(order({ pii_id: 'PII-9' }));
    const view = await service.get(PARTNER, 'KSK-1');
    expect(view.customer_id).toBeNull();
    expect(view.customer_name).toBe('Self (shop stock)');
  });

  it('falls back to the sku when the product is unknown', async () => {
    bySku.mockResolvedValue(new Map());
    findOne.mockResolvedValue(order());
    const view = await service.get(PARTNER, 'KSK-1');
    expect(view.items[0]).toMatchObject({
      product_name: 'K-1',
      product_image: null,
    });
  });

  it('falls back to the total when a row has no subtotal or line prices', async () => {
    findOne.mockResolvedValue(
      order({
        original_total_amount: 0,
        total_amount: 1726,
        items: [{ sku: 'K-1', qty: 2, unit_price: 0, total_price: 0 }],
      }),
    );
    const view = await service.get(PARTNER, 'K-916485');
    expect(view.subtotal).toBe(1726);
  });

  it('answers 404 for an order that is not the caller’s', async () => {
    findOne.mockResolvedValue(null);
    await expect(service.get(PARTNER, 'KSK-2')).rejects.toBeInstanceOf(
      HttpException,
    );
    expect(findOne).toHaveBeenCalledWith('VST-1', 'KSK-2');
  });
});
