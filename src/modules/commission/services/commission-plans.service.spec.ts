import { addMonths, istMonthKey } from '@common/utils/ist-day.util';
import type { CohortsService } from '@modules/onboarding/services/cohorts.service';

import { defaultPlan } from '../commission.domain';
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
    service = new CommissionPlansService(repo, cohorts);
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
