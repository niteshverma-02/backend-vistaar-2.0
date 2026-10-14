import type { HttpException } from '@nestjs/common';

import type {
  CustomerBusiness,
  OrderService,
} from '@modules/orders/services/order.service';
import type { SettingsService } from '@modules/settings/services/settings.service';

import { CustomerQueryDto, type OrderEventDto } from '../dto/customer.dto';
import type { VistaarLeadsRepository } from '../repositories/vistaar-leads.repository';
import { CustomersService } from './customers.service';

type Row = Record<string, unknown> & {
  pii_id: string;
  agent_id: string;
  stage: string;
};
type Update = {
  $set?: Record<string, unknown>;
  $push?: Record<string, { $each: unknown[] }>;
  $max?: Record<string, Date>;
  $min?: Record<string, Date>;
};

const ME = { agent_id: 'VST-000006', pii_id: 'PII-1' };
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

const lead = (pii: string, extra: Record<string, unknown> = {}): Row => ({
  _id: pii,
  pii_id: pii,
  agent_id: ME.agent_id,
  name: pii,
  phone: '6000000101',
  village: 'Rampur',
  crops: ['Wheat'],
  acreage: 5,
  origin: 'created',
  stage: 'negotiation',
  next_follow_up: daysAgo(-1),
  lost_reason: null,
  stage_history: [],
  activities: [],
  consent: { version: 1, at: daysAgo(10) },
  customer_at: null,
  last_order_at: null,
  created_at: daysAgo(10),
  updated_at: daysAgo(10),
  ...extra,
});

function setup(opts: {
  rows?: Row[];
  business?: Record<string, Partial<CustomerBusiness>>;
}) {
  const rows = new Map(opts.rows?.map((r) => [r.pii_id, { ...r }]) ?? []);
  const repo = {
    rows,
    findByPii: jest.fn((pii: string) =>
      Promise.resolve(rows.has(pii) ? { ...rows.get(pii)! } : null),
    ),
    update: jest.fn(
      (
        pii: string,
        agent: string,
        upd: Update,
        expect: Record<string, unknown> = {},
      ) => {
        const row = rows.get(pii);
        if (!row || row.agent_id !== agent) return Promise.resolve(null);
        for (const [k, v] of Object.entries(expect))
          if ((row[k] ?? null) !== v) return Promise.resolve(null);
        Object.assign(row, upd.$set ?? {});
        for (const [k, v] of Object.entries(upd.$push ?? {}))
          row[k] = [...((row[k] as unknown[]) ?? []), ...v.$each];
        for (const [k, v] of Object.entries(upd.$max ?? {}))
          if (!row[k] || (row[k] as Date) < v) row[k] = v;
        for (const [k, v] of Object.entries(upd.$min ?? {}))
          if (row[k] && (row[k] as Date) > v) row[k] = v;
        return Promise.resolve({ ...row });
      },
    ),
    all: jest.fn(() =>
      Promise.resolve([...rows.values()].filter((r) => r.stage === 'won')),
    ),
  };
  const business = new Map(
    Object.entries(opts.business ?? {}).map(([pii, b]) => [
      pii,
      {
        orders: 1,
        spend: 0,
        last_order_at: daysAgo(2),
        last_order_stage: 'shipped',
        ...b,
      },
    ]),
  );
  const orders = {
    businessByCustomer: jest.fn().mockResolvedValue(business),
    buyersIn: jest.fn().mockResolvedValue(new Set(['PII-C'])),
  };
  const settings = {
    get: jest.fn().mockResolvedValue({
      lead_release_days: 15,
      customer_release_days: 45,
    }),
  };
  const service = new CustomersService(
    repo as unknown as VistaarLeadsRepository,
    orders as unknown as OrderService,
    settings as unknown as SettingsService,
  );
  return { service, repo, orders };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return ((error as HttpException).getResponse() as { error: string }).error;
  }
  return 'no error';
}

const query = (q: Partial<CustomerQueryDto> = {}) =>
  Object.assign(new CustomerQueryDto(), q);

const ordered = (e: Partial<OrderEventDto> = {}): OrderEventDto => ({
  order_id: 'KSK-1',
  pii_id: 'PII-9',
  agent_id: ME.agent_id,
  order_date: daysAgo(2).toISOString(),
  ...e,
});

