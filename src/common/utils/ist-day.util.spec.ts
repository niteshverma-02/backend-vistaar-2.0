import {
  addMonths,
  fyStart,
  istDayStart,
  istDaysBetween,
  istMonthKey,
  istMonthStart,
} from './ist-day.util';

describe('IST days', () => {
  it('starts the day at midnight IST, not UTC', () => {
    // 2026-10-14 01:00 IST is still 2026-10-13 in UTC.
    expect(istDayStart(new Date('2026-10-13T19:30:00Z')).toISOString()).toBe(
      '2026-10-13T18:30:00.000Z',
    );
  });

  it('counts calendar days, whatever the hour', () => {
    const late = new Date('2026-10-13T18:00:00Z'); // 23:30 IST, 13th
    const early = new Date('2026-10-13T19:00:00Z'); // 00:30 IST, 14th
    expect(istDaysBetween(late, early)).toBe(1);
    expect(istDaysBetween(early, late)).toBe(-1);
    expect(istDaysBetween(early, early)).toBe(0);
  });
});

describe('IST months', () => {
  it('keys a moment by its IST month', () => {
    // 2026-09-30 19:00 UTC is already 1 October in India.
    expect(istMonthKey(new Date('2026-09-30T19:00:00Z'))).toBe('2026-10');
    expect(istMonthStart('2026-10').toISOString()).toBe(
      '2026-09-30T18:30:00.000Z',
    );
  });
  it('moves months across years and finds the financial year', () => {
    expect(addMonths('2026-01', -2)).toBe('2025-11');
    expect(addMonths('2026-11', 3)).toBe('2027-02');
    expect(fyStart('2026-10')).toBe('2026-04');
    expect(fyStart('2027-02')).toBe('2026-04');
  });
});
