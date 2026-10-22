import { windowQuery, windowStatus } from './schedule-window.util';

describe('schedule window', () => {
  const now = new Date('2026-10-22T06:30:00Z');
  const before = new Date('2026-10-01T00:00:00Z');
  const after = new Date('2026-11-01T00:00:00Z');

  it('reads each status, an end at `now` already expired', () => {
    const w = { is_active: true, starts_at: null, ends_at: null };
    expect(windowStatus({ ...w, is_active: false }, now)).toBe('inactive');
    expect(windowStatus({ ...w, ends_at: now }, now)).toBe('expired');
    expect(windowStatus({ ...w, starts_at: after }, now)).toBe('scheduled');
    expect(windowStatus({ ...w, starts_at: before, ends_at: after }, now)).toBe(
      'live',
    );
  });

  it('asks Mongo nothing when no status is picked', () => {
    expect(windowQuery(undefined, now)).toEqual({});
    expect(windowQuery('inactive', now)).toEqual({ is_active: false });
  });
});
