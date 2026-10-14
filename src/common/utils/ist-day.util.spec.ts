import { istDayStart, istDaysBetween } from './ist-day.util';

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
