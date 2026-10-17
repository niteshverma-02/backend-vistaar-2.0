import type { HttpException } from '@nestjs/common';

import type {
  AgentsService,
  EarningPartnerRecord,
} from '@modules/agents/services/agents.service';

import { CreateEarningCohortDto } from '../dto/earning-cohort.dto';
import { DEFAULT_COHORT_ID, NO_FILTERS } from '../earning.domain';
import type { EarningAssignmentRepository } from '../repositories/earning-assignment.repository';
import type {
  EarningCohortRecord,
  EarningCohortRepository,
} from '../repositories/earning-cohort.repository';
import {
  EarningCohortsService,
  type Holdings,
} from './earning-cohorts.service';

const HO = 'ho@katyayaniorganics.com';
const OLD = new Date('2026-10-01T00:00:00Z');

const cohort = (
  id: string,
  extra: Partial<EarningCohortRecord> = {},
): EarningCohortRecord => ({
  _id: id,
  name: id,
  description: null,
  // Stored as a pre-conditions row on purpose: reads must convert it.
  conditions: null,
  filters: NO_FILTERS,
  priority: 0,
  status: 'active',
  meeting_gig_payout: null,
  version: 1,
  created_by: HO,
  updated_by: HO,
  archived_by: null,
  archived_at: null,
  created_at: OLD,
  updated_at: OLD,
  ...extra,
});

const BIG = cohort('ec_big', {
  priority: 1,
  filters: { ...NO_FILTERS, min_leads: 10 },
});

const partner = (
  id: string,
  extra: Partial<EarningPartnerRecord> = {},
): EarningPartnerRecord => ({
  _id: `ref-${id}`,
  agent_id: id,
  stage: 'approved',
  is_active: true,
  profile: { state: 'MADHYA PRADESH', district: 'Bhopal', pincode: '462026' },
  ...extra,
});

function setup(
  opts: {
    partners?: EarningPartnerRecord[];
    open?: { _id: string; agent_id: string; cohort_id: string; from: Date }[];
    held?: Record<string, Holdings>;
    cohorts?: EarningCohortRecord[];
  } = {},
) {
  const partners = opts.partners ?? [partner('VST-000001')];
  let open = [...(opts.open ?? [])];
  const repo = {
    all: jest
      .fn()
      .mockResolvedValue(opts.cohorts ?? [cohort(DEFAULT_COHORT_ID), BIG]),
    find: jest.fn((id: string) =>
      Promise.resolve(
        (opts.cohorts ?? [cohort(DEFAULT_COHORT_ID), BIG]).find(
          (c) => c._id === id,
        ) ?? null,
      ),
    ),
    ensureDefault: jest.fn().mockResolvedValue(undefined),
    create: jest.fn().mockResolvedValue(true),
    save: jest.fn().mockResolvedValue(null),
    archive: jest.fn().mockResolvedValue(null),
    setPriorities: jest.fn().mockResolvedValue(undefined),
  };
  const assignments = {
    open: jest.fn((id: string) =>
      Promise.resolve(open.find((o) => o.agent_id === id) ?? null),
    ),
    openAll: jest.fn(() => Promise.resolve(open)),
    switchTo: jest.fn(
      (id: string, _openId: string | null, cohortId: string, since: Date) => {
        open = [
          ...open.filter((o) => o.agent_id !== id),
          { _id: `new-${id}`, agent_id: id, cohort_id: cohortId, from: since },
        ];
        return Promise.resolve(true);
      },
    ),
    switchMany: jest.fn((moves: { agent_id: string }[]) =>
      Promise.resolve(new Set(moves.map((m) => m.agent_id))),
    ),
  };
  const agents = {
    earningPartner: jest.fn((id: string) =>
      Promise.resolve(partners.find((p) => p.agent_id === id) ?? null),
    ),
    earningPartners: jest.fn().mockResolvedValue(partners),
    setEarningCohorts: jest.fn().mockResolvedValue(undefined),
    earningCohortCounts: jest.fn().mockResolvedValue(new Map()),
  };
  const held = new Map(Object.entries(opts.held ?? {}));
  const service = new EarningCohortsService(
    repo as unknown as EarningCohortRepository,
    assignments as unknown as EarningAssignmentRepository,
    agents as unknown as AgentsService,
  );
  service.useHoldings(() => Promise.resolve(held));
  const later = jest
    .spyOn(service, 'recomputeAllLater')
    .mockImplementation(() => undefined);
  return { service, repo, assignments, agents, later };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return ((error as HttpException).getResponse() as { error: string }).error;
  }
  return 'no error';
}

