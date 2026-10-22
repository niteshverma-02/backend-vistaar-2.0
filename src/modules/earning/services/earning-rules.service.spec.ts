import type { HttpException } from '@nestjs/common';

import {
  CreateEarningRuleDto,
  type EarningRulesQueryDto,
} from '../dto/earning-rule.dto';
import { MAX_RULES_PER_COHORT, NO_FILTERS } from '../earning.domain';
import type {
  EarningRuleRecord,
  EarningRuleRepository,
} from '../repositories/earning-rule.repository';
import type { EarningCohortsService } from './earning-cohorts.service';
import { EarningRulesService } from './earning-rules.service';

const HO = 'ho@katyayaniorganics.com';

const rule = (
  id: string,
  extra: Partial<EarningRuleRecord> = {},
): EarningRuleRecord => ({
  _id: id,
  cohort_id: 'ec_big',
  name: id,
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
  created_at: new Date(),
  updated_at: new Date(),
  ...extra,
});

function setup(rules: EarningRuleRecord[] = [], status = 'active') {
  const repo = {
    list: jest.fn().mockResolvedValue(rules),
    find: jest.fn().mockResolvedValue(rules[0] ?? null),
    add: jest.fn(
      (
        cohortId: string,
        r: EarningRuleRecord,
      ): Promise<EarningRuleRecord | null> =>
        Promise.resolve({ ...r, cohort_id: cohortId }),
    ),
    save: jest.fn().mockResolvedValue(null),
    archive: jest.fn().mockResolvedValue(null),
    setOrder: jest.fn().mockResolvedValue(undefined),
  };
  const big = {
    _id: 'ec_big',
    name: 'Big books',
    status,
    filters: NO_FILTERS,
    // The cohort read brings its rules: an event reads nothing else.
    rules,
  };
  const cohorts = {
    current: jest.fn().mockResolvedValue({ cohort: big, since: new Date() }),
    get: jest.fn().mockResolvedValue(big),
  };
  const service = new EarningRulesService(
    repo as unknown as EarningRuleRepository,
    cohorts as unknown as EarningCohortsService,
  );
  return { service, repo, cohorts };
}

async function errorOf(
  promise: Promise<unknown>,
): Promise<{ error: string; details?: string[] }> {
  try {
    await promise;
  } catch (error) {
    return (error as HttpException).getResponse() as {
      error: string;
      details?: string[];
    };
  }
  return { error: 'no error' };
}

describe('EarningRulesService.evaluate', () => {
  it('pays from the partner’s current cohort, at most one rule per kind', async () => {
    const { service, repo } = setup([
      rule('coin-wheat', {
        order: 1,
        conditions: [{ field: 'crops', op: 'any_of', value: ['Wheat'] }],
        reward: { kind: 'coin', amount: 20 },
      }),
      rule('coin-any', { order: 2 }),
      rule('gig-any', { order: 3, reward: { kind: 'gig', amount: 50 } }),
    ]);
    const earned = await service.evaluate('VST-000001', 'lead_created', {
      crops: ['wheat'],
    });

    expect(repo.list).not.toHaveBeenCalled();
    expect(repo.find).not.toHaveBeenCalled();
    expect(earned).toEqual([
      {
        rule_id: 'coin-wheat',
        rule_name: 'coin-wheat',
        cohort_id: 'ec_big',
        kind: 'coin',
        amount: 20,
      },
      {
        rule_id: 'gig-any',
        rule_name: 'gig-any',
        cohort_id: 'ec_big',
        kind: 'gig',
        amount: 50,
      },
    ]);
  });

  it('skips a switched-off rule, so the next matching one of its kind pays', async () => {
    const { service } = setup([
      rule('coin-bonus', { order: 1, enabled: false }),
      rule('coin-any', { order: 2, reward: { kind: 'coin', amount: 2 } }),
    ]);
    const earned = await service.evaluate('VST-000001', 'lead_created', {});
    expect(earned.map((e) => [e.rule_id, e.amount])).toEqual([['coin-any', 2]]);
  });

  it('the app’s "how to earn" leaves out switched-off rules', async () => {
    const { service } = setup([
      rule('on', { order: 1, enabled: true }),
      rule('off', { order: 2, enabled: false }),
      rule('from-before', { order: 3 }),
    ]);
    const app = await service.appCohort('VST-000001');
    expect(app.rules.map((r) => r.name)).toEqual(['on', 'from-before']);
  });

  it('pays nothing to a partner not placed yet (not approved)', async () => {
    const { service, repo, cohorts } = setup([rule('coin-any')]);
    cohorts.current.mockResolvedValue({
      cohort: { _id: 'ec_default', name: 'Everyone else' },
      since: null,
    });
    expect(await service.evaluate('VST-000001', 'lead_created', {})).toEqual(
      [],
    );
    expect(repo.list).not.toHaveBeenCalled();
  });

  it('never pays an archived rule or another trigger’s, and orders by HO order then id', async () => {
    const { service } = setup([
      rule('coin-archived', {
        order: 1,
        status: 'archived',
        reward: { kind: 'coin', amount: 99 },
      }),
      rule('coin-follow-up', { order: 1, trigger: 'follow_up_done' }),
      rule('coin-b', { order: 2 }),
      rule('coin-a', { order: 2 }),
    ]);
    const earned = await service.evaluate('VST-000001', 'lead_created', {});
    expect(earned.map((e) => e.rule_id)).toEqual(['coin-a']);
  });
});

