import type { HttpException } from '@nestjs/common';

import type { AdminPrincipal } from '@common/interfaces/principal.interface';
import { istDate } from '@common/utils/ist-day.util';
import { capabilitiesOf, type Capability } from '@modules/access/access.domain';
import type { AccessService } from '@modules/access/services/access.service';
import type { AgentsService } from '@modules/agents/services/agents.service';
import type { AdminAttendanceService } from '@modules/attendance/services/admin-attendance.service';
import type { WalletService } from '@modules/commission/services/wallet.service';
import type { AdminFeedbackService } from '@modules/feedback/services/admin-feedback.service';
import type { AdminGigsService } from '@modules/gigs/services/admin-gigs.service';
import type { LeadsService } from '@modules/leads/services/leads.service';
import type { AdminOrderService } from '@modules/orders/services/admin-order.service';
import type { RewardsService } from '@modules/rewards/services/rewards.service';

import { OverviewQueryService } from './overview.query-service';

const admin: AdminPrincipal = {
  kind: 'admin',
  email: 'head@katyayaniorganics.com',
  iat: 1,
  exp: 2,
};
const money = (count: number, amount: number) => ({ count, amount });
const totals = (pending: number, approved: number) => ({
  pending: money(1, pending),
  approved: money(2, approved),
  rejected: money(0, 0),
});
const stages = {
  signed_up: 1,
  onboarding: 0,
  kyc_review: 2,
  changes_requested: 0,
  approved: 5,
  rejected: 0,
  blocked: 0,
};
const leadCards = (total: number, won: number) => ({
  total,
  today: 1,
  last_7_days: 6,
  partners: 2,
  due_today: 3,
  overdue: 4,
  by_stage: [
    { key: 'prospect', count: total - won },
    { key: 'won', count: won },
  ],
  by_partner: [],
  by_state: [],
});

function setup(capabilities: Capability[] = capabilitiesOf('head')) {
  const deps = {
    access: {
      accessFor: jest.fn().mockResolvedValue({ capabilities }),
    },
    orders: {
      summary: jest
        .fn()
        .mockResolvedValueOnce({
          orders: 10,
          value: 5000,
          partners: 3,
          customers: 8,
          by_stage: [],
        })
        .mockResolvedValueOnce({
          orders: 6,
          value: 4000,
          partners: 2,
          customers: 5,
          by_stage: [],
        }),
    },
    agents: {
      stageCounts: jest.fn().mockResolvedValue({
        stages,
        unverified: 3,
        total: 8,
        by_cohort: [],
        by_state: [],
      }),
      rangeCounts: jest.fn().mockResolvedValue({ signed_up: 4, approved: 2 }),
    },
    leads: {
      // All time without from / to; the period's leads with them.
      summary: jest.fn((q?: { from?: string }) =>
        Promise.resolve(q?.from ? leadCards(9, 2) : leadCards(40, 5)),
      ),
    },
    attendance: {
      board: jest.fn().mockResolvedValue({
        date: '2026-10-23',
        today: '2026-10-23',
        summary: {
          partners: 5,
          on_duty: 2,
          day_closed: 1,
          missed_punch_out: 0,
          not_started: 2,
          worked_ms: 0,
          avg_worked_ms: 0,
        },
        rows: [],
        trend: [],
      }),
    },
    wallet: {
      totals: jest.fn().mockResolvedValue({
        requested: money(2, 3000),
        approved: { count: 1, amount: 1000, tds: 20, net: 980 },
        paid_this_month: { count: 0, amount: 0, tds: 0, net: 0 },
        paid_this_fy: { count: 0, amount: 0, tds: 0, net: 0 },
      }),
    },
    rewards: {
      // The period's rewards with from / to; every day's without.
      summary: jest.fn((q: { from?: string }) =>
        Promise.resolve(
          q.from
            ? { coin: totals(5, 50), gig: totals(100, 300), pending: 2 }
            : { coin: totals(25, 75), gig: totals(200, 550), pending: 3 },
        ),
      ),
    },
    gigs: {
      summary: jest.fn().mockResolvedValue({
        by_status: { open: 1, approved: 2 },
        partners: 2,
        approved_payout: 500,
        farmers: 40,
        from: '2026-10-01',
        to: '2026-10-23',
      }),
    },
    feedback: {
      summary: jest.fn().mockResolvedValue({
        from: '2026-10-01',
        to: '2026-10-23',
        total: 5,
        nps: 20,
        follow_ups: { open: 2, overdue: 1 },
      }),
    },
  };
  const service = new OverviewQueryService(
    deps.access as unknown as AccessService,
    deps.orders as unknown as AdminOrderService,
    deps.agents as unknown as AgentsService,
    deps.leads as unknown as LeadsService,
    deps.attendance as unknown as AdminAttendanceService,
    deps.wallet as unknown as WalletService,
    deps.rewards as unknown as RewardsService,
    deps.gigs as unknown as AdminGigsService,
    deps.feedback as unknown as AdminFeedbackService,
  );
  return { service, ...deps };
}