describe('EarningCohortsService.recompute', () => {
  it('opens the first stretch and copies it onto the partner', async () => {
    const { service, assignments, agents } = setup({
      held: { 'VST-000001': { open_leads: 12, customers: 0 } },
    });
    const done = await service.recompute('vst-000001', 'partner_approved');

    expect(done).toMatchObject({ cohort_id: 'ec_big', changed: true });
    expect(assignments.switchTo).toHaveBeenCalledWith(
      'VST-000001',
      null,
      'ec_big',
      expect.any(Date),
      'partner_approved',
    );
    expect(agents.setEarningCohorts).toHaveBeenCalledWith([
      { agent_id: 'VST-000001', cohort: { id: 'ec_big', since: done.since } },
    ]);
  });

  it('writes nothing when the cohort is unchanged and already copied', async () => {
    const { service, assignments, agents } = setup({
      partners: [
        partner('VST-000001', {
          earning_cohort: { id: DEFAULT_COHORT_ID, since: OLD },
        }),
      ],
      open: [
        {
          _id: 'a1',
          agent_id: 'VST-000001',
          cohort_id: DEFAULT_COHORT_ID,
          from: OLD,
        },
      ],
    });
    const done = await service.recompute('VST-000001', 'holdings_changed');

    expect(done).toEqual({
      agent_id: 'VST-000001',
      cohort_id: DEFAULT_COHORT_ID,
      changed: false,
      since: OLD,
    });
    expect(assignments.switchTo).not.toHaveBeenCalled();
    expect(agents.setEarningCohorts).not.toHaveBeenCalled();
  });

  it('closes the open stretch when the partner moves', async () => {
    const { service, assignments } = setup({
      open: [
        {
          _id: 'a1',
          agent_id: 'VST-000001',
          cohort_id: DEFAULT_COHORT_ID,
          from: OLD,
        },
      ],
      held: { 'VST-000001': { open_leads: 10, customers: 0 } },
    });
    await service.recompute('VST-000001', 'holdings_changed');
    expect(assignments.switchTo).toHaveBeenCalledWith(
      'VST-000001',
      'a1',
      'ec_big',
      expect.any(Date),
      'holdings_changed',
    );
  });

  it('matches a conditions cohort ahead of a legacy-filters one, in priority order', async () => {
    const belt = cohort('ec_belt', {
      priority: 1,
      conditions: [
        { field: 'state', op: 'any_of', value: ['MADHYA PRADESH'] },
        { field: 'customers', op: 'lte', value: 3 },
      ],
    });
    const { service } = setup({
      cohorts: [cohort(DEFAULT_COHORT_ID), belt, { ...BIG, priority: 2 }],
      held: { 'VST-000001': { open_leads: 12, customers: 2 } },
    });
    const done = await service.recompute('VST-000001', 'holdings_changed');
    expect(done.cohort_id).toBe('ec_belt');
  });

  it('leaves a partner who is not approved as they were', async () => {
    const { service, assignments } = setup({
      partners: [partner('VST-000001', { stage: 'blocked' })],
    });
    const done = await service.recompute('VST-000001', 'holdings_changed');
    expect(done).toMatchObject({ cohort_id: null, changed: false });
    expect(assignments.switchTo).not.toHaveBeenCalled();
  });

  it('reads again after losing the race to another process', async () => {
    const { service, assignments } = setup({
      held: { 'VST-000001': { open_leads: 12, customers: 0 } },
    });
    // Another process opened `ec_big` between our read and our write.
    assignments.switchTo.mockImplementationOnce(() => {
      assignments.open.mockResolvedValue({
        _id: 'theirs',
        agent_id: 'VST-000001',
        cohort_id: 'ec_big',
        from: OLD,
      });
      return Promise.resolve(false);
    });
    const done = await service.recompute('VST-000001', 'holdings_changed');
    expect(done).toMatchObject({ cohort_id: 'ec_big', changed: false });
    expect(assignments.switchTo).toHaveBeenCalledTimes(1);
  });
});

