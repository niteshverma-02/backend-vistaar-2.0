import { periodOf, previousOf } from './overview.domain';

describe('periodOf', () => {
  it('is this IST month so far when nothing is sent', () => {
    expect(periodOf(undefined, undefined, '2026-10-23')).toEqual({
      from: '2026-10-01',
      to: '2026-10-23',
    });
  });

  it("starts at the 1st of `to`'s month, or ends today, when one side is sent", () => {
    expect(periodOf(undefined, '2026-09-30', '2026-10-23')).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
    });
    expect(periodOf('2026-08-15', undefined, '2026-10-23')).toEqual({
      from: '2026-08-15',
      to: '2026-10-23',
    });
  });

  it('shows a day past the month’s end as the day it is counted as', () => {
    expect(periodOf('2026-02-31', '2026-03-10', '2026-10-23')).toEqual({
      from: '2026-03-03',
      to: '2026-03-10',
    });
  });
});

describe('previousOf', () => {
  it('is the same number of days just before, as the portal compares', () => {
    // 23 days → the 23 days ending on 30 Sep.
    expect(previousOf({ from: '2026-10-01', to: '2026-10-23' })).toEqual({
      from: '2026-09-08',
      to: '2026-09-30',
    });
    expect(previousOf({ from: '2026-10-23', to: '2026-10-23' })).toEqual({
      from: '2026-10-22',
      to: '2026-10-22',
    });
    // Across a leap day, and across a year's end.
    expect(previousOf({ from: '2028-03-01', to: '2028-03-31' })).toEqual({
      from: '2028-01-30',
      to: '2028-02-29',
    });
    expect(previousOf({ from: '2027-01-01', to: '2027-01-10' })).toEqual({
      from: '2026-12-22',
      to: '2026-12-31',
    });
  });
});
