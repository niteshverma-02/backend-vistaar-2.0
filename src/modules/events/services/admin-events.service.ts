import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { badRequest, conflict, notFound } from '@common/errors/api-error';
import { PageResult } from '@common/http/page-result';
import type { PageQueryDto } from '@common/dto/page-query.dto';
import { AgentsService } from '@modules/agents/services/agents.service';
import { CohortsService } from '@modules/onboarding/services/cohorts.service';

import type {
  CreateEventDto,
  EventListQueryDto,
  UpdateEventDto,
} from '../dto/event.dto';
import { EventRegistrationRepository } from '../repositories/event-registration.repository';
import { EventRepository } from '../repositories/event.repository';
import type { FarmerEvent } from '../schemas/event.schema';
import {
  EVENT_NOT_FOUND,
  eventStatus,
  seatsError,
  type EventStatus,
} from '../events.domain';
import { EventsService } from './events.service';

export type AdminEventView = FarmerEvent & { status: EventStatus };

export interface RegistrationRow {
  agent_id: string;
  name: string | null;
  phone: string | null;
  cohort: string | null;
  district: string | null;
  registered_at: Date;
}

/** HO runs the calendar: add, edit, cancel, and see who registered. */
@Injectable()
export class AdminEventsService {
  constructor(
    private readonly events: EventRepository,
    private readonly registrations: EventRegistrationRepository,
    private readonly partnerEvents: EventsService,
    private readonly agents: AgentsService,
    private readonly cohorts: CohortsService,
  ) {}

  async list(query: EventListQueryDto): Promise<PageResult<AdminEventView>> {
    const now = new Date();
    const { rows, total } = await this.events.page(
      { status: query.status, type: query.type, cohort: query.cohort },
      now,
      query.skip,
      query.limit,
      query.sortSpec,
    );
    return new PageResult(
      rows.map((e) => toAdminView(e, now)),
      total,
      query,
    );
  }

  async get(id: string): Promise<AdminEventView> {
    return toAdminView(await this.require(id), new Date());
  }

  async create(dto: CreateEventDto, by: string): Promise<AdminEventView> {
    const saved = await this.events.create({
      _id: randomUUID(),
      title: dto.title.trim(),
      type: dto.type,
      starts_at: new Date(dto.starts_at),
      location: dto.location.trim(),
      note: dto.note?.trim() || null,
      seats: dto.seats,
      registered_count: 0,
      cohorts: await this.checkCohorts(dto.cohorts ?? []),
      is_active: dto.is_active ?? true,
      created_by: by,
      updated_by: by,
    });
    this.partnerEvents.invalidate();
    return toAdminView(saved, new Date());
  }

  async update(
    id: string,
    dto: UpdateEventDto,
    by: string,
  ): Promise<AdminEventView> {
    const current = await this.require(id);
    const { starts_at, cohorts, ...rest } = dto;
    // A validated DTO carries every declared field, `undefined` when not sent.
    const sent = Object.entries(rest).filter(([, v]) => v !== undefined);
    const set: Partial<FarmerEvent> = {
      ...(Object.fromEntries(sent) as Partial<FarmerEvent>),
      updated_by: by,
    };
    if (starts_at !== undefined) set.starts_at = new Date(starts_at);
    if (cohorts !== undefined) set.cohorts = await this.checkCohorts(cohorts);
    if (set.seats !== undefined) {
      const error = seatsError(set.seats, current.registered_count);
      if (error) throw badRequest('VALIDATION_FAILED', error, [error]);
    }

    const updated = await this.events.update(id, set);
    if (!updated) {
      // Partners registered between the check and the write.
      throw conflict(
        'EVENT_SEATS_TAKEN',
        'More partners registered while you were editing. Please reload the page and set the seats again.',
      );
    }
    this.partnerEvents.invalidate();
    return toAdminView(updated, new Date());
  }

  /**
   * Deleting cancels it for every registered partner. To keep it in their
   * history instead, switch it off (`is_active: false`).
   */
  async remove(id: string): Promise<{ deleted: true }> {
    if (!(await this.events.remove(id))) throw notFound(EVENT_NOT_FOUND);
    await this.registrations.removeAll(id);
    this.partnerEvents.invalidate();
    return { deleted: true };
  }

  async registrationsOf(
    id: string,
    query: PageQueryDto,
  ): Promise<PageResult<RegistrationRow>> {
    await this.require(id);
    const { rows, total } = await this.registrations.page(
      id,
      query.skip,
      query.limit,
    );
    const ids = rows.map((r) => r.agent_id);
    const { items } = ids.length
      ? await this.agents.list(
          { agent_ids: ids, include_unverified: true },
          { skip: 0, limit: ids.length, sort: { agent_id: 1 } },
        )
      : { items: [] };
    const byId = new Map(items.map((a) => [a.agent_id, a]));
    return new PageResult(
      rows.map((r) => {
        const a = byId.get(r.agent_id);
        return {
          agent_id: r.agent_id,
          name: a?.profile?.name ?? a?.preview?.name ?? null,
          phone: a?.phone ?? null,
          cohort: a?.cohort ?? null,
          district: a?.profile?.district ?? a?.preview?.district ?? null,
          registered_at: r.created_at,
        };
      }),
      total,
      query,
    );
  }

  private async require(id: string): Promise<FarmerEvent> {
    const event = await this.events.find(id);
    if (!event) throw notFound(EVENT_NOT_FOUND);
    return event;
  }

  /** Inactive cohorts are allowed: HO may plan an event before launching one. */
  private async checkCohorts(keys: string[]): Promise<string[]> {
    const unique = [...new Set(keys)];
    await Promise.all(unique.map((key) => this.cohorts.require(key, false)));
    return unique;
  }
}

function toAdminView(e: FarmerEvent, now: Date): AdminEventView {
  return { ...e, status: eventStatus(e, now) };
}
