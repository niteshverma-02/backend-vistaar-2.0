import {
  COHORT_FIELD_CATALOG,
  DEFAULT_COHORT_ID,
  NO_FILTERS,
  checkCondition,
  checkConditionIn,
  cohortAtIn,
  cohortIdOf,
  conditionsToFilters,
  describeCohortConditions,
  describeConditions,
  filtersToConditions,
  matchesCondition,
  matchesConditions,
  normalizeFilters,
  orderError,
  pickCohort,
  pickRewards,
  withSuffix,
  type CohortLike,
  type EarningFilters,
  type PartnerFacts,
  type RuleCondition,
  type RuleLike,
} from './earning.domain';

const partner = (extra: Partial<PartnerFacts> = {}): PartnerFacts => ({
  state: 'MADHYA PRADESH',
  district: 'Bhopal',
  pincode: '462026',
  open_leads: 0,
  customers: 0,
  ...extra,
});

const filters = (extra: Partial<EarningFilters>): EarningFilters => ({
  ...NO_FILTERS,
  ...extra,
});

const cohort = (
  id: string,
  priority: number,
  f: Partial<EarningFilters>,
  status: CohortLike['status'] = 'active',
): CohortLike => ({ _id: id, priority, status, filters: filters(f) });

const DEFAULT = cohort(DEFAULT_COHORT_ID, 0, {});

const over = (
  conditions: RuleCondition[],
  p: PartnerFacts = partner(),
): boolean => matchesConditions(conditions, { ...p });

describe('matchesConditions over partner facts', () => {
  it('takes any value inside one list condition (OR)', () => {
    const c: RuleCondition[] = [
      {
        field: 'state',
        op: 'any_of',
        value: ['CHHATTISGARH', 'MADHYA PRADESH'],
      },
    ];
    expect(over(c)).toBe(true);
    expect(over(c, partner({ state: 'GUJARAT' }))).toBe(false);
  });

  it('needs every condition (AND); an empty list takes everyone', () => {
    const c: RuleCondition[] = [
      { field: 'state', op: 'any_of', value: ['MADHYA PRADESH'] },
      { field: 'open_leads', op: 'gte', value: 10 },
    ];
    expect(over(c, partner({ open_leads: 9 }))).toBe(false);
    expect(over(c, partner({ open_leads: 10 }))).toBe(true);
    expect(over([], partner({ state: null }))).toBe(true);
  });

  it('matches eq, any_of, gte and lte over the facts', () => {
    expect(over([{ field: 'district', op: 'eq', value: 'BHOPAL' }])).toBe(true);
    expect(
      over(
        [{ field: 'pincode', op: 'any_of', value: ['462026', '462027'] }],
        partner(),
      ),
    ).toBe(true);
    expect(over([{ field: 'customers', op: 'lte', value: 1 }])).toBe(true);
    expect(
      over(
        [{ field: 'customers', op: 'lte', value: 1 }],
        partner({ customers: 2 }),
      ),
    ).toBe(false);
  });

  it('compares districts without case or extra spaces; pincodes exactly', () => {
    expect(
      over([{ field: 'district', op: 'any_of', value: [' bhopal '] }]),
    ).toBe(true);
    expect(over([{ field: 'pincode', op: 'any_of', value: ['462027'] }])).toBe(
      false,
    );
  });

  it('never matches a place condition when the profile has no such place', () => {
    expect(
      over(
        [{ field: 'state', op: 'any_of', value: ['MADHYA PRADESH'] }],
        partner({ state: null }),
      ),
    ).toBe(false);
    expect(
      over(
        [{ field: 'pincode', op: 'eq', value: '462026' }],
        partner({ pincode: null }),
      ),
    ).toBe(false);
  });
});

