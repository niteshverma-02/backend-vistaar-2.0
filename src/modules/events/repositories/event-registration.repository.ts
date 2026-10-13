import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, mongo } from 'mongoose';

import { registrationId } from '../events.domain';
import {
  EventRegistration,
  type EventRegistrationDocument,
} from '../schemas/event-registration.schema';

const isDuplicateKey = (error: unknown): boolean =>
  error instanceof mongo.MongoServerError && error.code === 11000;

@Injectable()
export class EventRegistrationRepository {
  constructor(
    @InjectModel(EventRegistration.name)
    private readonly model: Model<EventRegistrationDocument>,
  ) {}

  /** `false` when the partner already holds a seat. */
  async add(eventId: string, agentId: string): Promise<boolean> {
    try {
      await this.model.create({
        _id: registrationId(eventId, agentId),
        event_id: eventId,
        agent_id: agentId,
      });
      return true;
    } catch (error) {
      if (isDuplicateKey(error)) return false;
      throw error;
    }
  }

  async remove(eventId: string, agentId: string): Promise<boolean> {
    const result = await this.model
      .deleteOne({ _id: registrationId(eventId, agentId) })
      .exec();
    return result.deletedCount === 1;
  }

  /** Which of these events the partner holds a seat at — `_id` lookups only. */
  async heldBy(agentId: string, eventIds: string[]): Promise<Set<string>> {
    if (eventIds.length === 0) return new Set();
    const rows = await this.model
      .find(
        { _id: { $in: eventIds.map((id) => registrationId(id, agentId)) } },
        { event_id: 1 },
      )
      .lean<{ event_id: string }[]>()
      .exec();
    return new Set(rows.map((r) => r.event_id));
  }

  async page(
    eventId: string,
    skip: number,
    limit: number,
  ): Promise<{ rows: EventRegistration[]; total: number }> {
    const [rows, total] = await Promise.all([
      this.model
        .find({ event_id: eventId })
        .sort({ created_at: 1, _id: 1 })
        .skip(skip)
        .limit(limit)
        .lean<EventRegistration[]>()
        .exec(),
      this.model.countDocuments({ event_id: eventId }).exec(),
    ]);
    return { rows, total };
  }

  async removeAll(eventId: string): Promise<void> {
    await this.model.deleteMany({ event_id: eventId }).exec();
  }
}
