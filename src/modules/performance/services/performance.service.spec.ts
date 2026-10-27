import {
  addMonths,
  istMonthKey,
  istMonthStart,
} from '@common/utils/ist-day.util';
import type { AgentsService } from '@modules/agents/services/agents.service';
import type { AttendanceService } from '@modules/attendance/services/attendance.service';
import {
  buildBook,
  defaultPlan,
  type OrderFact,
} from '@modules/commission/commission.domain';
import type {
  CommissionService,
  PartnerBook,
} from '@modules/commission/services/commission.service';
import type { GigReadsService } from '@modules/gigs/services/gig-reads.service';
import type { LeadsService } from '@modules/leads/services/leads.service';
import type { MeetingsService } from '@modules/meetings/services/meetings.service';
import type { RewardsService } from '@modules/rewards/services/rewards.service';
import type { ProductFactsService } from '@modules/spine/services/product-facts.service';

import { AdminPerformanceQueryDto } from '../dto/performance.dto';
import { PerformanceService } from './performance.service';

// 5 Oct, noon IST: the newest sale (2 Oct) is 3 days old.
const NOW = new Date('2026-10-05T06:30:00Z');
const THIS = istMonthKey(NOW);
const GIGS = { done: 2, earnings: 3000, farmers: 46, upcoming: 1 };
const DAY = 24 * 3600 * 1000;

/** An order placed and delivered on day 2 of `month`, worth `base` before GST (0% here). */
function sale(id: string, month: string, base: number, sku = 'K-1'): OrderFact {
  const at = new Date(istMonthStart(month).getTime() + DAY);
  return {
    order_id: id,
    placed_at: at,
    pii_id: `PII-${id}`,
    customer_name: id,
    order_status: 'delivered',
    lines: [{ sku, qty: 2, total: base, free: false }],
    deduction: 0,
    delivered_at: at,
    off_at: null,
  };
}

