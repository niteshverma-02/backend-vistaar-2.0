import { addMonths, istMonthKey } from '@common/utils/ist-day.util';
import type { EarningCohortsService } from '@modules/earning/services/earning-cohorts.service';
import type { CohortsService } from '@modules/onboarding/services/cohorts.service';

import { defaultPlan, earningPlanIn } from '../commission.domain';
import type { CreatePlanDto } from '../dto/commission-plan.dto';
import type {
  CommissionPlanRepository,
  PlanRecord,
} from '../repositories/commission-plan.repository';
import { CommissionPlansService } from './commission-plans.service';

const THIS = istMonthKey(new Date());
const LAST = addMonths(THIS, -1);
const NEXT = addMonths(THIS, 1);
const SLABS = [
  { from: 0, to: 75_000, rate: 6 },
  { from: 75_000, to: null, rate: 9 },
];

function plan(cohort: string, month: string, rate = 6): PlanRecord {
  return {
    _id: `${cohort}@${month}`,
    cohort,
    effective_from: month,
    // Saved before plan kinds: no `kind`, no `min_order_value`.
    slabs: [{ from: 0, to: null, rate }],
    notes: [],
    draft: false,
    created_by: 'ho@k.com',
    updated_by: 'ho@k.com',
    history: [],
    created_at: new Date(),
    updated_at: new Date('2026-10-01T00:00:00Z'),
  };
}

