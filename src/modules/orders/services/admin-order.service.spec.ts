import { HttpException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { Types } from 'mongoose';

import type { AgentsService } from '@modules/agents/services/agents.service';

import { AdminOrdersQueryDto } from '../dto/admin-order.dto';
import type { OrderRepository } from '../repositories/order.repository';
import type { OrderRecord } from '../schemas/order.schema';
import { AdminOrderService } from './admin-order.service';
import type { OrderService } from './order.service';

function order(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    _id: new Types.ObjectId(),
    order_id: 'KSK-1',
    date: new Date('2026-10-12T08:00:00Z'),
    pii_id: 'PII-1',
    customer: { first_name: 'Mohan', last_name: 'Rao', phone: '8247554977' },
    shipping_address: {
      city: 'Raisen',
      state: 'MADHYA PRADESH',
      pincode: '464551',
    },
    items: [{ sku: 'K-1', qty: 2, unit_price: 100, total_price: 200 }],
    total_amount: 200,
    payment_mode: 'cod',
    order_status: 'created',
    order_status_map: [],
    source: 'vistaar',
    agent: 'VST-1',
    ...overrides,
  };
}

const query = (q: Record<string, unknown> = {}) =>
  plainToInstance(AdminOrdersQueryDto, q);

describe('AdminOrderService', () => {
  let adminList: jest.Mock;
  let adminFindOne: jest.Mock;
  let agentsList: jest.Mock;
  let adminSummary: jest.Mock;
  let service: AdminOrderService;

  beforeEach(() => {
    adminList = jest.fn().mockResolvedValue([[order()], 1]);
    adminFindOne = jest.fn();
    agentsList = jest.fn().mockResolvedValue({
      items: [
        {
          agent_id: 'VST-1',
          pii_id: 'PII-1',
          phone: '9826000000',
          cohort: 'retailer',
          preview: {
            name: 'Ramesh Patel',
            district: 'Raisen',
            state: 'Madhya Pradesh',
          },
        },
      ],
      total: 1,
    });
    adminSummary = jest.fn().mockResolvedValue({
      by_status: [
        { status: 'delivered', count: 2, value: 1000 },
        { status: 'in_transit', count: 1, value: 300 },
        { status: 'rto_delivered', count: 1, value: 500 },
      ],
      partners: 2,
      customers: 3,
    });
    service = new AdminOrderService(
      { adminList, adminFindOne, adminSummary } as unknown as OrderRepository,
      { list: agentsList } as unknown as AgentsService,
      {
        commissionOf: jest.fn().mockResolvedValue(new Map()),
        productsFor: jest.fn().mockResolvedValue(new Map()),
      } as unknown as OrderService,
    );
  });

  it('turns IST days into UTC bounds, the end day included', async () => {
    await service.list(
      query({
        from: '2026-10-01',
        to: '2026-10-13',
        status: 'shipped',
        agent_id: 'vst-1',
      }),
    );
    const [filter] = adminList.mock.calls[0] as [Record<string, unknown>];
    expect(filter.from).toEqual(new Date('2026-09-30T18:30:00Z'));
    expect(filter.to).toEqual(new Date('2026-10-13T18:30:00Z'));
    expect(filter.agentId).toBe('VST-1');
    // an app stage becomes Stockship's raw spellings of it
    expect(filter.statuses).toEqual(
      expect.arrayContaining(['in_transit', 'in transit']),
    );
  });

  it('refuses a range that ends before it starts', async () => {
    await expect(
      service.list(query({ from: '2026-10-13', to: '2026-10-01' })),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('names the partner once per page and keeps the app view', async () => {
    const page = await service.list(query());
    expect(agentsList).toHaveBeenCalledTimes(1);
    expect(page.items[0].partner).toMatchObject({
      agent_id: 'VST-1',
      name: 'Ramesh Patel',
      state: 'Madhya Pradesh',
    });
    expect(page.items[0].ship_to).toEqual({
      city: 'Raisen',
      state: 'MADHYA PRADESH',
      pincode: '464551',
    });
    // the order was billed to the partner's own pii: shop stock, as the app shows it
    expect(page.items[0].customer_name).toBe('Self (shop stock)');
    expect(page.items[0].total).toBe(200);
  });

  it('answers 404 for an order that is not Vistaar’s', async () => {
    adminFindOne.mockResolvedValue(null);
    await expect(service.get('KSK-9')).rejects.toBeInstanceOf(HttpException);
  });

  it('narrows to one buyer, a payment mode, a state, an order id or a phone end', async () => {
    await service.list(
      query({
        customer: 'pii-7',
        payment_mode: 'cod',
        state: 'Madhya Pradesh',
      }),
    );
    expect((adminList.mock.calls[0] as [unknown])[0]).toMatchObject({
      piiId: 'PII-7',
      paymentMode: 'cod',
      state: 'Madhya Pradesh',
      orderId: null,
      phoneEnd: null,
    });

    await service.list(query({ q: 'ksk-341382' }));
    expect((adminList.mock.calls[1] as [unknown])[0]).toMatchObject({
      orderId: 'KSK-341382',
      phoneEnd: null,
    });

    await service.list(query({ q: '+91 98260 00000' }));
    expect((adminList.mock.calls[2] as [unknown])[0]).toMatchObject({
      orderId: null,
      phoneEnd: '9826000000',
    });
  });

  it('sums the cards per app stage; returns are not order value', async () => {
    const summary = await service.summary(query({ agent_id: 'VST-1' }));
    expect(summary).toMatchObject({
      orders: 4,
      value: 1300,
      partners: 2,
      customers: 3,
    });
    expect(summary.by_stage.find((s) => s.stage === 'returned')).toEqual({
      stage: 'returned',
      count: 1,
      value: 500,
    });
    expect((adminSummary.mock.calls[0] as [unknown])[0]).toMatchObject({
      agentId: 'VST-1',
    });
  });

  it('refuses a search that is neither an order id nor a phone, instead of listing everything', async () => {
    await expect(service.list(query({ q: 'Ram Kumar' }))).rejects.toMatchObject(
      {
        status: 400,
      },
    );
    expect(adminList).not.toHaveBeenCalled();
  });

  it('sums this month by default and at most a year', async () => {
    await service.summary(query({}));
    const filter = (adminSummary.mock.calls[0] as [{ from: Date | null }])[0];
    expect(filter.from).toBeInstanceOf(Date);
    expect(filter.from!.getTime()).toBeLessThanOrEqual(Date.now());
    await expect(
      service.summary(query({ from: '2024-01-01', to: '2026-01-01' })),
    ).rejects.toMatchObject({ status: 400 });
  });
});