describe('PerformanceService', () => {
  beforeAll(() =>
    jest.useFakeTimers({
      now: NOW,
      doNotFake: [
        'nextTick',
        'setImmediate',
        'setTimeout',
        'setInterval',
        'queueMicrotask',
      ],
    }),
  );
  afterAll(() => jest.useRealTimers());

  let bookOf: jest.Mock;
  let fieldDays: jest.Mock;
  let service: PerformanceService;

  beforeEach(() => {
    const facts = [
      sale('A', THIS, 30_000, 'K-1'),
      sale('B', THIS, 10_000, 'K-2'),
      sale('C', addMonths(THIS, -1), 60_000),
      sale('D', addMonths(THIS, -2), 90_000),
      sale('E', addMonths(THIS, -3), 150_000),
      sale('F', addMonths(THIS, -4), 5_000),
    ];
    bookOf = jest.fn((_id: string, now: Date = NOW) =>
      Promise.resolve({
        partner: { cohort: 'vistaar_agent', monthly_target: 100_000 },
        book: buildBook(facts, {
          now,
          selfPiiId: 'PII-9',
          returnWindowDays: 7,
          planFor: () => defaultPlan('vistaar_agent'),
          gstOf: () => 0,
          payouts: [],
          open: 0,
        }),
      } as unknown as PartnerBook),
    );
    fieldDays = jest.fn().mockResolvedValue(5);
    service = new PerformanceService(
      { bookOf, forget: jest.fn() } as unknown as CommissionService,
      {
        performance: jest.fn().mockResolvedValue({
          total: 10,
          won: 6,
          lost: 2,
          conversion_pct: 60,
          overdue_follow_ups: 1,
        }),
        addedBetween: jest.fn().mockResolvedValue([
          {
            pii_id: 'PII-L1',
            name: 'Ramesh',
            village: 'Sehore',
            stage: 'new',
            created_at: NOW,
          },
        ]),
        activityBetween: jest.fn().mockResolvedValue({
          added: 3,
          won: 1,
          lost: 0,
          activities: { call: 4, visit: 2, whatsapp: 1, note: 0 },
        }),
        countsByPartner: jest
          .fn()
          .mockResolvedValue(
            new Map([['VST-000001', { farmers: 12, customers: 4 }]]),
          ),
      } as unknown as LeadsService,
      {
        fieldDays,
        between: jest
          .fn()
          .mockResolvedValue({ present_days: 1, worked_ms: 3_600_000 }),
      } as unknown as AttendanceService,
      {
        facts: jest.fn().mockResolvedValue(
          new Map([
            [
              'K-1',
              {
                name: 'Humic',
                image: 'https://x/a.png',
                gst_rate: 0,
                category: 'Fertilizers & Nutrition',
              },
            ],
            ['K-2', { name: 'Neem', image: null, gst_rate: 0, category: null }],
          ]),
        ),
      } as unknown as ProductFactsService,
      {
        list: jest.fn().mockResolvedValue({
          items: [
            {
              agent_id: 'VST-000001',
              cohort: 'vistaar_agent',
              profile: { name: 'Asha', district: 'BHOPAL', state: 'MP' },
            },
          ],
          total: 1,
        }),
        approvedBrief: jest.fn().mockResolvedValue([
          {
            agent_id: 'VST-000001',
            cohort: 'vistaar_agent',
            profile: { name: 'Asha' },
          },
          {
            agent_id: 'VST-000002',
            cohort: 'consultant',
            profile: { name: 'Ravi' },
          },
          {
            agent_id: 'VST-000003',
            cohort: 'other',
            profile: { name: 'Broken' },
          },
        ]),
        setMonthlyTarget: jest.fn().mockResolvedValue({
          agent_id: 'VST-000001',
          monthly_target: 150_000,
        }),
      } as unknown as AgentsService,
      {
        monthStats: jest.fn().mockResolvedValue(GIGS),
        statsBetween: jest.fn().mockRejectedValue(new Error('down')),
      } as unknown as GigReadsService,
      {
        totalsMine: jest.fn().mockResolvedValue({
          by_status: { scheduled: 1, completed: 2, cancelled: 0 },
          present: 30,
          leads: 5,
        }),
      } as unknown as MeetingsService,
      {
        coinsBetween: jest
          .fn()
          .mockResolvedValue({ approved: 50, pending: 10 }),
      } as unknown as RewardsService,
    );
  });

  it('works out the period against the one before it', async () => {
    const view = await service.performance('VST-000001', '3m', NOW);
    expect(view.sales).toEqual({ value: 190_000, previous: 155_000 });
    expect(view.target).toEqual({ value: 300_000, achieved_pct: 63 });
    expect(view.orders_placed).toEqual({ value: 4, previous: 2 });
    expect(view.active_customers).toEqual({ value: 4, previous: 2 });
    expect(view.lead_conversion).toEqual({
      total: 10,
      won: 6,
      lost: 2,
      pct: 60,
    });
    expect(view.gigs).toEqual(GIGS);
    expect(view.from).toBe(`${addMonths(THIS, -2)}-01`);
  });

  it("counts one day's or one month's activity from the book and the other modules", async () => {
    const day = await service.activity('vst-000001', 'day', '2026-10-02', NOW);
    expect(day).toMatchObject({
      period: 'day',
      from: '2026-10-02',
      to: '2026-10-03',
      leads: { added: 3, won: 1, lost: 0 },
      customers: { new: 2, active: 2 },
      orders: { placed: 2, value: 40_000, delivered: 2, sales: 40_000 },
      attendance: { present_days: 1, worked_ms: 3_600_000 },
      activities: { call: 4, visit: 2, whatsapp: 1, note: 0 },
      meetings: { held: 2, scheduled: 1, farmers: 30, leads: 5 },
      gigs: null,
      coins: { approved: 50, pending: 10 },
    });
    const month = await service.performance('VST-000001', 'month', NOW);
    expect(day.commission).toBe(month.commission.value);

    const quiet = await service.activity(
      'VST-000001',
      'day',
      '2026-10-03',
      NOW,
    );
    expect(quiet.orders).toEqual({
      placed: 0,
      value: 0,
      delivered: 0,
      sales: 0,
    });
    expect(quiet.customers).toEqual({ new: 0, active: 0 });

    const year = await service.activity('VST-000001', 'year', undefined, NOW);
    expect([year.from, year.to]).toEqual(['2026-04-01', '2027-04-01']);
    expect(year.orders.placed).toBe(6); // June to October
  });

  it('lists the rows behind the cards: orders, first orders, delivered, leads', async () => {
    const list = (kind: 'orders' | 'customers' | 'delivered' | 'leads') =>
      service.activityItems('VST-000001', 'day', kind, '2026-10-02', NOW);

    const orders = await list('orders');
    expect(orders.items.map((i) => [i.title, i.ref, i.amount])).toEqual([
      ['B', 'B', 10_000], // same moment: the book's order
      ['A', 'A', 30_000],
    ]);
    expect((await list('customers')).items.map((i) => i.ref).sort()).toEqual([
      'PII-A',
      'PII-B',
    ]);
    expect((await list('delivered')).items).toHaveLength(2);
    expect((await list('leads')).items[0]).toMatchObject({
      title: 'Ramesh',
      sub: 'Sehore · new',
      ref: 'PII-L1',
    });
    const empty = await service.activityItems(
      'VST-000001',
      'day',
      'orders',
      '2026-10-03',
      NOW,
    );
    expect(empty.items).toEqual([]);
  });

  it('splits delivered lines by category and names the top packs', async () => {
    const view = await service.performance('VST-000001', 'month', NOW);
    expect(view.by_category).toEqual([
      { name: 'Fertilizers & Nutrition', value: 30_000, pct: 75 },
      { name: 'Other', value: 10_000, pct: 25 },
    ]);
    expect(view.top_products[0]).toEqual({
      sku: 'K-1',
      name: 'Humic',
      image: 'https://x/a.png',
      qty: 2,
      value: 30_000,
    });
  });

  it('tiers on the three completed months and scores health', async () => {
    const view = await service.performance('VST-000001', 'month', NOW);
    // (60,000 + 90,000 + 150,000) / 3 = 1,00,000 → gold.
    expect(view.tier).toMatchObject({ current: 'gold', avg_3m_sales: 100_000 });
    // Ordered 3 days ago, 5 field days, no open course; but 2 orders
    // this month (< 4) and an overdue follow-up: 3 of 5 good.
    expect(view.health.score).toBe(60);
    expect(view.lifecycle_stage).toBe('active');
  });

  it('keeps the standing for five minutes, and forgets it when HO sets a target', async () => {
    const first = await service.standing('vst-000001');
    expect(first).toMatchObject({
      cohort: 'vistaar_agent',
      tier: 'gold',
      health_score: 60,
      monthly_target: 100_000,
    });
    await service.standing('VST-000001');
    expect(bookOf).toHaveBeenCalledTimes(1);

    await expect(
      service.setTarget('VST-000001', 150_000, 'ho@k.com'),
    ).resolves.toEqual({ agent_id: 'VST-000001', own_target: 150_000 });
    await service.standing('VST-000001');
    expect(bookOf).toHaveBeenCalledTimes(2);
  });

  it('gives HO one row per approved partner for a month from their book', async () => {
    const page = await service.adminList(
      Object.assign(new AdminPerformanceQueryDto(), {
        month: addMonths(THIS, -1),
      }),
    );
    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({
      agent_id: 'VST-000001',
      name: 'Asha',
      district: 'BHOPAL',
      sales: 60_000,
      rate: 7,
      commission: 4_200,
      orders_placed: 1,
      monthly_target: 100_000,
      achieved_pct: 60,
      tier: 'gold',
      lifecycle_stage: 'active',
    });
  });

  it('boards every approved partner from their own book, without caching their books, kept 10 minutes', async () => {
    const real = bookOf.getMockImplementation()!;
    bookOf.mockImplementation((id: string, ...rest: unknown[]) =>
      id === 'VST-000003'
        ? Promise.reject(new Error('bad book'))
        : (real as (...a: unknown[]) => Promise<PartnerBook>)(id, ...rest),
    );
    const board = await service.board(addMonths(THIS, -1));
    expect(board.partners).toBe(2);
    expect(board.failed).toBe(1);
    expect(board.rows.map((r) => [r.agent_id, r.farmers, r.customers])).toEqual(
      [
        ['VST-000001', 12, 4],
        ['VST-000002', 0, 0],
      ],
    );
    // Same book for both in this test: 60,000 delivered last month at 7%.
    expect(board.totals).toMatchObject({ sales: 120_000, commission: 8_400 });
    // The sweep never stores books (5th argument false).
    expect((bookOf.mock.calls[0] as unknown[])[4]).toBe(false);

    const calls = bookOf.mock.calls.length;
    await service.board(addMonths(THIS, -1));
    expect(bookOf.mock.calls.length).toBe(calls);
  });
});
