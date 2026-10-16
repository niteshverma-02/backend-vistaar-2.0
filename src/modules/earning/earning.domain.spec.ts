import {
  DEFAULT_COHORT_ID,
  NO_FILTERS,
  checkCondition,
  cohortAtIn,
  cohortIdOf,
  describeConditions,
  matchesCondition,
  matchesFilters,
  normalizeFilters,
  orderError,
  pickCohort,
  pickRewards,
  withSuffix,
  type CohortLike,
  type EarningFilters,
  type PartnerFacts,
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

describe('matchesFilters', () => {
  it('takes any value inside one filter (OR)', () => {
    const f = filters({ states: ['CHHATTISGARH', 'MADHYA PRADESH'] });
    expect(matchesFilters(f, partner())).toBe(true);
    expect(matchesFilters(f, partner({ state: 'GUJARAT' }))).toBe(false);
  });

  it('needs every used filter (AND); an empty one is not used', () => {
    const f = filters({ states: ['MADHYA PRADESH'], min_leads: 10 });
    expect(matchesFilters(f, partner({ open_leads: 9 }))).toBe(false);
    expect(matchesFilters(f, partner({ open_leads: 10 }))).toBe(true);
    expect(
      matchesFilters(filters({ min_customers: 2 }), partner({ customers: 2 })),
    ).toBe(true);
  });

  it('compares districts without case or extra spaces; pincodes exactly', () => {
    expect(
      matchesFilters(filters({ districts: [' bhopal '] }), partner()),
    ).toBe(true);
    expect(matchesFilters(filters({ pincodes: ['462026'] }), partner())).toBe(
      true,
    );
    expect(matchesFilters(filters({ pincodes: ['462027'] }), partner())).toBe(
      false,
    );
  });

  it('never matches a place filter when the profile has no such place', () => {
    expect(
      matchesFilters(
        filters({ states: ['MADHYA PRADESH'] }),
        partner({ state: null }),
      ),
    ).toBe(false);
    expect(
      matchesFilters(
        filters({ pincodes: ['462026'] }),
        partner({ pincode: null }),
      ),
    ).toBe(false);
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
