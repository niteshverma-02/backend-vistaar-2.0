import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, type QueryFilter } from 'mongoose';

import type { EventStatus, EventType } from '../events.domain';
import { FarmerEvent, type FarmerEventDocument } from '../schemas/event.schema';

/** Far above any real calendar; only a bound on a runaway read. */
const ACTIVE_READ_CAP = 300;

export interface EventFilter {
  status?: EventStatus;
  type?: EventType;
  cohort?: string;
  /** Only every-partner events — for a partner who has no cohort yet. */
  untargeted_only?: boolean;
}

@Injectable()
export class EventRepository {
  constructor(
    @InjectModel(FarmerEvent.name)
    private readonly model: Model<FarmerEventDocument>,
  ) {}

  /** Active events from `since` on, soonest first — what every partner's list is cut from. */
  listActiveFrom(since: Date): Promise<FarmerEvent[]> {
    return this.model
      .find({ is_active: true, starts_at: { $gte: since } })
      .sort({ starts_at: 1, _id: 1 })
      .limit(ACTIVE_READ_CAP)
      .lean<FarmerEvent[]>()
      .exec();
  }

  async page(
    filter: EventFilter,
    now: Date,
    skip: number,
    limit: number,
    sort: Record<string, 1 | -1>,
  ): Promise<{ rows: FarmerEvent[]; total: number }> {
    const query = queryOf(filter, now);
    const [rows, total] = await Promise.all([
      this.model
        .find(query)
        .sort({ ...sort, _id: 1 })
        .skip(skip)
        .limit(limit)
        .lean<FarmerEvent[]>()
        .exec(),
      this.model.countDocuments(query).exec(),
    ]);
    return { rows, total };
  }

  find(id: string): Promise<FarmerEvent | null> {
    return this.model.findById(id).lean<FarmerEvent | null>().exec();
  }

  async create(
    row: Omit<FarmerEvent, 'created_at' | 'updated_at'>,
  ): Promise<FarmerEvent> {
    const doc = await this.model.create(row);
    return doc.toObject<FarmerEvent>();
  }

  /** `seats` only lands if it still covers the seats taken at write time. */
  update(id: string, set: Partial<FarmerEvent>): Promise<FarmerEvent | null> {
    const filter: QueryFilter<FarmerEvent> = { _id: id };
    if (set.seats !== undefined) {
      filter.registered_count = { $lte: set.seats };
    }
    return this.model
      .findOneAndUpdate(filter, { $set: set }, { returnDocument: 'after' })
      .lean<FarmerEvent | null>()
      .exec();
  }

  /** Takes a seat only while the event is open and not full — one atomic write. */
  takeSeat(id: string, now: Date): Promise<FarmerEvent | null> {
    return this.model
      .findOneAndUpdate(
        {
          _id: id,
          is_active: true,
          starts_at: { $gt: now },
          $expr: { $lt: ['$registered_count', '$seats'] },
        },
        { $inc: { registered_count: 1 } },
        { returnDocument: 'after' },
      )
      .lean<FarmerEvent | null>()
      .exec();
  }

  releaseSeat(id: string): Promise<FarmerEvent | null> {
    return this.model
      .findOneAndUpdate(
        { _id: id, registered_count: { $gt: 0 } },
        { $inc: { registered_count: -1 } },
        { returnDocument: 'after' },
      )
      .lean<FarmerEvent | null>()
      .exec();
  }

  async remove(id: string): Promise<boolean> {
    return (await this.model.deleteOne({ _id: id }).exec()).deletedCount === 1;
  }
}

/** The Mongo side of `eventStatus` — keep the two in step. */
function queryOf(filter: EventFilter, now: Date): QueryFilter<FarmerEvent> {
  const query: QueryFilter<FarmerEvent> = {};
  switch (filter.status) {
    case 'inactive':
      query.is_active = false;
      break;
    case 'upcoming':
      Object.assign(query, { is_active: true, starts_at: { $gt: now } });
      break;
    case 'past':
      Object.assign(query, { is_active: true, starts_at: { $lte: now } });
      break;
    case undefined:
      break;
  }
  if (filter.type) query.type = filter.type;
  // An event for every partner is shown to this cohort too.
  if (filter.cohort) {
    query.$or = [{ cohorts: filter.cohort }, { cohorts: { $size: 0 } }];
  } else if (filter.untargeted_only) {
    query.cohorts = { $size: 0 };
  }
  return query;
}
