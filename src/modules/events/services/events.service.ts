import { HttpStatus, Injectable } from '@nestjs/common';

import { apiError, notFound } from '@common/errors/api-error';
import { PageResult } from '@common/http/page-result';
import { AgentsService } from '@modules/agents/services/agents.service';
import { RewardsService } from '@modules/rewards/services/rewards.service';

import type { PastEventsQueryDto } from '../dto/event.dto';
import { EventRegistrationRepository } from '../repositories/event-registration.repository';
import { EventRepository } from '../repositories/event.repository';
import type { FarmerEvent } from '../schemas/event.schema';
import {
  EVENT_NOT_FOUND,
  eventStatus,
  isForCohort,
  registerError,
  type EventStatus,
  type EventType,
} from '../events.domain';

/** What the app's Events screen and My Story's Meeting picker read. */
export interface PartnerEventView {
  id: string;
  title: string;
  type: EventType;
  starts_at: Date;
  location: string;
  note: string | null;
  seats: number;
  registered_count: number;
  seats_left: number;
  status: EventStatus;
  /** The caller holds a seat. */
  registered: boolean;
}

const ACTIVE_TTL_MS = 60_000;

/**
 * The partner's side of events. The list is cut per cohort from one cached
 * read; a partner's own seats are always read fresh.
 */
@Injectable()
export class EventsService {
  /** Each instance re-reads at most once a minute; seat counts may lag that much. */
  private active: { at: number; rows: FarmerEvent[] } | null = null;

  constructor(
    private readonly events: EventRepository,
    private readonly registrations: EventRegistrationRepository,
    private readonly agents: AgentsService,
    private readonly rewards: RewardsService,
  ) {}

  /** Upcoming events for the caller's cohort, soonest first. */
  async upcoming(agentId: string): Promise<PartnerEventView[]> {
    const [cohort, rows] = await Promise.all([
      this.cohortOf(agentId),
      this.activeRows(),
    ]);
    const now = new Date();
    const mine = rows.filter(
      (e) => e.starts_at > now && isForCohort(e, cohort),
    );
    return this.views(agentId, mine, now);
  }

  async past(
    agentId: string,
    query: PastEventsQueryDto,
  ): Promise<PageResult<PartnerEventView>> {
    const cohort = await this.cohortOf(agentId);
    const now = new Date();
    const { rows, total } = await this.events.page(
      cohort
        ? { status: 'past', cohort }
        : { status: 'past', untargeted_only: true },
      now,
      query.skip,
      query.limit,
      { starts_at: -1 },
    );
    return new PageResult(await this.views(agentId, rows, now), total, query);
  }

  async get(agentId: string, id: string): Promise<PartnerEventView> {
    const event = await this.requireVisible(agentId, id);
    const [view] = await this.views(agentId, [event], new Date());
    return view;
  }

  /** Idempotent: registering twice keeps the one seat. */
  async register(agentId: string, id: string): Promise<PartnerEventView> {
    const now = new Date();
    const event = await this.requireVisible(agentId, id);
    const refused = registerError(event, now);
    if (refused) throw refusal(refused);

    if (!(await this.registrations.add(id, agentId))) {
      return toView(event, true, now);
    }
    const updated = await this.events.takeSeat(id, now);
    if (!updated) {
      // The seat went (or the event closed) between the read and the write.
      await this.registrations.remove(id, agentId);
      const current = await this.events.find(id);
      throw refusal(
        current
          ? (registerError(current, now) ?? 'EVENT_FULL')
          : 'EVENT_CLOSED',
      );
    }
    // The seat is taken — it can earn (once per event, ever).
    await this.rewards.eventRegistered(agentId, id);
    return toView(updated, true, now);
  }

  /** Idempotent; only before the event starts, so attendance history stays true. */
  async unregister(agentId: string, id: string): Promise<PartnerEventView> {
    const now = new Date();
    const event = await this.requireVisible(agentId, id);
    if (eventStatus(event, now) === 'past') throw refusal('EVENT_CLOSED');
    if (!(await this.registrations.remove(id, agentId))) {
      return toView(event, false, now);
    }
    const updated = await this.events.releaseSeat(id);
    return toView(updated ?? event, false, now);
  }

  /** Drops the cached list after an HO edit on this instance. */
  invalidate(): void {
    this.active = null;
  }

  private async views(
    agentId: string,
    rows: FarmerEvent[],
    now: Date,
  ): Promise<PartnerEventView[]> {
    if (rows.length === 0) return [];
    const held = await this.registrations.heldBy(
      agentId,
      rows.map((e) => e._id),
    );
    return rows.map((e) => toView(e, held.has(e._id), now));
  }

  /** An event for another cohort is "not found", never a hint it exists. */
  private async requireVisible(
    agentId: string,
    id: string,
  ): Promise<FarmerEvent> {
    const [event, cohort] = await Promise.all([
      this.events.find(id),
      this.cohortOf(agentId),
    ]);
    if (!event || !event.is_active || !isForCohort(event, cohort)) {
      throw notFound(EVENT_NOT_FOUND);
    }
    return event;
  }

  private async cohortOf(agentId: string): Promise<string | null> {
    return this.agents.cohortByAgentId(agentId);
  }

  private async activeRows(): Promise<FarmerEvent[]> {
    if (this.active && Date.now() - this.active.at < ACTIVE_TTL_MS) {
      return this.active.rows;
    }
    const rows = await this.events.listActiveFrom(new Date());
    this.active = { at: Date.now(), rows };
    return rows;
  }
}

function toView(
  e: FarmerEvent,
  registered: boolean,
  now: Date,
): PartnerEventView {
  return {
    id: e._id,
    title: e.title,
    type: e.type,
    starts_at: e.starts_at,
    location: e.location,
    note: e.note,
    seats: e.seats,
    registered_count: e.registered_count,
    seats_left: Math.max(0, e.seats - e.registered_count),
    status: eventStatus(e, now),
    registered,
  };
}

function refusal(code: 'EVENT_CLOSED' | 'EVENT_FULL') {
  return apiError(
    HttpStatus.CONFLICT,
    code,
    code === 'EVENT_FULL'
      ? 'Sorry, this event is full. No seats are left.'
      : 'Registration for this event has closed.',
  );
}
