import type {
  AgentRecord,
  AgentsService,
} from '@modules/agents/services/agents.service';
import type { EarningCohortsService } from '@modules/earning/services/earning-cohorts.service';
import type { GigReadsService } from '@modules/gigs/services/gig-reads.service';
import type { OnboardingService } from '@modules/onboarding/services/onboarding.service';
import type { RewardsService } from '@modules/rewards/services/rewards.service';
import type { SettingsService } from '@modules/settings/services/settings.service';
import type { ProductFactsService } from '@modules/spine/services/product-facts.service';
import type { StorageService } from '@modules/uploads/services/storage.service';

import {
  defaultPlan,
  type OrderFact,
  type PlanInEffect,
  type SavedPlans,
} from '../commission.domain';
import { LedgerQueryDto } from '../dto/commission.dto';
import type { CommissionOrderRepository } from '../repositories/commission-order.repository';
import type { TdsCertificateRepository } from '../repositories/tds-certificate.repository';
import type {
  WithdrawalRecord,
  WithdrawalRepository,
} from '../repositories/withdrawal.repository';
import type { CommissionPlansService } from './commission-plans.service';
import { CommissionService } from './commission.service';

const DAY = 24 * 3600 * 1000;

function fact(id: string, daysAgoDelivered: number | null): OrderFact {
  const now = Date.now();
  return {
    order_id: id,
    placed_at: new Date(now - 30 * DAY),
    pii_id: 'PII-1',
    customer_name: 'Ramesh',
    order_status: daysAgoDelivered === null ? 'created' : 'delivered',
    // An unknown pack: GST taken at 18%, so ₹11,800 is ₹10,000.
    lines: [{ sku: 'K-UNKNOWN', qty: 1, total: 11_800, free: false }],
    deduction: 0,
    delivered_at:
      daysAgoDelivered === null ? null : new Date(now - daysAgoDelivered * DAY),
    off_at: null,
  };
}

