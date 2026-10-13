import {
  eventStatus,
  isForCohort,
  registerError,
  seatsError,
} from './events.domain';

const now = new Date('2026-10-12T10:00:00Z');
const later = new Date('2026-10-20T10:00:00Z');
const earlier = new Date('2026-10-01T10:00:00Z');

describe('eventStatus', () => {
  it.each([
    [{ is_active: false, starts_at: later }, 'inactive'],
    [{ is_active: true, starts_at: later }, 'upcoming'],
    [{ is_active: true, starts_at: earlier }, 'past'],
  ] as const)('%o → %s', (e, status) => {
    expect(eventStatus(e, now)).toBe(status);
  });
});

describe('isForCohort', () => {
  it('shows an untargeted event to everyone, a targeted one to its cohorts', () => {
    expect(isForCohort({ cohorts: [] }, null)).toBe(true);
    expect(isForCohort({ cohorts: ['vistaar_agent'] }, 'vistaar_agent')).toBe(
      true,
    );
    expect(isForCohort({ cohorts: ['vistaar_agent'] }, 'ex_employee')).toBe(
      false,
    );
    expect(isForCohort({ cohorts: ['vistaar_agent'] }, null)).toBe(false);
  });
});

describe('registerError', () => {
  const open = {
    is_active: true,
    starts_at: later,
    seats: 2,
    registered_count: 1,
  };

  it('lets a partner take the last seat', () => {
    expect(registerError(open, now)).toBeNull();
  });

  it('refuses a full, started or switched-off event', () => {
    expect(registerError({ ...open, registered_count: 2 }, now)).toBe(
      'EVENT_FULL',
    );
    expect(registerError({ ...open, starts_at: earlier }, now)).toBe(
      'EVENT_CLOSED',
    );
    expect(registerError({ ...open, is_active: false }, now)).toBe(
      'EVENT_CLOSED',
    );
  });
});

describe('seatsError', () => {
  it('never cuts seats below those taken', () => {
    expect(seatsError(10, 12)).toMatch(/12 partners/);
    expect(seatsError(12, 12)).toBeNull();
  });
});
