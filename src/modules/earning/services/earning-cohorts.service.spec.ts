import type { HttpException } from '@nestjs/common';

import { addMonths, istMonthKey } from '@common/utils/ist-day.util';
import type {
  AgentsService,
  EarningPartnerRecord,
} from '@modules/agents/services/agents.service';

import {
  CreateEarningCohortDto,
  type EarningCohortsQueryDto,
} from '../dto/earning-cohort.dto';
import { DEFAULT_COHORT_ID, NO_FILTERS } from '../earning.domain';
import type { EarningAssignmentRepository } from '../repositories/earning-assignment.repository';
import type { EarningRuleRepository } from '../repositories/earning-rule.repository';
import type { EarningWindowRepository } from '../repositories/earning-window.repository';
import type {
  EarningCohortRecord,
  EarningCohortRepository,
} from '../repositories/earning-cohort.repository';
import {
  EarningCohortsService,
  type Holdings,
} from './earning-cohorts.service';
import { EarningRulesService } from './earning-rules.service';

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
  rules: [],
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

/** `vistaar_v2_earning_window` as the repository answers: the first to move it to a day wins. */
function windowRow() {
  let day: string | null = null;
  return {
    claimDay: jest.fn((today: string) => {
      if (day === today) return Promise.resolve(null);
      const since = day;
      day = today;
      return Promise.resolve({ since });
    }),
  };
}

