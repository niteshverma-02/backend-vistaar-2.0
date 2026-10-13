import { HttpException } from '@nestjs/common';

import { MAX_SESSIONS_PER_DAY } from '../attendance.domain';
import type { PunchDto } from '../dto/attendance.dto';
import type { AttendanceRepository } from '../repositories/attendance.repository';
import type {
  AttendanceDay,
  PunchSession,
} from '../schemas/attendance-day.schema';
import { AttendanceService } from './attendance.service';

const AGENT = 'VST-101';
// 10:00 IST on 12 Oct.
const NOW = new Date('2026-10-12T04:30:00Z');
const TODAY = '2026-10-12';

const DTO: PunchDto = {
  source: 'gps',
  lat: 26.8467,
  lng: 80.9462,
  accuracy_m: 12,
  label: ' Rampur, Lucknow ',
};

function session(overrides: Partial<PunchSession> = {}): PunchSession {
  return {
    in_at: new Date('2026-10-12T03:30:00Z'),
    in_location: {
      lat: 26.8467,
      lng: 80.9462,
      accuracy_m: 12,
      label: 'Rampur, Lucknow',
      source: 'gps',
    },
    out_at: null,
    out_location: null,
    ...overrides,
  };
}

function day(overrides: Partial<AttendanceDay> = {}): AttendanceDay {
  return {
    _id: `${AGENT}:${TODAY}`,
    agent_id: AGENT,
    date: TODAY,
    sessions: [session()],
    punched_in: true,
    first_in_at: new Date('2026-10-12T03:30:00Z'),
    last_out_at: null,
    worked_ms: 0,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function setup() {
  const repo = {
    find: jest.fn().mockResolvedValue(null),
    range: jest.fn().mockResolvedValue([]),
    openSession: jest.fn(),
    closeSession: jest.fn(),
  };
  const service = new AttendanceService(
    repo as unknown as AttendanceRepository,
  );
  return { repo, service };
}

async function codeOf(promise: Promise<unknown>): Promise<unknown> {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(HttpException);
  return ((error as HttpException).getResponse() as { error: string }).error;
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('AttendanceService.today', () => {
  it('is not started when there is no row', async () => {
    const { service } = setup();
    await expect(service.today(AGENT)).resolves.toMatchObject({
      date: TODAY,
      status: 'not_started',
      punched_in: false,
      sessions: [],
    });
  });

  it('reads the IST day, not the UTC one', async () => {
    const { repo, service } = setup();
    jest.setSystemTime(new Date('2026-10-12T19:00:00Z'));
    await service.today(AGENT);
    expect(repo.find).toHaveBeenCalledWith(AGENT, '2026-10-13');
  });
});

describe('AttendanceService.punchIn', () => {
  it('opens a session at server time with the trimmed location', async () => {
    const { repo, service } = setup();
    repo.openSession.mockResolvedValue(day());

    const view = await service.punchIn(AGENT, DTO);

    expect(repo.openSession).toHaveBeenCalledWith(AGENT, TODAY, {
      in_at: NOW,
      in_location: { ...session().in_location },
      out_at: null,
      out_location: null,
    });
    expect(view).toMatchObject({
      status: 'on_duty',
      location: 'Rampur, Lucknow',
    });
  });

  it('refuses a bad location before touching the database', async () => {
    const { repo, service } = setup();
    await expect(
      codeOf(service.punchIn(AGENT, { ...DTO, lat: 0, lng: 0 })),
    ).resolves.toBe('VALIDATION_FAILED');
    expect(repo.openSession).not.toHaveBeenCalled();
  });

  it('says already punched in when a session is open', async () => {
    const { repo, service } = setup();
    repo.openSession.mockResolvedValue(null);
    repo.find.mockResolvedValue(day());
    await expect(codeOf(service.punchIn(AGENT, DTO))).resolves.toBe(
      'ALREADY_PUNCHED_IN',
    );
  });

  it('says the day is full at the session cap', async () => {
    const { repo, service } = setup();
    repo.openSession.mockResolvedValue(null);
    repo.find.mockResolvedValue(
      day({
        punched_in: false,
        sessions: Array.from({ length: MAX_SESSIONS_PER_DAY }, () =>
          session({ out_at: NOW }),
        ),
      }),
    );
    await expect(codeOf(service.punchIn(AGENT, DTO))).resolves.toBe(
      'PUNCH_LIMIT_REACHED',
    );
  });

  it('reports a race it cannot explain as changed', async () => {
    const { repo, service } = setup();
    repo.openSession.mockResolvedValue(null);
    repo.find.mockResolvedValue(day({ punched_in: false }));
    await expect(codeOf(service.punchIn(AGENT, DTO))).resolves.toBe(
      'ATTENDANCE_CHANGED',
    );
  });
});

describe('AttendanceService.punchOut', () => {
  it('closes the open session and adds its time', async () => {
    const { repo, service } = setup();
    const open = day({
      sessions: [
        session({ out_at: new Date('2026-10-12T03:00:00Z') }),
        session(),
      ],
    });
    repo.find.mockResolvedValue(open);
    repo.closeSession.mockResolvedValue(
      day({ punched_in: false, last_out_at: NOW }),
    );

    const view = await service.punchOut(AGENT, {
      source: 'registered',
      label: 'Malihabad, Lucknow',
    });

    expect(repo.closeSession).toHaveBeenCalledWith(
      AGENT,
      TODAY,
      1,
      open.sessions[1].in_at,
      NOW,
      {
        lat: null,
        lng: null,
        accuracy_m: null,
        label: 'Malihabad, Lucknow',
        source: 'registered',
      },
      3_600_000,
    );
    expect(view).toMatchObject({ status: 'day_closed', last_out_at: NOW });
  });

  it('refuses when nothing is open today', async () => {
    const { repo, service } = setup();
    repo.find.mockResolvedValue(day({ punched_in: false }));
    await expect(codeOf(service.punchOut(AGENT, DTO))).resolves.toBe(
      'NOT_PUNCHED_IN',
    );
    expect(repo.closeSession).not.toHaveBeenCalled();
  });

  it('reports a session closed by another device as changed', async () => {
    const { repo, service } = setup();
    repo.find.mockResolvedValue(day());
    repo.closeSession.mockResolvedValue(null);
    await expect(codeOf(service.punchOut(AGENT, DTO))).resolves.toBe(
      'ATTENDANCE_CHANGED',
    );
  });
});

describe('AttendanceService.month', () => {
  it('defaults to the current IST month and marks earlier open days', async () => {
    const { repo, service } = setup();
    repo.range.mockResolvedValue([
      day({ punched_in: false, worked_ms: 1000 }),
      day({ _id: `${AGENT}:2026-10-11`, date: '2026-10-11' }),
    ]);

    const view = await service.month(AGENT);

    expect(repo.range).toHaveBeenCalledWith(AGENT, '2026-10-01', '2026-10-31');
    expect(view.month).toBe('2026-10');
    expect(view.days.map((d) => d.status)).toEqual([
      'day_closed',
      'missed_punch_out',
    ]);
    expect(view.summary).toMatchObject({ present_days: 2, closed_days: 1 });
  });
});