describe('CommissionPlansService', () => {
  let rows: PlanRecord[];
  let repo: jest.Mocked<CommissionPlanRepository>;
  let service: CommissionPlansService;

  beforeEach(() => {
    rows = [plan('consultant', LAST, 4), plan('consultant', NEXT, 9)];
    repo = {
      all: jest.fn(() => Promise.resolve(rows)),
      findById: jest.fn((id: string) =>
        Promise.resolve(rows.find((r) => r._id === id) ?? null),
      ),
      insert: jest.fn((row: PlanRecord) => {
        rows.push({
          ...row,
          history: [],
          created_at: new Date(),
          updated_at: new Date(),
        });
        return Promise.resolve(true);
      }),
      update: jest.fn((id: string) =>
        Promise.resolve(rows.find((r) => r._id === id) ?? null),
      ),
      remove: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<CommissionPlanRepository>;
    const cohorts = {
      require: jest.fn().mockResolvedValue({ _id: 'consultant' }),
      list: jest.fn().mockResolvedValue([
        { _id: 'vistaar_agent', label: { en: 'Vistaar Agent' } },
        { _id: 'consultant', label: { en: 'Consultant' } },
      ]),
    } as unknown as CohortsService;
    // Partner-type plans only here: no earning cohort has a switch.
    service = new CommissionPlansService(repo, cohorts, {
      all: jest.fn().mockResolvedValue([]),
    } as unknown as EarningCohortsService);
  });

  it('uses the latest plan started by the month, else the PRD’s draft rates', async () => {
    const consultant = await service.termsFor('consultant');
    expect(consultant(addMonths(THIS, -6))).toMatchObject({
      plan_id: null,
      draft: true,
      slabs: defaultPlan('consultant').slabs,
    });
    expect(consultant(THIS)).toMatchObject({
      plan_id: `consultant@${LAST}`,
      kind: 'slabs',
      min_order_value: null,
      slabs: [{ from: 0, to: null, rate: 4 }],
    });
    expect(consultant(addMonths(THIS, 5)).plan_id).toBe(`consultant@${NEXT}`);

    const inEffect = await service.inEffect(THIS);
    expect(inEffect.map((p) => [p.cohort, p.label, p.plan_id])).toEqual([
      ['vistaar_agent', 'Vistaar Agent', null],
      ['consultant', 'Consultant', `consultant@${LAST}`],
    ]);
    // One read of the plans for all of it.
    expect(repo.all).toHaveBeenCalledTimes(1);
  });

  it('adds a plan from this month on, never for a past month', async () => {
    await service.create(
      { cohort: 'consultant', effective_from: THIS, slabs: SLABS },
      'ho@k.com',
    );
    expect(repo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ _id: `consultant@${THIS}`, draft: true }),
    );

    await expect(
      service.create(
        { cohort: 'consultant', effective_from: LAST, slabs: SLABS },
        'ho@k.com',
      ),
    ).rejects.toMatchObject({
      status: 409,
      response: { error: 'PLAN_LOCKED' },
    });

    repo.insert.mockResolvedValueOnce(false);
    await expect(
      service.create(
        { cohort: 'consultant', effective_from: NEXT, slabs: SLABS },
        'ho@k.com',
      ),
    ).rejects.toMatchObject({
      status: 409,
      response: { error: 'PLAN_EXISTS' },
    });
  });

  it('refuses slabs that do not join up', async () => {
    await expect(
      service.create(
        {
          cohort: 'consultant',
          effective_from: NEXT,
          slabs: [
            { from: 0, to: 50_000, rate: 5 },
            { from: 40_000, to: null, rate: 7 },
          ],
        },
        'ho@k.com',
      ),
    ).rejects.toMatchObject({
      status: 400,
      response: { error: 'VALIDATION_FAILED' },
    });
  });

  it('locks a past plan’s slabs but lets it be signed off, keeping history', async () => {
    await expect(
      service.update(`consultant@${LAST}`, { slabs: SLABS }, 'ho@k.com'),
    ).rejects.toMatchObject({ response: { error: 'PLAN_LOCKED' } });

    await service.update(`consultant@${LAST}`, { draft: true }, 'ho@k.com');
    const [, seen, set, before] = repo.update.mock.calls[0];
    expect(seen).toEqual(rows[0].updated_at);
    expect(set).toEqual({ draft: true, updated_by: 'ho@k.com' });
    expect(before).toMatchObject({ action: 'created', draft: false });

    await expect(service.remove(`consultant@${LAST}`)).rejects.toMatchObject({
      response: { error: 'PLAN_LOCKED' },
    });
    await expect(service.remove(`consultant@${NEXT}`)).resolves.toEqual({
      deleted: true,
    });
  });

  it('answers 409 when the plan changed after it was read', async () => {
    repo.update.mockResolvedValueOnce(null);
    await expect(
      service.update(`consultant@${NEXT}`, { draft: false }, 'ho@k.com'),
    ).rejects.toMatchObject({
      status: 409,
      response: { error: 'VERSION_CONFLICT' },
    });
  });
});