function setup(
  opts: {
    partners?: EarningPartnerRecord[];
    open?: { _id: string; agent_id: string; cohort_id: string; from: Date }[];
    held?: Record<string, Holdings>;
    cohorts?: EarningCohortRecord[];
    /** The shared window row; pass one to two setups for two processes. */
    window?: ReturnType<typeof windowRow>;
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
    (opts.window ?? windowRow()) as unknown as EarningWindowRepository,
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

  it('keeps the embedded rules off the cohort view; the rules routes serve them', async () => {
    const withRules = cohort('ec_big', {
      priority: 1,
      filters: { ...NO_FILTERS, min_leads: 10 },
      rules: [
        {
          _id: 'r1',
          name: 'r1',
          trigger: 'lead_created',
          conditions: [],
          reward: { kind: 'coin', amount: 5 },
          order: 1,
          status: 'active',
          version: 1,
          created_by: HO,
          updated_by: HO,
          archived_by: null,
          archived_at: null,
          created_at: OLD,
          updated_at: OLD,
        },
      ],
    });
    const { service } = setup({
      cohorts: [cohort(DEFAULT_COHORT_ID), withRules],
    });
    const view = await service.adminGet('ec_big');
    expect(view).not.toHaveProperty('rules');
    expect(view.id).toBe('ec_big');
  });

  it('reads a cohort not migrated yet (no rules field) as having none', async () => {
    const { rules: _gone, ...legacy } = cohort('ec_big', { priority: 1 });
    const { service } = setup({
      cohorts: [cohort(DEFAULT_COHORT_ID), legacy as EarningCohortRecord],
    });
    expect((await service.get('ec_big')).rules).toEqual([]);
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

  it('pays from the default once the partner’s cohort is archived', async () => {
    const { service } = setup({
      partners: [
        partner('VST-000001', { earning_cohort: { id: 'ec_big', since: OLD } }),
      ],
      cohorts: [
        cohort(DEFAULT_COHORT_ID),
        cohort('ec_big', { status: 'archived', archived_at: OLD }),
      ],
    });
    const now = await service.current('VST-000001');
    expect(now.cohort._id).toBe(DEFAULT_COHORT_ID);
    expect(now.since).toEqual(OLD);
  });
});

describe('EarningCohortsService — start and end dates', () => {
  /** Noon IST, 15 Nov 2026. */
  const NOON_15 = new Date('2026-11-15T06:30:00Z');
  const ID = 'VST-000001';

  beforeEach(() => jest.useFakeTimers({ now: NOON_15 }));
  afterEach(() => jest.useRealTimers());

  const newCohort = (extra: Partial<CreateEarningCohortDto> = {}) =>
    Object.assign(new CreateEarningCohortDto(), {
      name: 'Mela belt',
      key: 'mela_belt',
      conditions: [{ field: 'district', op: 'any_of', value: ['Bhopal'] }],
      ...extra,
    });

  const inBig = partner(ID, { earning_cohort: { id: 'ec_big', since: OLD } });

  it('create stores the dates, null when left out, and refuses bad ones', async () => {
    const { service, repo } = setup();
    repo.find.mockResolvedValue(cohort('ec_mela_belt'));
    await service.create(
      newCohort({ starts_on: '2026-11-01', ends_on: '2026-11-30' }),
      HO,
    );
    expect(repo.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        starts_on: '2026-11-01',
        ends_on: '2026-11-30',
      }),
    );
    await service.create(newCohort(), HO);
    expect(repo.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ starts_on: null, ends_on: null }),
    );

    repo.create.mockClear();
    for (const bad of [
      { starts_on: '2026-02-30' },
      { ends_on: '2026-11-31' },
      { starts_on: '2026-11-30', ends_on: '2026-11-01' },
    ]) {
      expect(await codeOf(service.create(newCohort(bad), HO))).toBe(
        'VALIDATION_FAILED',
      );
    }
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('PATCH sets, checks against the stored side, clears with null, and recomputes', async () => {
    const stored = cohort('ec_big', {
      starts_on: '2026-11-01',
      ends_on: '2026-11-30',
    });
    const { service, repo, later } = setup({
      cohorts: [cohort(DEFAULT_COHORT_ID), stored],
    });
    repo.save.mockResolvedValue(stored);

    // An end before the stored start is refused before any write.
    expect(
      await codeOf(
        service.update('ec_big', { version: 1, ends_on: '2026-10-31' }, HO),
      ),
    ).toBe('VALIDATION_FAILED');
    expect(repo.save).not.toHaveBeenCalled();

    await service.update('ec_big', { version: 1, ends_on: '2026-12-15' }, HO);
    expect(repo.save).toHaveBeenLastCalledWith(
      'ec_big',
      1,
      { ends_on: '2026-12-15' },
      HO,
    );
    expect(later).toHaveBeenCalledWith('cohorts_changed');

    later.mockClear();
    await service.update('ec_big', { version: 2, starts_on: null }, HO);
    expect(repo.save).toHaveBeenLastCalledWith(
      'ec_big',
      2,
      { starts_on: null },
      HO,
    );
    expect(later).toHaveBeenCalledWith('cohorts_changed');

    // The same dates again move nobody; a stale version is still refused.
    later.mockClear();
    await service.update(
      'ec_big',
      { version: 3, starts_on: '2026-11-01', ends_on: '2026-11-30' },
      HO,
    );
    expect(later).not.toHaveBeenCalled();
    repo.save.mockResolvedValue(null);
    expect(
      await codeOf(
        service.update('ec_big', { version: 1, ends_on: '2026-12-01' }, HO),
      ),
    ).toBe('VERSION_CONFLICT');
  });

  it('the default takes no dates; null on it is a no-op', async () => {
    const { service, repo } = setup();
    expect(
      await codeOf(
        service.update(
          DEFAULT_COHORT_ID,
          { version: 1, starts_on: '2026-11-01' },
          HO,
        ),
      ),
    ).toBe('EARNING_COHORT_LOCKED');
    expect(
      await codeOf(
        service.update(
          DEFAULT_COHORT_ID,
          { version: 1, ends_on: '2026-11-30' },
          HO,
        ),
      ),
    ).toBe('EARNING_COHORT_LOCKED');
    repo.save.mockResolvedValue(cohort(DEFAULT_COHORT_ID));
    await service.update(
      DEFAULT_COHORT_ID,
      { version: 1, name: 'Everyone', starts_on: null, ends_on: null },
      HO,
    );
    expect(repo.save).toHaveBeenLastCalledWith(
      DEFAULT_COHORT_ID,
      1,
      { name: 'Everyone' },
      HO,
    );
  });

  it('every view carries starts_on, ends_on and the window at IST today', async () => {
    const at = (starts_on: string | null, ends_on: string | null) =>
      cohort('ec_big', { starts_on, ends_on });
    const windowOf = async (c: EarningCohortRecord) => {
      const { service } = setup({ cohorts: [cohort(DEFAULT_COHORT_ID), c] });
      return service.adminGet('ec_big');
    };
    expect(await windowOf(at('2026-11-01', '2026-11-30'))).toMatchObject({
      starts_on: '2026-11-01',
      ends_on: '2026-11-30',
      window: 'running',
      summary: 'Every partner · 1 Nov 2026 – 30 Nov 2026',
    });
    expect((await windowOf(at('2026-11-16', null))).window).toBe('upcoming');
    expect((await windowOf(at(null, '2026-11-14'))).window).toBe('ended');
    // Both days included: it runs all of its last day.
    expect((await windowOf(at(null, '2026-11-15'))).window).toBe('running');
    // A row from before dates has neither.
    expect(await windowOf(BIG)).toMatchObject({
      starts_on: null,
      ends_on: null,
      window: null,
      summary: 'Open leads at least 10',
    });
    const { service } = setup({
      cohorts: [cohort(DEFAULT_COHORT_ID), at('2026-11-16', null)],
    });
    const page = await service.adminList({
      skip: 0,
      limit: 50,
    } as EarningCohortsQueryDto);
    expect(page.items.map((c) => [c.id, c.window])).toEqual([
      ['ec_big', 'upcoming'],
      [DEFAULT_COHORT_ID, null],
    ]);
  });

  it('current() pays from the default once the cohort has ended, and moves the partner', async () => {
    const { service } = setup({
      partners: [inBig],
      cohorts: [
        cohort(DEFAULT_COHORT_ID),
        cohort('ec_big', { ends_on: '2026-11-14' }),
      ],
    });
    const recompute = jest
      .spyOn(service, 'recomputeLater')
      .mockImplementation(() => undefined);
    const now = await service.current(ID);
    expect(now.cohort._id).toBe(DEFAULT_COHORT_ID);
    expect(recompute).toHaveBeenCalledWith([ID], 'cohort_window');

    // While it runs, nothing moves.
    recompute.mockClear();
    const running = setup({
      partners: [inBig],
      cohorts: [
        cohort(DEFAULT_COHORT_ID),
        cohort('ec_big', { ends_on: '2026-11-15' }),
      ],
    });
    const quiet = jest
      .spyOn(running.service, 'recomputeLater')
      .mockImplementation(() => undefined);
    expect((await running.service.current(ID)).cohort._id).toBe('ec_big');
    expect(quiet).not.toHaveBeenCalled();
  });

  it('a recompute moves the partner out of an ended cohort', async () => {
    const { service, assignments } = setup({
      partners: [inBig],
      open: [{ _id: 'o1', agent_id: ID, cohort_id: 'ec_big', from: OLD }],
      held: { [ID]: { open_leads: 12, customers: 0 } },
      cohorts: [cohort(DEFAULT_COHORT_ID), { ...BIG, ends_on: '2026-11-14' }],
    });
    const done = await service.recompute(ID, 'cohort_window');
    expect(done).toMatchObject({ cohort_id: DEFAULT_COHORT_ID, changed: true });
    expect(assignments.switchTo).toHaveBeenCalledWith(
      ID,
      'o1',
      DEFAULT_COHORT_ID,
      expect.any(Date),
      'cohort_window',
    );
  });

  it('the ended cohort’s rules pay nothing: the default’s rules are read', async () => {
    const rule = (id: string, kind: 'coin' | 'gig') => ({
      _id: id,
      name: id,
      trigger: 'lead_created' as const,
      conditions: [],
      reward: { kind, amount: 5 },
      order: 1,
      status: 'active' as const,
      version: 1,
      created_by: HO,
      updated_by: HO,
      archived_by: null,
      archived_at: null,
      created_at: OLD,
      updated_at: OLD,
    });
    const { service: cohorts } = setup({
      partners: [inBig],
      cohorts: [
        cohort(DEFAULT_COHORT_ID, { rules: [rule('r-default', 'gig')] }),
        cohort('ec_big', {
          ends_on: '2026-11-14',
          rules: [rule('r1', 'coin')],
        }),
      ],
    });
    jest.spyOn(cohorts, 'recomputeLater').mockImplementation(() => undefined);
    // The rules come inside the cohort read: the rule repository is never asked.
    const ruleRepo = {};
    const rules = new EarningRulesService(
      ruleRepo as unknown as EarningRuleRepository,
      cohorts,
    );
    expect(await rules.evaluate(ID, 'lead_created', {})).toEqual([
      expect.objectContaining({
        rule_id: 'r-default',
        cohort_id: DEFAULT_COHORT_ID,
      }),
    ]);
  });

  it('a new IST day with a start or end since the last look runs one bulk recompute', async () => {
    const { service, later } = setup({
      cohorts: [
        cohort(DEFAULT_COHORT_ID),
        cohort('ec_big', { ends_on: '2026-11-16' }),
      ],
    });
    // A fresh process cannot know what it slept through: one run, however
    // many reads arrive together.
    await Promise.all([service.all(), service.all(), service.all()]);
    expect(later).toHaveBeenCalledTimes(1);
    expect(later).toHaveBeenCalledWith('cohort_window');

    // Same day: nothing more.
    later.mockClear();
    await service.all();
    expect(later).not.toHaveBeenCalled();

    // 16 Nov: still its last day — nothing crossed.
    jest.setSystemTime(new Date('2026-11-16T06:30:00Z'));
    await service.all();
    expect(later).not.toHaveBeenCalled();

    // 17 Nov: it has ended since the last look.
    jest.setSystemTime(new Date('2026-11-17T06:30:00Z'));
    await service.all();
    await service.all();
    expect(later).toHaveBeenCalledTimes(1);
  });

  it('one process a day runs it: the one whose write moves the shared day', async () => {
    const cohorts = [
      cohort(DEFAULT_COHORT_ID),
      cohort('ec_big', { ends_on: '2026-11-16' }),
    ];
    const window = windowRow();
    const a = setup({ cohorts, window });
    const b = setup({ cohorts, window });
    await Promise.all([a.service.all(), b.service.all()]);
    expect(a.later.mock.calls.length + b.later.mock.calls.length).toBe(1);

    // 17 Nov: B asks first, and runs it from the day A wrote (crossed).
    jest.setSystemTime(new Date('2026-11-17T06:30:00Z'));
    a.later.mockClear();
    b.later.mockClear();
    await b.service.all();
    await a.service.all();
    expect(b.later).toHaveBeenCalledWith('cohort_window');
    expect(a.later).not.toHaveBeenCalled();
    // Each process asks once a day.
    await a.service.all();
    expect(window.claimDay).toHaveBeenCalledTimes(4);
  });

  it('a failed write is asked again on the next read, and fails no read', async () => {
    const window = windowRow();
    window.claimDay.mockRejectedValueOnce(new Error('down'));
    const { service, later } = setup({
      cohorts: [
        cohort(DEFAULT_COHORT_ID),
        cohort('ec_big', { ends_on: '2026-11-16' }),
      ],
      window,
    });
    await expect(service.all()).resolves.toHaveLength(2);
    expect(later).not.toHaveBeenCalled();
    await service.all();
    expect(later).toHaveBeenCalledWith('cohort_window');
  });

  it('cohorts without dates never start a bulk recompute on a new day', async () => {
    const { service, later } = setup();
    await service.all();
    jest.setSystemTime(new Date('2026-11-16T06:30:00Z'));
    await service.all();
    expect(later).not.toHaveBeenCalled();
  });

  it('the hourly look starts with the module and stops with it', async () => {
    const { service, repo, later } = setup({
      cohorts: [
        cohort(DEFAULT_COHORT_ID),
        cohort('ec_big', { starts_on: '2026-11-16' }),
      ],
    });
    await service.all();
    later.mockClear();
    service.onModuleInit();
    repo.all.mockClear();
    // No reads at all across midnight: the timer looks for us.
    jest.setSystemTime(new Date('2026-11-16T06:30:00Z'));
    await jest.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(repo.all).toHaveBeenCalled();
    expect(later).toHaveBeenCalledWith('cohort_window');

    service.onModuleDestroy();
    repo.all.mockClear();
    await jest.advanceTimersByTimeAsync(3 * 60 * 60 * 1000);
    expect(repo.all).not.toHaveBeenCalled();
  });
});