describe('EarningCohortsService.recomputeAll', () => {
  it('writes only the partners who move, in bulk', async () => {
    const { service, assignments, agents } = setup({
      partners: [
        partner('VST-000001', {
          earning_cohort: { id: DEFAULT_COHORT_ID, since: OLD },
        }),
        partner('VST-000002'),
        partner('VST-000003'),
        partner('VST-000004', { stage: 'blocked' }),
      ],
      open: [
        {
          _id: 'a1',
          agent_id: 'VST-000001',
          cohort_id: DEFAULT_COHORT_ID,
          from: OLD,
        },
        {
          _id: 'a2',
          agent_id: 'VST-000002',
          cohort_id: DEFAULT_COHORT_ID,
          from: OLD,
        },
      ],
      held: { 'VST-000002': { open_leads: 15, customers: 1 } },
    });
    const done = await service.recomputeAll('cohorts_changed');

    expect(done).toEqual({ partners: 3, changed: 2 });
    expect(assignments.switchMany).toHaveBeenCalledWith(
      [
        { agent_id: 'VST-000002', open_id: 'a2', cohort_id: 'ec_big' },
        { agent_id: 'VST-000003', open_id: null, cohort_id: DEFAULT_COHORT_ID },
      ],
      expect.any(Date),
      'cohorts_changed',
    );
    const synced = (
      agents.setEarningCohorts.mock.calls[0] as [{ agent_id: string }[]]
    )[0].map((r) => r.agent_id);
    expect(synced).toEqual(['VST-000002', 'VST-000003']);
  });

  it('looks again, one by one, at partners another process moved meanwhile', async () => {
    const { service, assignments } = setup({
      partners: [partner('VST-000001')],
      held: { 'VST-000001': { open_leads: 12, customers: 0 } },
    });
    assignments.switchMany.mockResolvedValueOnce(new Set());
    const done = await service.recomputeAll('cohorts_changed');
    expect(assignments.switchTo).toHaveBeenCalledTimes(1);
    expect(done.changed).toBe(1);
  });
});

