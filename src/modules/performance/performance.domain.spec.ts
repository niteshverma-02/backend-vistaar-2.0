import {
  healthOf,
  lifecycleOf,
  periodMonths,
  previousMonths,
  shares,
  tierOf,
} from './performance.domain';

describe('periods', () => {
  it('covers this month, the last three, or April to now', () => {
    expect(periodMonths('month', '2026-10')).toEqual(['2026-10']);
    expect(periodMonths('3m', '2026-01')).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
    ]);
    expect(periodMonths('fy', '2026-06')).toEqual([
      '2026-04',
      '2026-05',
      '2026-06',
    ]);
    expect(periodMonths('fy', '2027-02')).toHaveLength(11);
  });

  it('compares with the same number of months just before, never for a FY', () => {
    expect(previousMonths('3m', ['2026-08', '2026-09', '2026-10'])).toEqual([
      '2026-05',
      '2026-06',
      '2026-07',
    ]);
    expect(previousMonths('fy', ['2026-04'])).toBeNull();
  });
});

describe('tierOf', () => {
  it('places a 3-month average and the way to the next tier', () => {
    expect(tierOf(62_000)).toEqual({
      current: 'silver',
      next: 'gold',
      avg_3m_sales: 62_000,
      current_min: 50_000,
      next_min: 100_000,
      progress_pct: 24,
    });
    expect(tierOf(0).current).toBe('bronze');
    expect(tierOf(3_00_000)).toMatchObject({
      current: 'platinum',
      next: null,
      progress_pct: 100,
    });
  });
});

describe('lifecycleOf', () => {
  it('reads days since the last order', () => {
    expect(lifecycleOf(null)).toBe('onboarded');
    expect(lifecycleOf(29)).toBe('active');
    expect(lifecycleOf(30)).toBe('at_risk');
    expect(lifecycleOf(90)).toBe('lost');
  });
});

describe('healthOf', () => {
  it('scores 20 per good factor', () => {
    const h = healthOf({
      days_since_last_order: 3,
      orders_this_month: 5,
      training: { done: 2, total: 4 },
      field_days: 6,
      overdue_follow_ups: 1,
    });
    expect(h.score).toBe(80);
    expect(h.factors.map((f) => [f.key, f.good])).toEqual([
      ['days_since_last_order', true],
      ['orders_this_month', true],
      ['training_completed', true],
      ['field_days_logged', true],
      ['overdue_follow_ups', false],
    ]);
  });

  it('counts no order yet as not good, and no open course as good', () => {
    const h = healthOf({
      days_since_last_order: null,
      orders_this_month: 0,
      training: { done: 0, total: 0 },
      field_days: 0,
      overdue_follow_ups: 0,
    });
    expect(h.score).toBe(40);
  });
});

describe('shares', () => {
  it('rounds values and shares, largest first', () => {
    expect(
      shares(
        new Map([
          ['Fungicide', 30.4],
          ['Insecticides', 69.6],
        ]),
      ),
    ).toEqual([
      { name: 'Insecticides', value: 70, pct: 70 },
      { name: 'Fungicide', value: 30, pct: 30 },
    ]);
  });
});
