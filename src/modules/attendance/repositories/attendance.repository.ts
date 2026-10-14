import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { mongo, type Model } from 'mongoose';

import { MAX_SESSIONS_PER_DAY } from '../attendance.domain';
import {
  AttendanceDay,
  attendanceDayId,
  type PunchLocation,
  type PunchSession,
} from '../schemas/attendance-day.schema';

/** A month has at most 31 days; only a bound on a runaway read. */
const MONTH_READ_CAP = 31;

/** Far above the partner roster; only a bound on a runaway HO read. */
const BOARD_READ_CAP = 5000;

/** A year of days for a large roster; only a bound on a runaway range read. */
const RANGE_READ_CAP = 400_000;

/** What a range roll-up reads of a day — never the coordinates. */
const RANGE_FIELDS = {
  agent_id: 1,
  date: 1,
  punched_in: 1,
  first_in_at: 1,
  last_out_at: 1,
  worked_ms: 1,
  'sessions.in_location.source': 1,
  'sessions.out_location.source': 1,
} as const;

@Injectable()
export class AttendanceRepository {
  constructor(
    @InjectModel(AttendanceDay.name)
    private readonly model: Model<AttendanceDay>,
  ) {}

  find(agentId: string, date: string): Promise<AttendanceDay | null> {
    return this.model
      .findById(attendanceDayId(agentId, date))
      .lean<AttendanceDay>()
      .exec();
  }

  /** Days in `[from, to]`, newest first — an `_id` range, since the id starts with the partner. */
  /** Days punched in between two day keys — a day row exists only once punched in. */
  countDays(agentId: string, from: string, to: string): Promise<number> {
    return this.model
      .countDocuments({
        _id: {
          $gte: attendanceDayId(agentId, from),
          $lte: attendanceDayId(agentId, to),
        },
      })
      .exec();
  }

  range(agentId: string, from: string, to: string): Promise<AttendanceDay[]> {
    return this.model
      .find({
        _id: {
          $gte: attendanceDayId(agentId, from),
          $lte: attendanceDayId(agentId, to),
        },
        agent_id: agentId,
      })
      .sort({ _id: -1 })
      .limit(MONTH_READ_CAP)
      .lean<AttendanceDay[]>()
      .exec();
  }

  /** Every partner's day on `date` — the HO board. */
  onDate(date: string): Promise<AttendanceDay[]> {
    return this.model
      .find({ date })
      .limit(BOARD_READ_CAP)
      .lean<AttendanceDay[]>()
      .exec();
  }

  /** Every partner's days in `[from, to]`, slimmed to what the range view reads. */
  inRange(from: string, to: string): Promise<AttendanceDay[]> {
    return this.model
      .find({ date: { $gte: from, $lte: to } }, RANGE_FIELDS)
      .limit(RANGE_READ_CAP)
      .lean<AttendanceDay[]>()
      .exec();
  }

  /** Present partners and worked time per day in `[from, to]`, for the HO trend. */
  perDay(
    from: string,
    to: string,
  ): Promise<{ _id: string; present: number; worked_ms: number }[]> {
    return this.model
      .aggregate<{ _id: string; present: number; worked_ms: number }>([
        { $match: { date: { $gte: from, $lte: to } } },
        {
          $group: {
            _id: '$date',
            present: { $sum: 1 },
            worked_ms: { $sum: '$worked_ms' },
          },
        },
      ])
      .exec();
  }

  /**
   * Opens a session in one round trip, creating the day on its first punch.
   * `null` when the day is already on duty or full: the filter misses, the
   * upsert then collides with the existing `_id`, and the caller re-reads to
   * say which. Two punches racing from two phones open one session, not two.
   */
  async openSession(
    agentId: string,
    date: string,
    session: PunchSession,
  ): Promise<AttendanceDay | null> {
    try {
      return await this.model
        .findOneAndUpdate(
          {
            _id: attendanceDayId(agentId, date),
            punched_in: { $ne: true },
            [`sessions.${MAX_SESSIONS_PER_DAY - 1}`]: { $exists: false },
          },
          {
            $push: { sessions: session },
            $set: { punched_in: true },
            $setOnInsert: {
              agent_id: agentId,
              date,
              first_in_at: session.in_at,
              last_out_at: null,
              worked_ms: 0,
            },
          },
          {
            upsert: true,
            returnDocument: 'after',
            // Schema defaults would also write `sessions` / `punched_in` and collide with the update.
            setDefaultsOnInsert: false,
          },
        )
        .lean<AttendanceDay>()
        .exec();
    } catch (error) {
      if (error instanceof mongo.MongoServerError && error.code === 11000) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Closes session `index`, conditional on it being the one that was read
   * (same `in_at`, still open). `null` when another request closed it first.
   */
  closeSession(
    agentId: string,
    date: string,
    index: number,
    inAt: Date,
    outAt: Date,
    location: PunchLocation,
    ms: number,
  ): Promise<AttendanceDay | null> {
    return this.model
      .findOneAndUpdate(
        {
          _id: attendanceDayId(agentId, date),
          punched_in: true,
          [`sessions.${index}.in_at`]: inAt,
          [`sessions.${index}.out_at`]: null,
        },
        {
          $set: {
            [`sessions.${index}.out_at`]: outAt,
            [`sessions.${index}.out_location`]: location,
            punched_in: false,
            last_out_at: outAt,
          },
          $inc: { worked_ms: ms },
        },
        { returnDocument: 'after' },
      )
      .lean<AttendanceDay>()
      .exec();
  }
}