describe('CommissionPlansService — earning cohorts', () => {
  let rows: PlanRecord[];
  let repo: jest.Mocked<CommissionPlanRepository>;
  let service: CommissionPlansService;

  beforeEach(() => {
    rows = [];
    repo = {
      all: jest.fn(() => Promise.resolve(rows)),
      findById: jest.fn((id: string) =>
        Promise.resolve(rows.find((r) => r._id === id) ?? null),
      ),
      insert: jest.fn((row: PlanRecord) => {
        rows.push({
          ...row,
          history: [],
          created_at: new Date(),
          updated_at: new Date(),
        });
        return Promise.resolve(true);
      }),
      update: jest.fn((id: string) =>
        Promise.resolve(rows.find((r) => r._id === id) ?? null),
      ),
    } as unknown as jest.Mocked<CommissionPlanRepository>;
    const earning = {
      find: jest.fn((id: string) =>
        Promise.resolve(
          id === 'ec_missing'
            ? null
            : { _id: id, status: id === 'ec_gone' ? 'archived' : 'active' },
        ),
      ),
      all: jest.fn().mockResolvedValue([
        { _id: 'ec_paddy', name: 'Paddy belt', status: 'active' },
        { _id: 'ec_cotton', name: 'Cotton', status: 'active' },
        { _id: 'ec_gone', name: 'Old', status: 'archived' },
        { _id: 'ec_default', name: 'Everyone else', status: 'active' },
      ]),
    } as unknown as EarningCohortsService;
    service = new CommissionPlansService(
      repo,
      { require: jest.fn() } as unknown as CohortsService,
      earning,
    );
  });

  const create = (body: Partial<CreatePlanDto>) =>
    service.create(
      { cohort: 'ec_paddy', effective_from: NEXT, ...body },
      'ho@k.com',
    );

  it('stores a fixed plan as one slab, with a minimum order value', async () => {
    await create({ kind: 'fixed', rate: 8, min_order_value: 2_000 });
    expect(repo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: `ec_paddy@${NEXT}`,
        kind: 'fixed',
        slabs: [{ from: 0, to: null, rate: 8 }],
        min_order_value: 2_000,
      }),
    );
  });

  it('refuses terms that do not fit the kind, and a minimum where it cannot apply', async () => {
    const code = (p: Promise<unknown>) =>
      p.then(
        () => null,
        (e: { response: { error: string } }) => e.response.error,
      );
    expect(await code(create({ kind: 'fixed', slabs: SLABS }))).toBe(
      'VALIDATION_FAILED',
    );
    expect(await code(create({ rate: 8 }))).toBe('VALIDATION_FAILED');
    expect(
      await code(
        create({
          cohort: 'ec_default',
          kind: 'fixed',
          rate: 5,
          min_order_value: 500,
        }),
      ),
    ).toBe('VALIDATION_FAILED');
    expect(
      await code(
        create({ cohort: 'consultant', slabs: SLABS, min_order_value: 500 }),
      ),
    ).toBe('VALIDATION_FAILED');
    expect(await code(create({ cohort: 'ec_missing', slabs: SLABS }))).toBe(
      'COHORT_NOT_FOUND',
    );
    expect(await code(create({ cohort: 'ec_gone', slabs: SLABS }))).toBe(
      'EARNING_ARCHIVED',
    );
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it('switches a plan to fixed only with its rate', async () => {
    await create({ slabs: SLABS });
    await expect(
      service.update(`ec_paddy@${NEXT}`, { kind: 'fixed' }, 'ho@k.com'),
    ).rejects.toMatchObject({ response: { error: 'VALIDATION_FAILED' } });
    await service.update(
      `ec_paddy@${NEXT}`,
      { kind: 'fixed', rate: 9, min_order_value: null },
      'ho@k.com',
    );
    const [, , set, before] = repo.update.mock.calls[0];
    expect(set).toMatchObject({
      kind: 'fixed',
      slabs: [{ from: 0, to: null, rate: 9 }],
      min_order_value: null,
    });
    expect(before).toMatchObject({ kind: 'slabs', slabs: SLABS });
  });

  it('shows each earning cohort’s rates and whose they inherit', async () => {
    rows.push(
      plan('ec_paddy', LAST, 8),
      plan('ec_cotton', NEXT, 9), // not in effect yet
    );
    const none = await service.inEffect(THIS, 'earning');
    expect(none.map((p) => [p.cohort, p.plan_id, p.inherits])).toEqual([
      ['ec_paddy', `ec_paddy@${LAST}`, null],
      ['ec_cotton', null, 'partner_type'],
      ['ec_default', null, 'partner_type'],
    ]);

    rows.push(plan('ec_default', LAST, 5));
    (service as unknown as { cached: null }).cached = null;
    const withDefault = await service.inEffect(THIS, 'earning');
    expect(withDefault[1]).toMatchObject({
      cohort: 'ec_cotton',
      label: 'Cotton',
      plan_id: `ec_default@${LAST}`,
      inherits: 'ec_default',
      slabs: [{ from: 0, to: null, rate: 5 }],
    });
  });
});