describe('CommissionService', () => {
  let factsFor: jest.Mock;
  let forAgent: jest.Mock;
  let settingsGet: jest.Mock;
  let creditsFor: jest.Mock;
  let assignmentsOf: jest.Mock;
  let current: jest.Mock;
  let saved: SavedPlans;
  let service: CommissionService;

  beforeEach(() => {
    factsFor = jest.fn().mockResolvedValue([fact('A', 20), fact('B', null)]);
    forAgent = jest.fn().mockResolvedValue([
      {
        _id: 'WD-2',
        status: 'paid',
        amount: 100,
        paid_at: new Date(Date.now() - 2 * DAY),
      },
      { _id: 'WD-3', status: 'requested', amount: 200, paid_at: null },
      { _id: 'WD-1', status: 'rejected', amount: 900, paid_at: null },
    ] as Partial<WithdrawalRecord>[]);
    settingsGet = jest.fn().mockResolvedValue({
      return_window_days: 7,
      monthly_target: 100_000,
      gig_pay_enabled: false,
      tds_rate_with_pan: 2,
      tds_rate_without_pan: 20,
      min_withdrawal: 500,
    });
    creditsFor = jest
      .fn()
      .mockResolvedValue([
        { id: 'GIG-1', amount: 250, approved_at: new Date(Date.now() - DAY) },
      ]);

    assignmentsOf = jest.fn().mockResolvedValue([]);
    current = jest.fn().mockResolvedValue({
      cohort: { _id: 'ec_default', name: 'Everyone else' },
      since: null,
    });
    saved = () => null;

    service = new CommissionService(
      { factsFor } as unknown as CommissionOrderRepository,
      { forAgent } as unknown as WithdrawalRepository,
      {} as TdsCertificateRepository,
      {
        termsFor: jest.fn().mockResolvedValue(() => ({
          ...defaultPlan('vistaar_agent'),
          cohort: 'vistaar_agent',
          plan_id: null,
          effective_from: null,
        })),
        saved: jest.fn(() => Promise.resolve(saved)),
        inEffect: jest.fn().mockResolvedValue([]),
      } as unknown as CommissionPlansService,
      { get: settingsGet } as unknown as SettingsService,
      {
        requireByAgentId: jest.fn().mockResolvedValue({
          _id: 'ref-1',
          agent_id: 'VST-000001',
          pii_id: 'PII-9',
          cohort: 'vistaar_agent',
          stage: 'approved',
          is_active: true,
          monthly_target: null,
        }),
      } as unknown as AgentsService,
      {} as OnboardingService,
      {
        facts: jest.fn().mockResolvedValue(new Map()),
      } as unknown as ProductFactsService,
      {} as StorageService,
      { creditsFor } as unknown as GigReadsService,
      { assignmentsOf, current } as unknown as EarningCohortsService,
      {
        gigCreditsFor: jest.fn().mockResolvedValue([]),
      } as unknown as RewardsService,
    );
  });

  it('builds the book from the orders, paid payouts and open requests', async () => {
    const { book, partner } = await service.bookOf('vst-000001');
    expect(partner.monthly_target).toBe(100_000);
    expect(book.rows.find((r) => r.order_id === 'A')).toMatchObject({
      order_value: 10_000,
      rate: 5,
      amount: 500,
      status: 'confirmed',
      paid_amount: 100,
    });
    // Rejected withdrawals hold nothing.
    expect(book).toMatchObject({
      earned: 500,
      paid: 100,
      open: 200,
      withdrawable: 200,
    });
  });

  it('reads a partner’s orders and withdrawals once a minute however many screens ask', async () => {
    await Promise.all([
      service.summary('VST-000001'),
      service.ledger('VST-000001', new LedgerQueryDto()),
      service.forOrders('VST-000001'),
    ]);
    expect(factsFor).toHaveBeenCalledTimes(1);
    expect(forAgent).toHaveBeenCalledTimes(1);

    // Before money moves, withdrawals are read fresh.
    await service.bookOf('VST-000001', new Date(), true);
    expect(forAgent).toHaveBeenCalledTimes(2);
    expect(factsFor).toHaveBeenCalledTimes(1);

    service.forget('VST-000001');
    await service.summary('VST-000001');
    expect(factsFor).toHaveBeenCalledTimes(2);
  });

  it('reads approved gigs only when gig pay is on, and adds them to the wallet', async () => {
    const off = await service.summary('VST-000001');
    await service.bookOf('VST-000001', new Date(), true);
    expect(creditsFor).not.toHaveBeenCalled();
    expect(off).toMatchObject({
      earned: 500,
      gig_earned: 0,
      withdrawable: 200,
    });

    settingsGet.mockResolvedValue({
      return_window_days: 7,
      monthly_target: 100_000,
      gig_pay_enabled: true,
    });
    const on = await service.summary('VST-000001');
    expect(creditsFor).toHaveBeenCalledWith('VST-000001');
    expect(on).toMatchObject({
      earned: 750,
      gig_earned: 250,
      withdrawable: 450,
    });
  });

  it('filters the ledger by status and keeps the whole-ledger totals', async () => {
    const page = await service.ledger(
      'VST-000001',
      Object.assign(new LedgerQueryDto(), { status: 'pending' }),
    );
    expect(page.items.map((i) => i.order_id)).toEqual(['B']);
    expect(page.items[0]).toMatchObject({ id: 'cm-B', status: 'pending' });
    expect(page.totals.confirmed.count).toBe(1);
  });

  it('sweeps for HO without filling the caches or re-reading the partner', async () => {
    const known = {
      _id: 'ref-1',
      agent_id: 'VST-000001',
      pii_id: 'PII-9',
      cohort: 'vistaar_agent',
      stage: 'approved',
      is_active: true,
      monthly_target: null,
    } as unknown as AgentRecord;
    await service.bookOf('VST-000001', new Date(), false, known, false);
    await service.bookOf('VST-000001', new Date(), false, known, false);
    // Nothing kept: each sweep reads again; the app's next read still loads once.
    expect(factsFor).toHaveBeenCalledTimes(2);
    await service.summary('VST-000001');
    expect(factsFor).toHaveBeenCalledTimes(3);
  });

  const paddy = (terms: Partial<PlanInEffect> = {}): PlanInEffect => ({
    cohort: 'ec_paddy',
    plan_id: 'ec_paddy@2026-09',
    effective_from: '2026-09',
    kind: 'fixed',
    slabs: [{ from: 0, to: null, rate: 8 }],
    min_order_value: null,
    notes: [],
    draft: false,
    ...terms,
  });

  it('earns orders placed in an earning cohort at its plan, the stretches read once a minute', async () => {
    assignmentsOf.mockResolvedValue([
      {
        agent_id: 'VST-000001',
        cohort_id: 'ec_paddy',
        from: new Date(Date.now() - 40 * DAY),
        to: null,
      },
    ]);
    saved = (cohort) => (cohort === 'ec_paddy' ? paddy() : null);

    const page = await service.ledger('VST-000001', new LedgerQueryDto());
    expect(page.items.find((i) => i.order_id === 'A')).toMatchObject({
      rate: 8,
      amount: 800,
      cohort_id: 'ec_paddy',
      plan_id: 'ec_paddy@2026-09',
      below_min_order: false,
    });
    await service.summary('VST-000001');
    expect(assignmentsOf).toHaveBeenCalledTimes(1);
    expect(assignmentsOf).toHaveBeenCalledWith(['VST-000001']);

    // Before money moves, read fresh.
    await service.bookOf('VST-000001', new Date(), true);
    expect(assignmentsOf).toHaveBeenCalledTimes(2);
  });

  it('shows My plan from the earning cohort now, and what a small order earns', async () => {
    current.mockResolvedValue({
      cohort: { _id: 'ec_paddy', name: 'Paddy belt' },
      since: new Date('2026-09-10T00:00:00Z'),
    });
    saved = (cohort) =>
      cohort === 'ec_paddy' ? paddy({ min_order_value: 2_000 }) : null;

    const { my_plan } = await service.plansFor('VST-000001');
    expect(my_plan).toMatchObject({
      earning_cohort: { id: 'ec_paddy', name: 'Paddy belt' },
      inherits: null,
      kind: 'fixed',
      slabs: [{ from: 0, to: null, rate: 8 }],
      min_order_value: 2_000,
      // No default-cohort plan saved: the partner-type plan.
      below_min_order: {
        kind: 'slabs',
        slabs: defaultPlan('vistaar_agent').slabs,
      },
    });
  });

  it('shows the partner-type plan before approval, and while no earning plan is saved', async () => {
    const before = await service.plansFor('VST-000001');
    expect(before.my_plan).toMatchObject({
      earning_cohort: null,
      inherits: null,
      slabs: defaultPlan('vistaar_agent').slabs,
      below_min_order: null,
    });

    current.mockResolvedValue({
      cohort: { _id: 'ec_paddy', name: 'Paddy belt' },
      since: new Date(),
    });
    const after = await service.plansFor('VST-000001');
    expect(after.my_plan).toMatchObject({
      earning_cohort: { id: 'ec_paddy' },
      inherits: 'partner_type',
      slabs: defaultPlan('vistaar_agent').slabs,
    });
  });
});