describe('filters ⇄ conditions', () => {
  it('converts every legacy filter to the condition it means', () => {
    expect(
      filtersToConditions({
        states: ['madhya pradesh'],
        districts: ['Bhopal'],
        pincodes: ['462026'],
        min_leads: 10,
        min_customers: 2,
      }),
    ).toEqual([
      { field: 'state', op: 'any_of', value: ['MADHYA PRADESH'] },
      { field: 'district', op: 'any_of', value: ['Bhopal'] },
      { field: 'pincode', op: 'any_of', value: ['462026'] },
      { field: 'open_leads', op: 'gte', value: 10 },
      { field: 'customers', op: 'gte', value: 2 },
    ]);
    expect(filtersToConditions({ min_leads: 0 })).toEqual([]);
    expect(filtersToConditions(null)).toEqual([]);
  });

  it('derives the legacy view back, dropping what the old shape cannot say', () => {
    expect(
      conditionsToFilters([
        { field: 'state', op: 'eq', value: 'MADHYA PRADESH' },
        { field: 'pincode', op: 'any_of', value: ['462026'] },
        { field: 'open_leads', op: 'gte', value: 10 },
        { field: 'open_leads', op: 'lte', value: 50 }, // not representable
        { field: 'customers', op: 'lte', value: 3 }, // not representable
      ]),
    ).toEqual({
      ...NO_FILTERS,
      states: ['MADHYA PRADESH'],
      pincodes: ['462026'],
      min_leads: 10,
    });
  });

  it('round-trips a legacy cohort unchanged', () => {
    const f = filters({ districts: ['Bhopal', 'Sehore'], min_customers: 5 });
    expect(conditionsToFilters(filtersToConditions(f))).toEqual(f);
  });
});

describe('checkConditionIn — the cohort catalog', () => {
  const check = (c: { field: string; op: string; value: unknown }) =>
    checkConditionIn(COHORT_FIELD_CATALOG, 'a cohort', c);

  it('refuses an unknown field, a wrong operator and a wrong value type', () => {
    expect(check({ field: 'crops', op: 'eq', value: 'x' })).toHaveProperty(
      'error',
    );
    expect(check({ field: 'state', op: 'in', value: ['MP'] })).toHaveProperty(
      'error',
    );
    expect(check({ field: 'open_leads', op: 'eq', value: 5 })).toHaveProperty(
      'error',
    );
    expect(
      check({ field: 'open_leads', op: 'gte', value: '5' }),
    ).toHaveProperty('error');
    expect(
      check({ field: 'district', op: 'any_of', value: [] }),
    ).toHaveProperty('error');
  });

  it('keeps states upper case and refuses a pincode that is not 6 digits', () => {
    expect(
      check({ field: 'state', op: 'any_of', value: ['madhya pradesh'] }),
    ).toEqual({
      ok: { field: 'state', op: 'any_of', value: ['MADHYA PRADESH'] },
    });
    expect(
      check({ field: 'pincode', op: 'any_of', value: ['462026', '46'] }),
    ).toHaveProperty('error');
    expect(
      check({ field: 'pincode', op: 'eq', value: '046202' }),
    ).toHaveProperty('error');
  });
});

describe('describeCohortConditions', () => {
  it('reads like a sentence and shortens a long list', () => {
    expect(describeCohortConditions([])).toBe('Every partner');
    expect(
      describeCohortConditions([
        { field: 'state', op: 'any_of', value: ['MADHYA PRADESH'] },
        { field: 'open_leads', op: 'gte', value: 10 },
      ]),
    ).toBe('State has any of MADHYA PRADESH · Open leads at least 10');
    const many = Array.from({ length: 12 }, (_, i) => `46202${i}`);
    expect(
      describeCohortConditions([
        { field: 'pincode', op: 'any_of', value: many },
      ]),
    ).toContain('+4 more');
  });
});

