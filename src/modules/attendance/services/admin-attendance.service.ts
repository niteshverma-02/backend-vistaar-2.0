import { Injectable } from '@nestjs/common';

import { badRequest } from '@common/errors/api-error';
import { AgentsService } from '@modules/agents/services/agents.service';

import {
  LATE_AFTER_MIN,
  TREND_DAYS,
  boardSummary,
  dayStatus,
  daysInRange,
  istDate,
  istMinutes,
  rangeError,
  rollup,
  shiftDate,
  type BoardSummary,
  type DayStatus,
  type RangeRollup,
} from '../attendance.domain';
import type { AttendanceMonthView } from '../dto/attendance.dto';
import { AttendanceRepository } from '../repositories/attendance.repository';
import type {
  AttendanceDay,
  PunchSession,
} from '../schemas/attendance-day.schema';
import { AttendanceService } from './attendance.service';

/** A partner as the agents module hands it over (its repository type is that module's own). */
type AgentRecord = Awaited<ReturnType<AgentsService['requireByAgentId']>>;

/** Far above the approved roster; only a bound on a runaway read. */
const ROSTER_CAP = 5000;

export interface PartnerRef {
  agent_id: string;
  name: string | null;
  phone: string | null;
  cohort: string | null;
  district: string | null;
  state: string | null;
}

export interface BoardRow extends PartnerRef {
  status: DayStatus;
  punched_in: boolean;
  first_in_at: Date | null;
  /** Start of the open (or last) session. */
  session_in_at: Date | null;
  last_out_at: Date | null;
  worked_ms: number;
  /** Where the last session started, as the app labelled it. */
  location: string | null;
  sessions: PunchSession[];
}

export interface AttendanceBoard {
  date: string;
  /** IST today, so the portal knows whether the day is still running. */
  today: string;
  summary: BoardSummary;
  rows: BoardRow[];
  /** Oldest first, `TREND_DAYS` long, ending on `date`; days nobody punched show 0. */
  trend: { date: string; present: number; worked_ms: number }[];
}

export interface RangeRow extends PartnerRef, RangeRollup {}

export interface AttendanceRange {
  from: string;
  to: string;
  today: string;
  /** Calendar days in the range, both ends included. */
  days: number;
  late_after_min: number;
  summary: {
    partners: number;
    /** Partner-days with a punch-in, across the range. */
    present_days: number;
    /** `present_days / days`. */
    avg_present: number;
    late_days: number;
    missed_days: number;
    full_days: number;
    worked_ms: number;
    /** Over closed days. */
    avg_worked_ms: number;
    /** Partners in on every day of the range / never once. */
    every_day: number;
    never: number;
  };
  rows: RangeRow[];
  /** Every day of the range, oldest first; quiet days are 0. */
  trend: { date: string; present: number; late: number; worked_ms: number }[];
}

/**
 * The head-office side of attendance: who is on duty on a day, across every
 * approved partner, and one partner's month. Read-only — a punch is only
 * ever the partner's own, from the app.
 */
@Injectable()
export class AdminAttendanceService {
  constructor(
    private readonly days: AttendanceRepository,
    private readonly agents: AgentsService,
    private readonly attendance: AttendanceService,
  ) {}

  async board(date?: string): Promise<AttendanceBoard> {
    const today = istDate(new Date());
    const day = date ?? today;
    const from = shiftDate(day, TREND_DAYS - 1);
    const [roster, rows, perDay] = await Promise.all([
      this.agents.list(
        { stage: 'approved' },
        { skip: 0, limit: ROSTER_CAP, sort: { agent_id: 1 } },
      ),
      this.days.onDate(day),
      this.days.perDay(from, day),
    ]);

    const byAgent = new Map(rows.map((r) => [r.agent_id, r]));
    const known = new Set<string>();
    const board: BoardRow[] = [];
    for (const a of roster.items) {
      if (!a.agent_id) continue;
      known.add(a.agent_id);
      board.push(toRow(refOf(a), byAgent.get(a.agent_id) ?? null, day, today));
    }
    // A partner blocked after punching still shows for the day they worked.
    for (const r of rows) {
      if (!known.has(r.agent_id)) {
        board.push(toRow(bareRef(r.agent_id), r, day, today));
      }
    }

    const counts = new Map(perDay.map((p) => [p._id, p]));
    const trend = Array.from({ length: TREND_DAYS }, (_, i) => {
      const d = shiftDate(day, TREND_DAYS - 1 - i);
      const p = counts.get(d);
      return {
        date: d,
        present: p?.present ?? 0,
        worked_ms: p?.worked_ms ?? 0,
      };
    });

    return {
      date: day,
      today,
      summary: boardSummary(board),
      rows: board,
      trend,
    };
  }