describe('EarningCohortsService — HO', () => {
  const dto = (extra: Partial<CreateEarningCohortDto> = {}) =>
    Object.assign(new CreateEarningCohortDto(), {
      name: 'Big books',
      filters: { min_leads: 10 },
      ...extra,
    });

  it('refuses a cohort without a filter — that would be the default', async () => {
    const { service } = setup();
    expect(await codeOf(service.create(dto({ filters: {} }), HO))).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('makes the id from the name, skips taken ones, goes above the default, recomputes', async () => {
    const { service, repo, later } = setup({
      cohorts: [
        cohort(DEFAULT_COHORT_ID),
        cohort('ec_big_books', { priority: 4 }),
      ],
    });
    repo.find.mockResolvedValue(cohort('ec_big_books_2'));
    await service.create(dto(), HO);

    // Legacy filters are converted and stored as conditions; `filters` is the derived view.
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: 'ec_big_books_2',
        priority: 5,
        conditions: [{ field: 'open_leads', op: 'gte', value: 10 }],
        filters: { ...NO_FILTERS, min_leads: 10 },
      }),
    );
    expect(later).toHaveBeenCalledWith('cohorts_changed');
  });

  it('stores conditions as sent, normalised, and derives the legacy filters', async () => {
    const { service, repo } = setup();
    repo.find.mockResolvedValue(cohort('ec_belt'));
    await service.create(
      dto({
        key: 'belt',
        filters: undefined,
        conditions: [
          { field: 'state', op: 'any_of', value: ['madhya pradesh'] },
          { field: 'customers', op: 'lte', value: 3 },
        ],
      }),
      HO,
    );
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: 'ec_belt',
        conditions: [
          { field: 'state', op: 'any_of', value: ['MADHYA PRADESH'] },
          { field: 'customers', op: 'lte', value: 3 },
        ],
        // An `lte` has no legacy shape, so only the state appears.
        filters: { ...NO_FILTERS, states: ['MADHYA PRADESH'] },
      }),
    );
  });

  it('refuses a condition the catalog refuses, an empty list, and both shapes at once', async () => {
    const { service } = setup();
    const bad = (conditions: unknown[], filters?: unknown) =>
      codeOf(
        service.create(
          dto({
            filters: filters as CreateEarningCohortDto['filters'],
            conditions: conditions as CreateEarningCohortDto['conditions'],
          }),
          HO,
        ),
      );
    expect(await bad([{ field: 'crops', op: 'eq', value: 'x' }])).toBe(
      'VALIDATION_FAILED',
    );
    expect(await bad([{ field: 'state', op: 'gte', value: 1 }])).toBe(
      'VALIDATION_FAILED',
    );
    expect(await bad([{ field: 'open_leads', op: 'gte', value: 'ten' }])).toBe(
      'VALIDATION_FAILED',
    );
    expect(await bad([])).toBe('VALIDATION_FAILED');
    expect(
      await bad([{ field: 'open_leads', op: 'gte', value: 1 }], {
        min_leads: 2,
      }),
    ).toBe('VALIDATION_FAILED');
  });

  it('answers COHORT_EXISTS for a key in use', async () => {
    const { service, repo } = setup();
    repo.create.mockResolvedValue(false);
    expect(await codeOf(service.create(dto({ key: 'vip' }), HO))).toBe(
      'COHORT_EXISTS',
    );
    expect(await codeOf(service.create(dto({ key: 'default' }), HO))).toBe(
      'COHORT_EXISTS',
    );
  });

  it('never conditions, filters or archives the default', async () => {
    const { service } = setup();
    expect(
      await codeOf(
        service.update(
          DEFAULT_COHORT_ID,
          { version: 1, filters: { min_leads: 1 } },
          HO,
        ),
      ),
    ).toBe('EARNING_COHORT_LOCKED');
    expect(
      await codeOf(
        service.update(
          DEFAULT_COHORT_ID,
          {
            version: 1,
            conditions: [{ field: 'open_leads', op: 'gte', value: 1 }],
          },
          HO,
        ),
      ),
    ).toBe('EARNING_COHORT_LOCKED');
    expect(await codeOf(service.archive(DEFAULT_COHORT_ID, HO))).toBe(
      'EARNING_COHORT_LOCKED',
    );
  });

  it('answers VERSION_CONFLICT for a stale edit; a name-only edit moves nobody', async () => {
    const { service, repo, later } = setup();
    expect(
      await codeOf(service.update('ec_big', { version: 1, name: 'Big' }, HO)),
    ).toBe('VERSION_CONFLICT');
    repo.save.mockResolvedValue(BIG);
    await service.update('ec_big', { version: 1, name: 'Big' }, HO);
    expect(later).not.toHaveBeenCalled();
    await service.update(
      'ec_big',
      { version: 2, filters: { min_leads: 20 } },
      HO,
    );
    // A legacy edit merges over the stored legacy view, then stores conditions.
    expect(repo.save).toHaveBeenLastCalledWith(
      'ec_big',
      2,
      {
        conditions: [{ field: 'open_leads', op: 'gte', value: 20 }],
        filters: { ...NO_FILTERS, min_leads: 20 },
      },
      HO,
    );
    expect(later).toHaveBeenCalledWith('cohorts_changed');
  });

  it('replaces the whole condition list on PATCH, and recomputes only on a real change', async () => {
    const { service, repo, later } = setup();
    repo.save.mockResolvedValue(BIG);
    await service.update(
      'ec_big',
      {
        version: 1,
        conditions: [
          { field: 'district', op: 'any_of', value: ['Bhopal', 'Sehore'] },
        ],
      },
      HO,
    );
    expect(repo.save).toHaveBeenLastCalledWith(
      'ec_big',
      1,
      {
        conditions: [
          { field: 'district', op: 'any_of', value: ['Bhopal', 'Sehore'] },
        ],
        filters: { ...NO_FILTERS, districts: ['Bhopal', 'Sehore'] },
      },
      HO,
    );
    expect(later).toHaveBeenCalledWith('cohorts_changed');
    later.mockClear();
    // The same conditions again: nothing moved, nobody recomputed.
    await service.update(
      'ec_big',
      {
        version: 2,
        conditions: [{ field: 'open_leads', op: 'gte', value: 10 }],
      },
      HO,
    );
    expect(later).not.toHaveBeenCalled();
  });

  it('answers conditions, the derived filters and a summary on read', async () => {
    const { service } = setup();
    const view = await service.adminGet('ec_big');
    expect(view.conditions).toEqual([
      { field: 'open_leads', op: 'gte', value: 10 },
    ]);
    expect(view.filters).toEqual({ ...NO_FILTERS, min_leads: 10 });
    expect(view.summary).toBe('Open leads at least 10');
    const fallback = await service.adminGet(DEFAULT_COHORT_ID);
    expect(fallback.conditions).toEqual([]);
    expect(fallback.summary).toBe('Every partner');
  });

  it('refuses a reorder that is not the whole active list', async () => {
    const { service, repo } = setup();
    expect(await codeOf(service.reorder([], HO))).toBe('EARNING_ORDER_CHANGED');
    await service.reorder(['ec_big'], HO);
    expect(repo.setPriorities).toHaveBeenCalledWith(['ec_big'], HO);
  });

  it('assigns an approved partner on first read', async () => {
    const { service, assignments } = setup();
    const now = await service.current('VST-000001');
    expect(now.cohort._id).toBe(DEFAULT_COHORT_ID);
    expect(now.since).toBeInstanceOf(Date);
    expect(assignments.switchTo).toHaveBeenCalledWith(
      'VST-000001',
      null,
      DEFAULT_COHORT_ID,
      expect.any(Date),
      'first_assignment',
    );
  });
});
