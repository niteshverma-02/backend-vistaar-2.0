import type { HttpException } from '@nestjs/common';

import type {
  CustomerBusiness,
  OrderService,
} from '@modules/orders/services/order.service';
import type { EarningCohortsService } from '@modules/earning/services/earning-cohorts.service';
import type { SettingsService } from '@modules/settings/services/settings.service';

import {
  AdminCustomerQueryDto,
  CustomerQueryDto,
  type OrderEventDto,
} from '../dto/customer.dto';
import type { VistaarLeadsRepository } from '../repositories/vistaar-leads.repository';
import { CustomersService } from './customers.service';
import type { LeadsService } from './leads.service';
import type { RewardsService } from '@modules/rewards/services/rewards.service';

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
  const earning = { recomputeLater: jest.fn() };
  const rewards = { reorder: jest.fn().mockResolvedValue([]) };
  const leads = { mirrorFollowUp: jest.fn().mockResolvedValue(undefined) };
  const service = new CustomersService(
    repo as unknown as VistaarLeadsRepository,
    orders as unknown as OrderService,
    settings as unknown as SettingsService,
    leads as unknown as LeadsService,
    earning as unknown as EarningCohortsService,
    rewards as unknown as RewardsService,
  );
  return { service, repo, orders, earning, rewards };
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

  it('rewards a repeat order with the gap, never a replay or an older one', async () => {
    const { service, repo, rewards } = setup({ rows: [lead('PII-9')] });
    const repeatDate = daysAgo(2).toISOString();
    await service.recordOrder(
      ordered({ order_id: 'KSK-0', order_date: daysAgo(9).toISOString() }),
    );
    expect(rewards.reorder).not.toHaveBeenCalled(); // the first order wins, not reorders

    await service.recordOrder(
      ordered({ order_id: 'KSK-2', order_date: repeatDate }),
    );
    expect(rewards.reorder).toHaveBeenCalledWith(
      ME.agent_id,
      { pii_id: 'PII-9', name: repo.rows.get('PII-9')!.name },
      'KSK-2',
      7,
    );

    rewards.reorder.mockClear();
    // A replay of the same order, and one older than the last, pay nothing.
    await service.recordOrder(
      ordered({ order_id: 'KSK-2', order_date: repeatDate }),
    );
    await service.recordOrder(
      ordered({ order_id: 'KSK-1', order_date: daysAgo(5).toISOString() }),
    );
    expect(rewards.reorder).not.toHaveBeenCalled();
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

describe('CustomersService — HO', () => {
  const business = new Map<string, CustomerBusiness>([
    [
      'PII-B',
      {
        orders: 2,
        spend: 3000,
        last_order_at: new Date('2026-10-10T00:00:00Z'),
        last_order_stage: 'delivered',
      },
    ],
  ]);
  const leads = {
    list: jest.fn().mockResolvedValue({
      items: [
        { pii_id: 'PII-A', stage: 'won', last_order_at: null, partner: null },
        { pii_id: 'PII-B', stage: 'won', last_order_at: null, partner: null },
      ],
      total: 2,
    }),
    get: jest.fn(),
    partnerNames: jest
      .fn()
      .mockResolvedValue(new Map([['VST-000001', { name: 'Asha' }]])),
  };
  const rows = {
    customerSummary: jest.fn().mockResolvedValue({
      customers: 3,
      by_partner: [
        { key: 'VST-000001', count: 2 },
        { key: 'VST-000009', count: 1 },
      ],
      by_crop: [{ key: 'wheat', count: 3 }],
    }),
  };
  const orders = { businessOfBuyers: jest.fn().mockResolvedValue(business) };
  const service = new CustomersService(
    rows as unknown as VistaarLeadsRepository,
    orders as unknown as OrderService,
    {} as SettingsService,
    leads as unknown as LeadsService,
    {} as EarningCohortsService,
    { reorder: jest.fn().mockResolvedValue([]) } as unknown as RewardsService,
  );

  it('lists won leads only, latest order first, with one business read for the page', async () => {
    const query = new AdminCustomerQueryDto();
    expect(query.sort).toBe('-last_order_at');
    const page = await service.adminList(query);
    expect((leads.list.mock.calls[0] as [AdminCustomerQueryDto])[0].stage).toBe(
      'won',
    );
    expect(orders.businessOfBuyers).toHaveBeenCalledWith(['PII-A', 'PII-B']);
    expect(page.items.map((c) => [c.pii_id, c.orders, c.spend])).toEqual([
      ['PII-A', 0, 0],
      ['PII-B', 2, 3000],
    ]);
  });

  it('answers 404 for a farmer who is not a customer', async () => {
    leads.get.mockResolvedValueOnce({ pii_id: 'PII-A', stage: 'interested' });
    await expect(service.adminGet('PII-A')).rejects.toMatchObject({
      status: 404,
    });
    leads.get.mockResolvedValueOnce({
      pii_id: 'PII-B',
      stage: 'won',
      last_order_at: null,
    });
    await expect(service.adminGet('PII-B')).resolves.toMatchObject({
      orders: 2,
      average_order: 1500,
    });
  });

  it('names the top partners in the summary; an unknown one stays unnamed', async () => {
    const summary = await service.adminSummary();
    expect(leads.partnerNames).toHaveBeenCalledWith([
      'VST-000001',
      'VST-000009',
    ]);
    expect(summary.by_partner).toEqual([
      { key: 'VST-000001', count: 2, name: 'Asha' },
      { key: 'VST-000009', count: 1, name: null },
    ]);
    expect(summary.by_crop).toEqual([{ key: 'wheat', count: 3 }]);
  });
});
