import { istDate } from '@common/utils/ist-day.util';
import {
  dayStatus,
  daysInRange,
  rangeError,
  rollup,
  istMonth,
  locationError,
  monthBounds,
  sessionMs,
  summarize,
  type DayData,
  type PunchLocationData,
} from './attendance.domain';

const gps = (
  overrides: Partial<PunchLocationData> = {},
): PunchLocationData => ({
  lat: 26.8467,
  lng: 80.9462,
  accuracy_m: 12,
  label: 'Rampur, Lucknow',
  source: 'gps',
  ...overrides,
});

const at = (iso: string) => new Date(iso);

function day(overrides: Partial<DayData> = {}): DayData {
  return {
    date: '2026-10-12',
    sessions: [
      {
        in_at: at('2026-10-12T03:30:00Z'),
        in_location: gps(),
        out_at: at('2026-10-12T12:30:00Z'),
        out_location: gps(),
      },
    ],
    punched_in: false,
    worked_ms: 9 * 3_600_000,
    ...overrides,
  };
}

describe('istDate', () => {
  it.each([
    [
      'UTC evening is already the next IST day',
      '2026-10-12T18:30:00Z',
      '2026-10-13',
    ],
    ['one ms before IST midnight', '2026-10-12T18:29:59.999Z', '2026-10-12'],
    ['UTC midnight is IST morning', '2026-10-12T00:00:00Z', '2026-10-12'],
    ['across a month end', '2026-10-31T19:00:00Z', '2026-11-01'],
  ])('%s', (_, iso, expected) => {
    expect(istDate(at(iso))).toBe(expected);
  });

  it('gives the IST month', () => {
    expect(istMonth(at('2026-09-30T19:00:00Z'))).toBe('2026-10');
  });
});

describe('monthBounds', () => {
  it('covers every day of the month and nothing of the next', () => {
    const { from, to } = monthBounds('2026-02');
    expect(
      ['2026-02-01', '2026-02-28'].every((d) => d >= from && d <= to),
    ).toBe(true);
    expect('2026-03-01' > to).toBe(true);
    expect('2026-01-31' < from).toBe(true);
  });
});

describe('dayStatus', () => {
  it.each([
    ['no row', null, 'not_started'],
    ['closed', day(), 'day_closed'],
    ['open today', day({ punched_in: true }), 'on_duty'],
    [
      'open on an earlier day',
      day({ date: '2026-10-11', punched_in: true }),
      'missed_punch_out',
    ],
  ] as const)('%s → %s', (_, d, expected) => {
    expect(dayStatus(d, '2026-10-12')).toBe(expected);
  });
});

describe('locationError', () => {
  it('accepts a GPS fix in India', () => {
    expect(locationError(gps())).toBeNull();
  });

  it('accepts a registered village without coordinates', () => {
    expect(
      locationError(
        gps({ source: 'registered', lat: null, lng: null, accuracy_m: null }),
      ),
    ).toBeNull();
  });

  it.each([
    ['GPS without coordinates', gps({ lat: null })],
    [
      'GPS outside India (0,0 from a phone with no fix)',
      gps({ lat: 0, lng: 0 }),
    ],
    ['registered village with a guessed point', gps({ source: 'registered' })],
    ['blank label', gps({ label: '  ' })],
  ])('refuses %s', (_, loc) => {
    expect(locationError(loc)).toEqual(expect.any(String));
  });
});

describe('sessionMs', () => {
  it('is out − in', () => {
    expect(
      sessionMs(at('2026-10-12T03:00:00Z'), at('2026-10-12T04:30:00Z')),
    ).toBe(5_400_000);
  });

  it('never goes negative', () => {
    expect(
      sessionMs(at('2026-10-12T04:00:00Z'), at('2026-10-12T03:00:00Z')),
    ).toBe(0);
  });
});

describe('summarize', () => {
  it('averages over closed days only', () => {
    const summary = summarize([
      day({ worked_ms: 8 * 3_600_000 }),
      day({ worked_ms: 10 * 3_600_000 }),
      day({ date: '2026-10-10', punched_in: true, worked_ms: 3_600_000 }),
    ]);
    expect(summary).toEqual({
      present_days: 3,
      closed_days: 2,
      worked_ms: 18 * 3_600_000,
      avg_worked_ms: 9 * 3_600_000,
    });
  });

  it('is all zero for an empty month', () => {
    expect(summarize([])).toEqual({
      present_days: 0,
      closed_days: 0,
      worked_ms: 0,
      avg_worked_ms: 0,
    });
  });
});

describe('range roll-up', () => {
  const gps = {
    lat: 26.8,
    lng: 80.9,
    accuracy_m: 10,
    label: 'Rampur',
    source: 'gps' as const,
  };
  const village = {
    lat: null,
    lng: null,
    accuracy_m: null,
    label: 'Rampur',
    source: 'registered' as const,
  };
  // 04:00Z = 9:30 IST (on time); 05:00Z = 10:30 IST (late)
  const day = (
    date: string,
    opts: {
      late?: boolean;
      open?: boolean;
      hours?: number;
      breaks?: boolean;
      noGps?: boolean;
    } = {},
  ) => {
    const inAt = new Date(`${date}T0${opts.late ? 5 : 4}:00:00Z`);
    const outAt = opts.open
      ? null
      : new Date(inAt.getTime() + (opts.hours ?? 6) * 3_600_000);
    const s = {
      in_at: inAt,
      in_location: opts.noGps ? village : gps,
      out_at: outAt,
      out_location: outAt ? gps : null,
    };
    return {
      date,
      sessions: opts.breaks ? [s, s] : [s],
      punched_in: !!opts.open,
      worked_ms: opts.open ? 0 : (opts.hours ?? 6) * 3_600_000,
      first_in_at: inAt,
      last_out_at: outAt,
    };
  };

  it('counts days, marks each one and averages over closed days', () => {
    const r = rollup(
      [
        day('2026-10-01'),
        day('2026-10-02', { late: true, hours: 4, breaks: true }),
        day('2026-10-04', { open: true, noGps: true }),
      ],
      '2026-10-01',
      '2026-10-05',
      '2026-10-13',
    );
    expect(r.marks).toBe('CC.M.');
    expect(r.minutes).toEqual([360, 240, 0, 0, 0]);
    expect(r).toMatchObject({
      present_days: 3,
      closed_days: 2,
      missed_days: 1,
      late_days: 1,
      full_days: 1,
      break_days: 1,
      no_gps_days: 1,
      worked_ms: 10 * 3_600_000,
      avg_worked_ms: 5 * 3_600_000,
      first_date: '2026-10-01',
      last_date: '2026-10-04',
    });
  });

  it('marks today open as on duty, and an empty range as all dots', () => {
    expect(
      rollup(
        [day('2026-10-13', { open: true })],
        '2026-10-12',
        '2026-10-13',
        '2026-10-13',
      ).marks,
    ).toBe('.O');
    const none = rollup([], '2026-10-01', '2026-10-03', '2026-10-13');
    expect(none).toMatchObject({
      marks: '...',
      present_days: 0,
      avg_in_min: null,
    });
  });

  it('refuses an upside-down or over-long range', () => {
    expect(rangeError('2026-10-02', '2026-10-01')).toMatch(/start date/);
    expect(rangeError('2025-01-01', '2026-10-01')).toMatch(/366/);
    expect(rangeError('2025-10-14', '2026-10-13')).toBeNull();
    expect(daysInRange('2026-10-01', '2026-10-31')).toBe(31);
  });
});