describe('EarningCohortsService — commission switch', () => {
  const M = istMonthKey(new Date());
  const BEFORE = addMonths(M, -1);

  const withSwitch = (commission_off: { from: string; to: string | null }[]) =>
    setup({
      cohorts: [cohort(DEFAULT_COHORT_ID), { ...BIG, commission_off }],
    });

  it('off: a range from this month, the view says so, the commission cache is told', async () => {
    const { service, repo } = withSwitch([]);
    const told = jest.fn();
    service.onCommissionChange(told);
    repo.save.mockResolvedValue(BIG);
    await service.update(
      'ec_big',
      { version: 1, commission_enabled: false },
      HO,
    );
    expect(repo.save).toHaveBeenLastCalledWith(
      'ec_big',
      1,
      { commission_off: [{ from: M, to: null }] },
      HO,
    );
    expect(told).toHaveBeenCalledTimes(1);
  });

  it('on in the same month drops the range; in a later month closes it', async () => {
    const same = withSwitch([{ from: M, to: null }]);
    same.repo.save.mockResolvedValue(BIG);
    await same.service.update(
      'ec_big',
      { version: 2, commission_enabled: true },
      HO,
    );
    expect(same.repo.save).toHaveBeenLastCalledWith(
      'ec_big',
      2,
      { commission_off: [] },
      HO,
    );

    const later = withSwitch([{ from: addMonths(M, -3), to: null }]);
    later.repo.save.mockResolvedValue(BIG);
    await later.service.update(
      'ec_big',
      { version: 2, commission_enabled: true },
      HO,
    );
    expect(later.repo.save).toHaveBeenLastCalledWith(
      'ec_big',
      2,
      { commission_off: [{ from: addMonths(M, -3), to: BEFORE }] },
      HO,
    );
  });

  it('the state it already has writes nothing and answers the cohort', async () => {
    const { service, repo } = withSwitch([{ from: BEFORE, to: null }]);
    const told = jest.fn();
    service.onCommissionChange(told);
    const view = await service.update(
      'ec_big',
      { version: 1, commission_enabled: false },
      HO,
    );
    expect(repo.save).not.toHaveBeenCalled();
    expect(told).not.toHaveBeenCalled();
    expect(view).toMatchObject({
      commission_enabled: false,
      commission_off: [{ from: BEFORE, to: null }],
    });
    // With another field it saves that field only, under the version check.
    expect(
      await codeOf(
        service.update(
          'ec_big',
          { version: 1, name: 'Big', commission_enabled: false },
          HO,
        ),
      ),
    ).toBe('VERSION_CONFLICT');
    expect(repo.save).toHaveBeenLastCalledWith(
      'ec_big',
      1,
      { name: 'Big' },
      HO,
    );
  });

  it('the default cannot be switched off; on is a no-op; archived is refused', async () => {
    const { service, repo } = setup();
    expect(
      await codeOf(
        service.update(
          DEFAULT_COHORT_ID,
          { version: 1, commission_enabled: false },
          HO,
        ),
      ),
    ).toBe('EARNING_COHORT_LOCKED');
    const view = await service.update(
      DEFAULT_COHORT_ID,
      { version: 1, commission_enabled: true },
      HO,
    );
    expect(view.commission_enabled).toBe(true);
    expect(repo.save).not.toHaveBeenCalled();

    const gone = setup({
      cohorts: [
        cohort(DEFAULT_COHORT_ID),
        cohort('ec_big', { status: 'archived', archived_at: OLD }),
      ],
    });
    expect(
      await codeOf(
        gone.service.update(
          'ec_big',
          { version: 1, commission_enabled: false },
          HO,
        ),
      ),
    ).toBe('EARNING_ARCHIVED');
  });

  it('every view says commission_enabled for this month and the ranges', async () => {
    const off = await withSwitch([{ from: M, to: null }]).service.adminGet(
      'ec_big',
    );
    expect(off).toMatchObject({
      commission_enabled: false,
      commission_off: [{ from: M, to: null }],
    });
    // Off only in a past month: on now.
    const past = await withSwitch([
      { from: addMonths(M, -3), to: BEFORE },
    ]).service.adminGet('ec_big');
    expect(past.commission_enabled).toBe(true);
    // A row from before the switch.
    const old = await setup().service.adminGet('ec_big');
    expect(old).toMatchObject({ commission_enabled: true, commission_off: [] });
  });
});