describe('EarningRulesService.appCohort', () => {
  it('shows the cohort’s active rules only, in HO order', async () => {
    const { service } = setup([
      rule('second', { order: 2 }),
      rule('gone', { order: 1, status: 'archived' }),
      rule('first', { order: 1, trigger: 'follow_up_done' }),
    ]);
    const app = await service.appCohort('VST-000001');
    expect(app.rules.map((r) => r.name)).toEqual(['first', 'second']);
  });
});

describe('EarningRulesService — HO', () => {
  const dto = (extra: Partial<CreateEarningRuleDto> = {}) =>
    Object.assign(new CreateEarningRuleDto(), {
      cohort_id: 'ec_big',
      name: 'Paddy, 2+ acres',
      trigger: 'lead_created',
      conditions: [{ field: 'acreage', op: 'gte', value: 2 }],
      reward: { kind: 'coin', amount: 10 },
      ...extra,
    });

  it('checks conditions against the catalog and lists every problem', async () => {
    const { service, repo } = setup();
    const out = await errorOf(
      service.create(
        dto({
          conditions: [
            { field: 'colour', op: 'eq', value: 'red' },
            { field: 'acreage', op: 'in', value: ['2'] },
          ],
        }),
        HO,
      ),
    );
    expect(out.error).toBe('VALIDATION_FAILED');
    expect(out.details).toHaveLength(2);
    expect(repo.add).not.toHaveBeenCalled();
  });

  it('adds a valid rule after the last active one in its cohort', async () => {
    const { service, repo } = setup([
      rule('a', { order: 3 }),
      rule('gone', { order: 9, status: 'archived' }),
    ]);
    const saved = await service.create(dto(), HO);
    expect(repo.add).toHaveBeenCalledWith(
      'ec_big',
      expect.objectContaining({ order: 4, status: 'active', version: 1 }),
    );
    expect(saved).toMatchObject({
      cohort_id: 'ec_big',
      summary: 'Acreage at least 2',
    });
  });

  it('adds no rule to a full cohort, archived rules counted', async () => {
    const { service, repo } = setup(
      Array.from({ length: MAX_RULES_PER_COHORT }, (_, i) =>
        rule(`r${i}`, { status: 'archived' }),
      ),
    );
    expect((await errorOf(service.create(dto(), HO))).error).toBe(
      'VALIDATION_FAILED',
    );
    expect(repo.add).not.toHaveBeenCalled();
  });

  it('answers EARNING_ARCHIVED when the cohort was archived between the read and the write', async () => {
    const { service, repo, cohorts } = setup();
    repo.add.mockResolvedValueOnce(null);
    cohorts.get
      .mockResolvedValueOnce({ _id: 'ec_big', status: 'active', rules: [] })
      .mockResolvedValueOnce({ _id: 'ec_big', status: 'archived', rules: [] });
    expect((await errorOf(service.create(dto(), HO))).error).toBe(
      'EARNING_ARCHIVED',
    );
  });

  it('a new rule is on unless HO sends `enabled: false`', async () => {
    const { service, repo } = setup();
    expect((await service.create(dto(), HO)).enabled).toBe(true);
    expect(repo.add).toHaveBeenLastCalledWith(
      'ec_big',
      expect.objectContaining({ enabled: true }),
    );
    expect((await service.create(dto({ enabled: false }), HO)).enabled).toBe(
      false,
    );
    expect(repo.add).toHaveBeenLastCalledWith(
      'ec_big',
      expect.objectContaining({ enabled: false }),
    );
  });

  it('`{ version, enabled }` alone switches a rule, under the version check', async () => {
    const { service, repo } = setup([rule('r1')]);
    repo.save.mockResolvedValue(rule('r1', { enabled: false, version: 2 }));
    const off = await service.update('r1', { version: 1, enabled: false }, HO);
    expect(repo.save).toHaveBeenLastCalledWith('r1', 1, { enabled: false }, HO);
    expect(off).toMatchObject({ enabled: false, version: 2 });

    repo.save.mockResolvedValue(null);
    expect(
      (await errorOf(service.update('r1', { version: 1, enabled: true }, HO)))
        .error,
    ).toBe('VERSION_CONFLICT');

    const gone = setup([rule('r1', { status: 'archived' })]);
    expect(
      (
        await errorOf(
          gone.service.update('r1', { version: 1, enabled: true }, HO),
        )
      ).error,
    ).toBe('EARNING_ARCHIVED');
    expect(gone.repo.save).not.toHaveBeenCalled();
  });

  it('every view says `enabled`; a rule from before the switch reads on', async () => {
    const old = rule('r1');
    expect(old).not.toHaveProperty('enabled');
    const { service, repo } = setup([old, rule('r2', { enabled: false })]);
    expect((await service.get('r1')).enabled).toBe(true);
    const page = await service.list({
      skip: 0,
      limit: 50,
      enabled: false,
    } as EarningRulesQueryDto);
    expect(page.items.map((r) => [r.id, r.enabled])).toEqual([
      ['r1', true],
      ['r2', false],
    ]);
    expect(repo.list).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false, status: 'active' }),
    );
  });

  it('adds no rule to an archived cohort', async () => {
    const { service } = setup([], 'archived');
    expect((await errorOf(service.create(dto(), HO))).error).toBe(
      'EARNING_ARCHIVED',
    );
  });

  it('answers VERSION_CONFLICT for a stale edit and EARNING_ARCHIVED for an archived rule', async () => {
    const live = setup([rule('r1')]);
    expect(
      (await errorOf(live.service.update('r1', { version: 1, name: 'x' }, HO)))
        .error,
    ).toBe('VERSION_CONFLICT');
    // The rule's own version is the guard — never the cohort's.
    expect(live.repo.save).toHaveBeenCalledWith('r1', 1, { name: 'x' }, HO);
    const gone = setup([rule('r1', { status: 'archived' })]);
    expect(
      (await errorOf(gone.service.update('r1', { version: 1, name: 'x' }, HO)))
        .error,
    ).toBe('EARNING_ARCHIVED');
  });
});

describe('EarningRulesService.reorder', () => {
  const rules = [
    rule('a', { order: 1 }),
    rule('b', { order: 2 }),
    rule('gone', { order: 3, status: 'archived' }),
  ];

  it('takes every active rule of the cohort once, archived ones left out', async () => {
    const { service, repo } = setup(rules);
    expect(
      await service.reorder({ cohort_id: 'ec_big', ids: ['b', 'a'] }, HO),
    ).toEqual({ cohort_id: 'ec_big', ids: ['b', 'a'] });
    expect(repo.setOrder).toHaveBeenCalledWith('ec_big', ['b', 'a'], HO);
  });

  it('answers EARNING_ORDER_CHANGED for a stale list', async () => {
    const { service, repo } = setup(rules);
    expect(
      (
        await errorOf(
          service.reorder({ cohort_id: 'ec_big', ids: ['a', 'gone', 'b'] }, HO),
        )
      ).error,
    ).toBe('EARNING_ORDER_CHANGED');
    expect(repo.setOrder).not.toHaveBeenCalled();
  });
});