describe('CustomersService.recordOrder', () => {
  it('makes the lead won on the first confirmed order, once', async () => {
    const { service, repo } = setup({ rows: [lead('PII-9')] });
    expect(await service.recordOrder(ordered())).toEqual({
      result: 'won',
      pii_id: 'PII-9',
    });
    const row = repo.rows.get('PII-9')!;
    expect(row).toMatchObject({
      stage: 'won',
      next_follow_up: null,
      stage_history: [{ from: 'negotiation', to: 'won', by: 'system' }],
    });
    expect(row.customer_at).toEqual(row.last_order_at);
    expect((row.activities as { text: string }[])[0].text).toContain('KSK-1');

    // The same call again changes nothing but the last order.
    expect((await service.recordOrder(ordered())).result).toBe('updated');
    expect(row.stage_history).toHaveLength(1);
  });

  it('wins a lost lead too, and keeps the earliest order as "customer since"', async () => {
    const { service, repo } = setup({
      rows: [lead('PII-9', { stage: 'lost', lost_reason: 'Price' })],
    });
    await service.recordOrder(ordered());
    expect(repo.rows.get('PII-9')).toMatchObject({
      stage: 'won',
      lost_reason: null,
    });
    const first = repo.rows.get('PII-9')!.customer_at as Date;

    const earlier = daysAgo(30);
    await service.recordOrder(
      ordered({ order_id: 'KSK-0', order_date: earlier.toISOString() }),
    );
    expect(repo.rows.get('PII-9')).toMatchObject({
      customer_at: earlier,
      last_order_at: first,
    });
  });

  it.each([
    // Shop stock: the partner's own pii has no lead row.
    [ordered({ pii_id: ME.pii_id })],
    // A farmer another partner holds.
    [ordered({ agent_id: 'VST-000007' })],
  ])('ignores %j and writes nothing', async (event) => {
    const { service, repo } = setup({ rows: [lead('PII-9')] });
    expect(await service.recordOrder(event)).toEqual({
      result: 'ignored',
      reason: 'not_held',
    });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('reads the lead again when the partner moved it meanwhile', async () => {
    const { service, repo } = setup({ rows: [lead('PII-9')] });
    repo.update.mockResolvedValueOnce(null);
    expect((await service.recordOrder(ordered())).result).toBe('won');
    expect(repo.findByPii).toHaveBeenCalledTimes(2);
  });
});

describe('CustomersService — the Customers screen', () => {
  const customers = [
    lead('PII-A', { stage: 'won', name: 'Asha', crops: ['Wheat'] }),
    lead('PII-B', { stage: 'won', name: 'Bhola', crops: ['Soybean', 'wheat'] }),
    lead('PII-C', { stage: 'won', name: 'Chand', crops: ['Chana'] }),
    lead('PII-L'),
  ];
  const business = {
    'PII-A': { orders: 1, spend: 900, last_order_at: daysAgo(40) },
    'PII-B': { orders: 3, spend: 5000, last_order_at: daysAgo(3) },
    'PII-C': { orders: 2, spend: 2000, last_order_at: daysAgo(10) },
  };

  it('lists won leads with their business, latest order first by default', async () => {
    const { service } = setup({ rows: customers, business });
    const page = await service.list(ME, query());
    expect(page.items.map((c) => c.pii_id)).toEqual([
      'PII-B',
      'PII-C',
      'PII-A',
    ]);
    expect(page.items[0]).toMatchObject({
      orders: 3,
      spend: 5000,
      last_order_stage: 'shipped',
    });
  });

  it('sorts by spend or name, and narrows to a crop (any case)', async () => {
    const { service } = setup({ rows: customers, business });
    const bySpend = await service.list(ME, query({ sort: '-spend' }));
    expect(bySpend.items.map((c) => c.pii_id)).toEqual([
      'PII-B',
      'PII-C',
      'PII-A',
    ]);
    const byName = await service.list(ME, query({ sort: 'name' }));
    expect(byName.items.map((c) => c.name)).toEqual(['Asha', 'Bhola', 'Chand']);
    const wheat = await service.list(ME, query({ crop: 'WHEAT' }));
    expect(wheat.items.map((c) => c.pii_id).sort()).toEqual(['PII-A', 'PII-B']);
  });

  it('narrows to customers ordered for in a month (Reports)', async () => {
    const { service, orders } = setup({ rows: customers, business });
    const page = await service.list(ME, query({ ordered_in: '2026-09' }));
    expect(page.items.map((c) => c.pii_id)).toEqual(['PII-C']);
    expect(orders.buyersIn).toHaveBeenCalledWith(ME.agent_id, '2026-09');
  });

  it('counts the tiles: total, active in 30 days, business, crop chips', async () => {
    const { service } = setup({ rows: customers, business });
    expect(await service.summary(ME)).toEqual({
      total: 3,
      active_30_days: 2,
      total_business: 7900,
      crops: [
        { key: 'Wheat', count: 2 },
        { key: 'Chana', count: 1 },
        { key: 'Soybean', count: 1 },
      ],
    });
  });

  it('shows one customer with their average order; a lead is not one', async () => {
    const { service } = setup({ rows: customers, business });
    expect(await service.get(ME, 'pii-b')).toMatchObject({
      pii_id: 'PII-B',
      orders: 3,
      average_order: 1667,
    });
    expect(await codeOf(service.get(ME, 'PII-L'))).toBe('NOT_FOUND');
  });
});
