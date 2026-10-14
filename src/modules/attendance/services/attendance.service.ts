import { Injectable } from '@nestjs/common';

import { badRequest, conflict } from '@common/errors/api-error';

import {
  MAX_SESSIONS_PER_DAY,
  dayStatus,
  istDate,
  istMonth,
  locationError,
  monthBounds,
  sessionMs,
  summarize,
  type PunchLocationData,
} from '../attendance.domain';
import type {
  AttendanceDayView,
  AttendanceMonthView,
  PunchDto,
} from '../dto/attendance.dto';
import { AttendanceRepository } from '../repositories/attendance.repository';
import type { AttendanceDay } from '../schemas/attendance-day.schema';

/**
 * Punch in / out for the calling partner. Every time is the server's clock and
 * every day is an IST day, so a phone with a wrong clock or timezone cannot
 * move a punch. Location is taken only at a punch, never tracked.
 */
@Injectable()
export class AttendanceService {
  constructor(private readonly days: AttendanceRepository) {}

  async today(agentId: string): Promise<AttendanceDayView> {
    const date = istDate(new Date());
    return toDayView(await this.days.find(agentId, date), date, date);
  }

  async punchIn(agentId: string, dto: PunchDto): Promise<AttendanceDayView> {
    const location = checkedLocation(dto);
    const now = new Date();
    const date = istDate(now);

    const day = await this.days.openSession(agentId, date, {
      in_at: now,
      in_location: location,
      out_at: null,
      out_location: null,
    });
    if (day) return toDayView(day, date, date);

    // The conditional upsert missed; the stored day says why.
    const current = await this.days.find(agentId, date);
    if (current?.punched_in) {
      throw conflict('ALREADY_PUNCHED_IN', 'You are already punched in.');
    }
    if (current && current.sessions.length >= MAX_SESSIONS_PER_DAY) {
      throw conflict(
        'PUNCH_LIMIT_REACHED',
        `You can punch in only ${MAX_SESSIONS_PER_DAY} times a day. Please try again tomorrow.`,
      );
    }
    throw changed();
  }

  async punchOut(agentId: string, dto: PunchDto): Promise<AttendanceDayView> {
    const location = checkedLocation(dto);
    const now = new Date();
    const date = istDate(now);

    // Only today's session: one left open on an earlier day stays a missed
    // punch-out rather than becoming a day-long shift.
    const day = await this.days.find(agentId, date);
    if (!day?.punched_in) {
      throw conflict(
        'NOT_PUNCHED_IN',
        'You have not punched in yet today. Please punch in first.',
      );
    }
    const index = day.sessions.length - 1;
    const open = day.sessions[index];
    const closed = await this.days.closeSession(
      agentId,
      date,
      index,
      open.in_at,
      now,
      location,
      sessionMs(open.in_at, now),
    );
    if (!closed) throw changed();
    return toDayView(closed, date, date);
  }

  /** Field days (punched in) in IST month `YYYY-MM` — a health-score factor. */
  fieldDays(agentId: string, month: string): Promise<number> {
    const { from, to } = monthBounds(month);
    return this.days.countDays(agentId, from, to);
  }

  async month(agentId: string, month?: string): Promise<AttendanceMonthView> {
    const now = new Date();
    const today = istDate(now);
    const key = month ?? istMonth(now);
    const { from, to } = monthBounds(key);
    const days = await this.days.range(agentId, from, to);
    return {
      month: key,
      days: days.map((d) => toDayView(d, d.date, today)),
      summary: summarize(days),
    };
  }
}

function checkedLocation(dto: PunchDto): PunchLocationData {
  const location: PunchLocationData = {
    lat: dto.lat ?? null,
    lng: dto.lng ?? null,
    accuracy_m: dto.accuracy_m ?? null,
    label: dto.label.trim(),
    source: dto.source,
  };
  const error = locationError(location);
  if (error) throw badRequest('VALIDATION_FAILED', error, [error]);
  return location;
}

/** Another device punched between this request's read and its write. */
function changed() {
  return conflict(
    'ATTENDANCE_CHANGED',
    'Your attendance was updated on another device. Please refresh and try again.',
  );
}

function toDayView(
  day: AttendanceDay | null,
  date: string,
  today: string,
): AttendanceDayView {
  const last = day?.sessions.at(-1) ?? null;
  return {
    date,
    status: dayStatus(day, today),
    punched_in: day?.punched_in ?? false,
    first_in_at: day?.first_in_at ?? null,
    session_in_at: last?.in_at ?? null,
    last_out_at: day && !day.punched_in ? day.last_out_at : null,
    worked_ms: day?.worked_ms ?? 0,
    location: last?.in_location.label ?? null,
    sessions: day?.sessions ?? [],
  };
}