  async range(from: string, to: string): Promise<AttendanceRange> {
    const error = rangeError(from, to);
    if (error) throw badRequest('VALIDATION_FAILED', error, [error]);
    const today = istDate(new Date());
    const [roster, stored] = await Promise.all([
      this.agents.list(
        { stage: 'approved' },
        { skip: 0, limit: ROSTER_CAP, sort: { agent_id: 1 } },
      ),
      this.days.inRange(from, to),
    ]);

    const byAgent = new Map<string, AttendanceDay[]>();
    for (const d of stored) {
      const list = byAgent.get(d.agent_id) ?? [];
      list.push(d);
      byAgent.set(d.agent_id, list);
    }
    const refs: PartnerRef[] = [];
    for (const a of roster.items) if (a.agent_id) refs.push(refOf(a));
    const known = new Set(refs.map((r) => r.agent_id));
    // A partner blocked after punching still shows for the days they worked.
    for (const id of byAgent.keys()) if (!known.has(id)) refs.push(bareRef(id));

    const rows: RangeRow[] = refs.map((ref) => ({
      ...ref,
      ...rollup(byAgent.get(ref.agent_id) ?? [], from, to, today),
    }));

    const n = daysInRange(from, to);
    const perDay = new Map<
      string,
      { present: number; late: number; worked_ms: number }
    >();
    for (const d of stored) {
      if (dayStatus(d, today) === 'not_started') continue;
      const e = perDay.get(d.date) ?? { present: 0, late: 0, worked_ms: 0 };
      e.present += 1;
      if (istMinutes(d.first_in_at) > LATE_AFTER_MIN) e.late += 1;
      if (!d.punched_in) e.worked_ms += d.worked_ms;
      perDay.set(d.date, e);
    }
    const trend = Array.from({ length: n }, (_, i) => {
      const date = shiftDate(from, -i);
      return {
        date,
        ...(perDay.get(date) ?? { present: 0, late: 0, worked_ms: 0 }),
      };
    });

    const sum = (k: keyof RangeRollup) =>
      rows.reduce((acc, r) => acc + (r[k] as number), 0);
    const closed = sum('closed_days');
    const worked = sum('worked_ms');
    const present = sum('present_days');
    return {
      from,
      to,
      today,
      days: n,
      late_after_min: LATE_AFTER_MIN,
      summary: {
        partners: rows.length,
        present_days: present,
        avg_present: n ? Math.round((present / n) * 10) / 10 : 0,
        late_days: sum('late_days'),
        missed_days: sum('missed_days'),
        full_days: sum('full_days'),
        worked_ms: worked,
        avg_worked_ms: closed ? Math.round(worked / closed) : 0,
        every_day: rows.filter((r) => r.present_days === n).length,
        never: rows.filter((r) => r.present_days === 0).length,
      },
      rows,
      trend,
    };
  }

  async partner(
    agentId: string,
    month?: string,
  ): Promise<AttendanceMonthView & { partner: PartnerRef }> {
    const agent = await this.agents.requireByAgentId(agentId);
    // the stored id, not the path's spelling: days are keyed by it
    const view = await this.attendance.month(agent.agent_id ?? agentId, month);
    return { ...view, partner: refOf(agent) };
  }
}

function refOf(a: AgentRecord): PartnerRef {
  return {
    agent_id: a.agent_id ?? '',
    name: a.profile?.name ?? a.preview?.name ?? null,
    phone: a.phone ?? null,
    cohort: a.cohort,
    district: a.profile?.district ?? a.preview?.district ?? null,
    state: a.profile?.state ?? a.preview?.state ?? null,
  };
}

const bareRef = (agentId: string): PartnerRef => ({
  agent_id: agentId,
  name: null,
  phone: null,
  cohort: null,
  district: null,
  state: null,
});

function toRow(
  ref: PartnerRef,
  day: AttendanceDay | null,
  date: string,
  today: string,
): BoardRow {
  const last = day?.sessions.at(-1) ?? null;
  return {
    ...ref,
    status: dayStatus(day ? { ...day, date } : null, today),
    punched_in: day?.punched_in ?? false,
    first_in_at: day?.first_in_at ?? null,
    session_in_at: last?.in_at ?? null,
    last_out_at: day && !day.punched_in ? day.last_out_at : null,
    worked_ms: day?.worked_ms ?? 0,
    location: last?.in_location.label ?? null,
    sessions: day?.sessions ?? [],
  };
}