const period = { from: '2026-10-01', to: '2026-10-23' };
// Midnight IST that starts 1 Oct, and the one after 23 Oct.
const bounds = [
  new Date('2026-09-30T18:30:00Z'),
  new Date('2026-10-23T18:30:00Z'),
];

describe('OverviewQueryService', () => {
  it("answers every block for a head, each from its own route's numbers", async () => {
    const s = setup();

    const out = await s.service.get(admin, period);

    expect(out).toEqual({
      from: '2026-10-01',
      to: '2026-10-23',
      prev: { from: '2026-09-08', to: '2026-09-30' },
      orders: {
        orders: 10,
        value: 5000,
        partners: 3,
        customers: 8,
        prev: { orders: 6, value: 4000 },
      },
      partners: {
        total: 8,
        approved: 5,
        signups_in_range: 4,
        approved_in_range: 2,
        stages,
      },
      leads: {
        total: 40,
        today: 1,
        last_7_days: 6,
        added_in_range: 9,
        won_in_range: 2,
        due_today: 3,
        overdue: 4,
        by_stage: [
          { key: 'prospect', count: 35 },
          { key: 'won', count: 5 },
        ],
      },
      attendance_today: {
        partners: 5,
        on_duty: 2,
        day_closed: 1,
        not_started: 2,
      },
      payouts: {
        requested_count: 2,
        requested_amount: 3000,
        approved_net: 980,
      },
      rewards: {
        coin_approved: 50,
        gig_approved: 300,
        coin_pending: 25,
        gig_pending: 200,
        pending: 3,
      },
      gigs: {
        by_status: { open: 1, approved: 2 },
        partners: 2,
        approved_payout: 500,
        farmers: 40,
      },
      nps: { nps: 20, open_follow_ups: 2, overdue: 1 },
    });
  });

  it('asks each source for the period, the order cards also for the period before', async () => {
    const s = setup();

    await s.service.get(admin, period);

    expect(s.orders.summary.mock.calls.map((c: unknown[]) => c[0])).toEqual([
      expect.objectContaining(period),
      expect.objectContaining({ from: '2026-09-08', to: '2026-09-30' }),
    ]);
    expect(s.agents.rangeCounts).toHaveBeenCalledWith(...bounds);
    expect(s.leads.summary.mock.calls.map((c: unknown[]) => c[0])).toEqual([
      undefined,
      period,
    ]);
    expect(s.attendance.board).toHaveBeenCalledWith();
    expect(s.rewards.summary.mock.calls.map((c: unknown[]) => c[0])).toEqual([
      period,
      {},
    ]);
    expect(s.gigs.summary).toHaveBeenCalledWith(
      expect.objectContaining(period),
    );
    expect(s.feedback.summary).toHaveBeenCalledWith('2026-10-01', '2026-10-23');
  });

  it('leaves out — null, never a 403 — only the blocks the role may not read', async () => {
    const s = setup(['orders.read', 'leads.read']);

    const out = await s.service.get(admin, period);

    expect(out.orders).not.toBeNull();
    expect(out.leads).not.toBeNull();
    expect(out).toMatchObject({
      partners: null,
      attendance_today: null,
      payouts: null,
      rewards: null,
      gigs: null,
      nps: null,
    });
    for (const unread of [
      s.agents.stageCounts,
      s.attendance.board,
      s.wallet.totals,
      s.rewards.summary,
      s.gigs.summary,
      s.feedback.summary,
    ])
      expect(unread).not.toHaveBeenCalled();
  });

  it('answers the other blocks when one source fails', async () => {
    const s = setup();
    s.wallet.totals.mockRejectedValueOnce(new Error('socket closed'));

    const out = await s.service.get(admin, period);

    expect(out.payouts).toBeNull();
    expect(out.orders).not.toBeNull();
    expect(out.nps).not.toBeNull();
  });

  it('is this IST month so far by default, compared with as many days before', async () => {
    const s = setup();
    const today = istDate(new Date());

    const out = await s.service.get(admin, {});

    expect(out).toMatchObject({ from: `${today.slice(0, 7)}-01`, to: today });
    expect(out.prev.to < out.from).toBe(true);
  });

  it('refuses a period ending before it starts or over 366 days, before reading', async () => {
    for (const query of [
      { from: '2026-10-23', to: '2026-10-01' },
      { from: '2025-01-01', to: '2026-10-23' },
    ]) {
      const s = setup();
      const error = await s.service.get(admin, query).catch((e: unknown) => e);
      expect((error as HttpException).getStatus()).toBe(400);
      expect(s.access.accessFor).not.toHaveBeenCalled();
      expect(s.orders.summary).not.toHaveBeenCalled();
    }
  });
});