describe('CommissionPlansService — commission switched off', () => {
  const TWO_AGO = addMonths(THIS, -2);
  let rows: PlanRecord[];
  let cohorts: {
    _id: string;
    name: string;
    status: string;
    commission_off?: { from: string; to: string | null }[];
  }[];
  let all: jest.Mock;
  let listeners: (() => void)[];
  let service: CommissionPlansService;

  beforeEach(() => {
    rows = [
      plan('ec_paddy', TWO_AGO, 8),
      plan('ec_cotton', TWO_AGO, 9),
      plan('ec_default', TWO_AGO, 5),
    ];
    cohorts = [
      // Off last month only (switched on again this month).
      {
        _id: 'ec_paddy',
        name: 'Paddy belt',
        status: 'active',
        commission_off: [{ from: LAST, to: LAST }],
      },
      // Off from this month on.
      {
        _id: 'ec_cotton',
        name: 'Cotton',
        status: 'active',
        commission_off: [{ from: THIS, to: null }],
      },
      { _id: 'ec_wheat', name: 'Wheat', status: 'active' },
      { _id: 'ec_default', name: 'Everyone else', status: 'active' },
    ];
    all = jest.fn(() => Promise.resolve(cohorts));
    listeners = [];
    service = new CommissionPlansService(
      {
        all: jest.fn(() => Promise.resolve(rows)),
      } as unknown as CommissionPlanRepository,
      {} as CohortsService,
      {
        all,
        onCommissionChange: (l: () => void) => listeners.push(l),
      } as unknown as EarningCohortsService,
    );
    service.onModuleInit();
  });

  it('a month inside an off range has no own plan: ec_default’s applies; before and after, its own', async () => {
    const saved = await service.saved();
    const rateOf = (cohort: string, month: string) =>
      earningPlanIn(cohort, month, saved)?.slabs[0].rate;
    // Before, inside, after the closed range.
    expect(rateOf('ec_paddy', TWO_AGO)).toBe(8);
    expect(rateOf('ec_paddy', LAST)).toBe(5);
    expect(rateOf('ec_paddy', THIS)).toBe(8);
    // Open range: this month and every later one, never the months before.
    expect(rateOf('ec_cotton', LAST)).toBe(9);
    expect(rateOf('ec_cotton', THIS)).toBe(5);
    expect(rateOf('ec_cotton', NEXT)).toBe(5);
    expect(saved('ec_cotton', THIS)).toBeNull();
    // The fallback itself is never off.
    expect(saved('ec_default', THIS)?.plan_id).toBe(`ec_default@${TWO_AGO}`);
  });

  it('in-effect rows say why a cohort inherits', async () => {
    const reasons = async (month: string) =>
      (await service.inEffect(month, 'earning')).map((p) => [
        p.cohort,
        p.inherits,
        p.inherits_reason,
      ]);
    expect(await reasons(THIS)).toEqual([
      ['ec_paddy', null, null],
      ['ec_cotton', 'ec_default', 'commission_off'],
      ['ec_wheat', 'ec_default', 'no_plan'],
      ['ec_default', null, null],
    ]);
    expect((await reasons(LAST))[0]).toEqual([
      'ec_paddy',
      'ec_default',
      'commission_off',
    ]);
    // Off with nothing on ec_default either: each partner's partner-type plan.
    rows = [plan('ec_cotton', TWO_AGO, 9)];
    (service as unknown as { cached: null }).cached = null;
    expect((await reasons(THIS))[1]).toEqual([
      'ec_cotton',
      'partner_type',
      'commission_off',
    ]);
  });

  it('reads the switches once a minute, and again at once after a switch here', async () => {
    await service.saved();
    await service.saved();
    expect(all).toHaveBeenCalledTimes(1);

    // HO switches cotton back on this month: the open range goes.
    cohorts[1] = { ...cohorts[1], commission_off: [] };
    expect(listeners).toHaveLength(1);
    listeners[0]();
    const saved = await service.saved();
    expect(all).toHaveBeenCalledTimes(2);
    expect(earningPlanIn('ec_cotton', THIS, saved)?.slabs[0].rate).toBe(9);
  });
});
