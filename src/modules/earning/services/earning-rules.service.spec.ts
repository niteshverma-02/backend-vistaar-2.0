import type { HttpException } from '@nestjs/common';

import {
  CreateEarningRuleDto,
  type EarningRulesQueryDto,
} from '../dto/earning-rule.dto';
import { NO_FILTERS } from '../earning.domain';
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
    active: jest.fn().mockResolvedValue(rules),
    find: jest.fn().mockResolvedValue(rules[0] ?? null),
    maxOrder: jest.fn().mockResolvedValue(3),
    create: jest.fn((r: EarningRuleRecord) => Promise.resolve(r)),
    save: jest.fn().mockResolvedValue(null),
    archive: jest.fn().mockResolvedValue(null),
  };
  const big = {
    _id: 'ec_big',
    name: 'Big books',
    status,
    filters: NO_FILTERS,
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

    expect(repo.active).toHaveBeenCalledWith('ec_big', 'lead_created');
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
    expect(repo.active).not.toHaveBeenCalled();
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
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('adds a valid rule last in its cohort', async () => {
    const { service, repo } = setup();
    const saved = await service.create(dto(), HO);
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ order: 4, status: 'active', version: 1 }),
    );
    expect(saved.summary).toBe('Acreage at least 2');
  });

  it('a new rule is on unless HO sends `enabled: false`', async () => {
    const { service, repo } = setup();
    expect((await service.create(dto(), HO)).enabled).toBe(true);
    expect(repo.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: true }),
    );
    expect((await service.create(dto({ enabled: false }), HO)).enabled).toBe(
      false,
    );
    expect(repo.create).toHaveBeenLastCalledWith(
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
    const gone = setup([rule('r1', { status: 'archived' })]);
    expect(
      (await errorOf(gone.service.update('r1', { version: 1, name: 'x' }, HO)))
        .error,
    ).toBe('EARNING_ARCHIVED');
  });
});
