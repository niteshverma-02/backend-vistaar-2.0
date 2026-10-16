import { addMonths, istMonthKey } from '@common/utils/ist-day.util';
import type { EarningCohortsService } from '@modules/earning/services/earning-cohorts.service';
import type { CohortsService } from '@modules/onboarding/services/cohorts.service';

import { defaultPlan } from '../commission.domain';
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
    // Partner-type plans only here: the earning cohorts are never read.
    service = new CommissionPlansService(
      repo,
      cohorts,
      {} as EarningCohortsService,
    );
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
