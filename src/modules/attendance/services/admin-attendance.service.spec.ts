import { istDate } from '@common/utils/ist-day.util';
import type { AgentsService } from '@modules/agents/services/agents.service';

import { shiftDate } from '../attendance.domain';
import type { AttendanceRepository } from '../repositories/attendance.repository';
import type { AttendanceDay } from '../schemas/attendance-day.schema';
import { AdminAttendanceService } from './admin-attendance.service';
import type { AttendanceService } from './attendance.service';

const loc = {
  lat: 26.8,
  lng: 80.9,
  accuracy_m: 10,
  label: 'Rampur',
  source: 'gps' as const,
};

function day(agentId: string, date: string, open: boolean): AttendanceDay {
  const inAt = new Date(`${date}T04:00:00Z`);
  const outAt = new Date(`${date}T10:00:00Z`);
  return {
    _id: `${agentId}:${date}`,
    agent_id: agentId,
    date,
    sessions: [
      {
        in_at: inAt,
        in_location: loc,
        out_at: open ? null : outAt,
        out_location: open ? null : loc,
      },
    ],
    punched_in: open,
    first_in_at: inAt,
    last_out_at: open ? null : outAt,
    worked_ms: open ? 0 : 6 * 3_600_000,
    created_at: inAt,
    updated_at: inAt,
  };
}

const agent = (agentId: string, name: string) => ({
  _id: agentId,
  agent_id: agentId,
  phone: '9826000000',
  cohort: 'vistaar_agent',
  preview: { name, district: 'Raisen', state: 'Madhya Pradesh' },
  profile: null,
});

function setup(
  rows: AttendanceDay[],
  perDay: { _id: string; present: number; worked_ms: number }[] = [],
) {
  const days = {
    onDate: jest.fn().mockResolvedValue(rows),
    perDay: jest.fn().mockResolvedValue(perDay),
  };
  const agents = {
    list: jest.fn().mockResolvedValue({
      items: [
        agent('VST-1', 'Asha'),
        agent('VST-2', 'Ravi'),
        agent('VST-3', 'Gopal'),
      ],
      total: 3,
    }),
    requireByAgentId: jest.fn().mockResolvedValue(agent('VST-1', 'Asha')),
  };
  const attendance = {
    month: jest
      .fn()
      .mockResolvedValue({ month: '2026-10', days: [], summary: {} }),
  };
  const service = new AdminAttendanceService(
    days as unknown as AttendanceRepository,
    agents as unknown as AgentsService,
    attendance as unknown as AttendanceService,
  );
  return { service, days, agents, attendance };
}

describe('AdminAttendanceService.board', () => {
  it('lists every approved partner, with or without a punch', async () => {
    const today = istDate(new Date());
    const { service, agents } = setup([
      day('VST-1', today, true),
      day('VST-2', today, false),
    ]);
    const board = await service.board();
    expect(agents.list).toHaveBeenCalledWith(
      { stage: 'approved' },
      expect.objectContaining({ skip: 0 }),
    );
    expect(board.rows.map((r) => [r.agent_id, r.status])).toEqual([
      ['VST-1', 'on_duty'],
      ['VST-2', 'day_closed'],
      ['VST-3', 'not_started'],
    ]);
    expect(board.summary).toMatchObject({
      partners: 3,
      on_duty: 1,
      day_closed: 1,
      not_started: 1,
      worked_ms: 6 * 3_600_000,
    });
  });

  it('calls a past day left open a missed punch-out', async () => {
    const past = shiftDate(istDate(new Date()), 3);
    const { service } = setup([day('VST-1', past, true)]);
    const board = await service.board(past);
    expect(board.rows[0].status).toBe('missed_punch_out');
  });

  it('keeps a day of a partner no longer approved', async () => {
    const today = istDate(new Date());
    const { service } = setup([day('VST-9', today, false)]);
    const board = await service.board();
    expect(board.rows.find((r) => r.agent_id === 'VST-9')).toMatchObject({
      name: null,
      status: 'day_closed',
    });
  });

  it('fills the trend with zero days', async () => {
    const date = '2026-10-12';
    const { service } = setup(
      [],
      [{ _id: '2026-10-11', present: 4, worked_ms: 10 }],
    );
    const board = await service.board(date);
    expect(board.trend).toHaveLength(14);
    expect(board.trend[0].date).toBe('2026-09-29');
    expect(board.trend.at(-1)).toEqual({ date, present: 0, worked_ms: 0 });
    expect(board.trend.at(-2)).toEqual({
      date: '2026-10-11',
      present: 4,
      worked_ms: 10,
    });
  });
});

describe('AdminAttendanceService.partner', () => {
  it('reads the month by the stored agent id', async () => {
    const { service, attendance } = setup([]);
    const view = await service.partner('vst-1', '2026-10');
    expect(attendance.month).toHaveBeenCalledWith('VST-1', '2026-10');
    expect(view.partner).toMatchObject({ agent_id: 'VST-1', name: 'Asha' });
  });
});