describe('pickCohort', () => {
  const mp = cohort('ec_mp', 2, { states: ['MADHYA PRADESH'] });
  const big = cohort('ec_big', 1, { min_leads: 10 });

  it('takes the first match in priority order', () => {
    const cohorts = [DEFAULT, mp, big];
    expect(pickCohort(cohorts, partner({ open_leads: 12 }))).toBe('ec_big');
    expect(pickCohort(cohorts, partner({ open_leads: 3 }))).toBe('ec_mp');
  });

  it('falls back to the default, which is always last whatever its priority', () => {
    expect(pickCohort([DEFAULT, mp], partner({ state: 'GUJARAT' }))).toBe(
      DEFAULT_COHORT_ID,
    );
    expect(pickCohort([], partner())).toBe(DEFAULT_COHORT_ID);
  });

  it('skips archived cohorts', () => {
    const archived = cohort(
      'ec_old',
      1,
      { states: ['MADHYA PRADESH'] },
      'archived',
    );
    expect(pickCohort([DEFAULT, archived], partner())).toBe(DEFAULT_COHORT_ID);
  });

  it('breaks a priority tie by id, so every process agrees', () => {
    const a = cohort('ec_a', 1, { states: ['MADHYA PRADESH'] });
    const b = cohort('ec_b', 1, { states: ['MADHYA PRADESH'] });
    expect(pickCohort([b, a, DEFAULT], partner())).toBe('ec_a');
  });

  it('reads conditions when a cohort has them, legacy filters when not', () => {
    const conditioned: CohortLike = {
      _id: 'ec_small',
      priority: 1,
      status: 'active',
      conditions: [{ field: 'open_leads', op: 'lte', value: 3 }],
      filters: null,
    };
    const legacy = cohort('ec_mp_old', 2, { states: ['MADHYA PRADESH'] });
    const cohorts = [DEFAULT, conditioned, legacy];
    expect(pickCohort(cohorts, partner({ open_leads: 2 }))).toBe('ec_small');
    expect(pickCohort(cohorts, partner({ open_leads: 9 }))).toBe('ec_mp_old');
  });
});

describe('normalizeFilters', () => {
  it('keeps states upper case, drops repeats and blanks, and 0 as unused', () => {
    expect(
      normalizeFilters({
        states: ['madhya  pradesh', 'MADHYA PRADESH', ' '],
        districts: ['Bhopal', 'bhopal'],
        pincodes: ['462026 ', '462026'],
        min_leads: 0,
        min_customers: null,
      }),
    ).toEqual({
      states: ['MADHYA PRADESH'],
      districts: ['Bhopal'],
      pincodes: ['462026'],
      min_leads: null,
      min_customers: null,
    });
  });
});

describe('cohort ids', () => {
  it('slugs a name, and suffixes it within 40 letters', () => {
    expect(cohortIdOf('Paddy belt, 10+ leads')).toBe('ec_paddy_belt_10_leads');
    expect(cohortIdOf('ec_bhopal')).toBe('ec_bhopal');
    expect(cohortIdOf('धान')).toBeNull();
    expect(withSuffix('ec_paddy', 1)).toBe('ec_paddy');
    expect(withSuffix('ec_paddy', 2)).toBe('ec_paddy_2');
    const long = withSuffix(`ec_${'a'.repeat(40)}`, 12);
    expect(long).toMatch(/^ec_[a-z0-9_]{1,40}$/);
    expect(long.endsWith('_12')).toBe(true);
  });
});

describe('orderError', () => {
  it('wants every current id once', () => {
    expect(orderError(['b', 'a'], ['a', 'b'])).toBeNull();
    expect(orderError(['a', 'a'], ['a', 'b'])).toMatch(/twice/);
    expect(orderError(['a'], ['a', 'b'])).toMatch(/changed/);
    expect(orderError(['a', 'c'], ['a', 'b'])).toMatch(/changed/);
  });
});

describe('cohortAtIn', () => {
  const rows = [
    { cohort_id: 'ec_default', from: new Date('2026-10-01T00:00:00Z') },
    { cohort_id: 'ec_big', from: new Date('2026-10-10T00:00:00Z') },
  ];
  it('answers the stretch that began last by then; null before the first', () => {
    expect(cohortAtIn(rows, new Date('2026-09-30T00:00:00Z'))).toBeNull();
    expect(cohortAtIn(rows, new Date('2026-10-05T00:00:00Z'))).toBe(
      'ec_default',
    );
    expect(cohortAtIn(rows, new Date('2026-10-10T00:00:00Z'))).toBe('ec_big');
  });
});

