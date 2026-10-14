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
import type { LeadsService } from '@modules/leads/services/leads.service';
import type { ProductFactsService } from '@modules/spine/services/product-facts.service';

import { PerformanceService } from './performance.service';

// 5 Oct, noon IST: the newest sale (2 Oct) is 3 days old.
const NOW = new Date('2026-10-05T06:30:00Z');
const THIS = istMonthKey(NOW);
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
      } as unknown as LeadsService,
      { fieldDays } as unknown as AttendanceService,
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
        setMonthlyTarget: jest.fn().mockResolvedValue({
          agent_id: 'VST-000001',
          monthly_target: 150_000,
        }),
      } as unknown as AgentsService,
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
    expect(view.gigs).toBeNull();
    expect(view.from).toBe(`${addMonths(THIS, -2)}-01`);
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
});
