import { HttpException } from '@nestjs/common';
import { Types } from 'mongoose';

import type {
  CommissionService,
  OrderCommission,
} from '@modules/commission/services/commission.service';
import type { ProductFactsService } from '@modules/spine/services/product-facts.service';

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
  let forOrders: jest.Mock;
  let facts: Map<string, unknown>;
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
    forOrders = jest.fn().mockResolvedValue(new Map());
    // Not in the catalogue in memory: read from Mongo, as a pack added within the hour.
    facts = new Map();
    service = new OrderService(
      { list, findOne } as unknown as OrderRepository,
      { bySku } as unknown as ProductLookupRepository,
      { forOrders } as unknown as CommissionService,
      { facts: () => Promise.resolve(facts) } as unknown as ProductFactsService,
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

  it('passes the search box to the caller’s own list', async () => {
    list.mockResolvedValue([[], 0]);
    await service.list(
      PARTNER,
      Object.assign(new OrdersQueryDto(), { q: 'Mohan' }),
    );
    const call = list.mock.calls[0] as unknown[];
    expect(call[0]).toBe('VST-1');
    expect(call[6]).toEqual({ orderId: null, phoneEnd: null, name: 'Mohan' });
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

  it('filters by IST placing days, the end day included', async () => {
    list.mockResolvedValue([[], 0]);
    await service.list(
      PARTNER,
      Object.assign(new OrdersQueryDto(), {
        from: '2026-09-01',
        to: '2026-09-30',
      }),
    );
    const call = list.mock.calls[0] as unknown[];
    expect(call[5]).toEqual({
      from: new Date('2026-08-31T18:30:00Z'),
      to: new Date('2026-09-30T18:30:00Z'),
    });
    await expect(
      service.list(
        PARTNER,
        Object.assign(new OrdersQueryDto(), {
          from: '2026-09-30',
          to: '2026-09-01',
        }),
      ),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('shows each order’s commission and when it was delivered', async () => {
    const earned: OrderCommission = {
      base: 170,
      rate: 5,
      amount: 9,
      status: 'pending',
      confirms_at: new Date('2026-10-20T08:00:00Z'),
      confirmed_at: null,
      paid_at: null,
      withdrawal_id: null,
      reversed_reason: null,
    };
    forOrders.mockResolvedValue(new Map([['KSK-1', earned]]));
    findOne.mockResolvedValue(
      order({
        order_status: 'delivered',
        order_status_map: [
          {
            stage_name: 'created',
            timestamp: new Date('2026-10-12T08:00:00Z'),
          },
          {
            stage_name: 'delivered',
            timestamp: new Date('2026-10-13T08:00:00Z'),
          },
        ],
      }),
    );
    const view = await service.get(PARTNER, 'KSK-1');
    expect(view.commission).toEqual(earned);
    expect(view.delivered_at).toEqual(new Date('2026-10-13T08:00:00Z'));
    expect(forOrders).toHaveBeenCalledWith('VST-1');
  });

  it('still shows the order when commission cannot be worked out', async () => {
    forOrders.mockRejectedValue(new Error('down'));
    findOne.mockResolvedValue(order());
    const view = await service.get(PARTNER, 'KSK-1');
    expect(view.commission).toBeNull();
    expect(view.delivered_at).toBeNull();
  });

  it('names order lines from the catalogue in memory, reading Mongo only for a pack it lacks', async () => {
    facts.set('K-1', {
      name: 'Humic (memory)',
      image: 'https://x/m.png',
      variant: { value: '1', uom: 'KG' },
      item_qty: null,
      gst_rate: 5,
      category: null,
    });
    findOne.mockResolvedValue(
      order({
        items: [
          { sku: 'K-1', qty: 1, unit_price: 100, total_price: 100 },
          { sku: 'K-NEW', qty: 1, unit_price: 50, total_price: 50 },
        ],
      }),
    );
    const view = await service.get(PARTNER, 'KSK-1');
    expect(view.items[0]).toMatchObject({
      product_name: 'Humic (memory)',
      product_image: 'https://x/m.png',
      size_label: '1 KG',
    });
    expect(bySku).toHaveBeenCalledWith(['K-NEW']);
  });
});