describe('checkCondition', () => {
  it('refuses a field the trigger does not have, or an operator its type does not take', () => {
    expect(
      checkCondition('lead_created', {
        field: 'days_overdue',
        op: 'gte',
        value: 1,
      }),
    ).toHaveProperty('error');
    expect(
      checkCondition('lead_created', {
        field: 'acreage',
        op: 'any_of',
        value: [1],
      }),
    ).toHaveProperty('error');
    expect(
      checkCondition('lead_created', {
        field: 'crops',
        op: 'eq',
        value: 'Wheat',
      }),
    ).toHaveProperty('error');
  });

  it('refuses a value of the wrong type or outside an enum', () => {
    expect(
      checkCondition('lead_created', {
        field: 'acreage',
        op: 'gte',
        value: '2',
      }),
    ).toHaveProperty('error');
    expect(
      checkCondition('follow_up_done', {
        field: 'activity_type',
        op: 'in',
        value: ['call', 'note'],
      }),
    ).toHaveProperty('error');
    expect(
      checkCondition('lead_created', {
        field: 'crops',
        op: 'any_of',
        value: [],
      }),
    ).toHaveProperty('error');
  });

  it('keeps states upper case and drops repeated values', () => {
    expect(
      checkCondition('lead_created', {
        field: 'farmer_state',
        op: 'in',
        value: ['madhya pradesh', 'MADHYA PRADESH'],
      }),
    ).toEqual({
      ok: { field: 'farmer_state', op: 'in', value: ['MADHYA PRADESH'] },
    });
    expect(
      checkCondition('follow_up_done', {
        field: 'activity_type',
        op: 'eq',
        value: 'visit',
      }),
    ).toEqual({ ok: { field: 'activity_type', op: 'eq', value: 'visit' } });
  });
});

describe('matchesCondition', () => {
  const facts = {
    crops: ['Wheat', 'Soybean'],
    acreage: 3,
    farmer_district: 'Bhopal',
    farmer_state: null,
  };
  it('matches lists and words without case; numbers by bound', () => {
    expect(
      matchesCondition(
        { field: 'crops', op: 'any_of', value: ['wheat'] },
        facts,
      ),
    ).toBe(true);
    expect(
      matchesCondition(
        { field: 'crops', op: 'any_of', value: ['Paddy'] },
        facts,
      ),
    ).toBe(false);
    expect(
      matchesCondition(
        { field: 'farmer_district', op: 'eq', value: 'BHOPAL' },
        facts,
      ),
    ).toBe(true);
    expect(
      matchesCondition({ field: 'acreage', op: 'gte', value: 3 }, facts),
    ).toBe(true);
    expect(
      matchesCondition({ field: 'acreage', op: 'lte', value: 2 }, facts),
    ).toBe(false);
  });

  it('never matches a fact the event does not carry', () => {
    expect(
      matchesCondition(
        { field: 'farmer_state', op: 'in', value: ['MADHYA PRADESH'] },
        facts,
      ),
    ).toBe(false);
  });
});

describe('pickRewards', () => {
  const rule = (
    id: string,
    order: number,
    kind: 'coin' | 'gig',
    extra: Partial<RuleLike> = {},
  ): RuleLike => ({
    _id: id,
    trigger: 'lead_created',
    conditions: [],
    reward: { kind, amount: 10 },
    order,
    status: 'active',
    ...extra,
  });
  const big = [{ field: 'acreage', op: 'gte' as const, value: 5 }];

  it('pays the first matching rule per kind, in HO order', () => {
    const rules = [
      rule('coin-any', 2, 'coin'),
      rule('coin-big', 1, 'coin', { conditions: big }),
      rule('gig-any', 3, 'gig'),
    ];
    expect(
      pickRewards(rules, 'lead_created', { acreage: 6 }).map((r) => r._id),
    ).toEqual(['coin-big', 'gig-any']);
    expect(
      pickRewards(rules, 'lead_created', { acreage: 1 }).map((r) => r._id),
    ).toEqual(['coin-any', 'gig-any']);
  });

  it('skips archived rules and other triggers', () => {
    const rules = [
      rule('old', 1, 'coin', { status: 'archived' }),
      rule('other', 2, 'coin', { trigger: 'follow_up_done' }),
    ];
    expect(pickRewards(rules, 'lead_created', {})).toEqual([]);
  });
});

describe('describeConditions', () => {
  it('reads like a sentence', () => {
    expect(describeConditions('lead_created', [])).toBe('Every time');
    expect(
      describeConditions('lead_created', [
        { field: 'crops', op: 'any_of', value: ['Wheat', 'Soybean'] },
        { field: 'acreage', op: 'gte', value: 2 },
      ]),
    ).toBe('Crops has any of Wheat, Soybean · Acreage at least 2');
  });
});
