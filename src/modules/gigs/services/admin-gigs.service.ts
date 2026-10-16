import { Injectable } from '@nestjs/common';
import type { QueryFilter, UpdateQuery } from 'mongoose';

import { badRequest, conflict, notFound } from '@common/errors/api-error';
import { PageResult } from '@common/http/page-result';
import {
  DAY_MS,
  addMonths,
  istDayRange,
  istMonthKey,
  istMonthStart,
} from '@common/utils/ist-day.util';
import { istDate } from '@modules/attendance/attendance.domain';
import { AgentsService } from '@modules/agents/services/agents.service';
import { CountersService } from '@modules/counters/services/counters.service';
import { EarningCohortsService } from '@modules/earning/services/earning-cohorts.service';
import { SettingsService } from '@modules/settings/services/settings.service';
import { StorageService } from '@modules/uploads/services/storage.service';

import type {
  AdminGigsQueryDto,
  AssignGigDto,
  CreateGigDto,
  UpdateGigDto,
} from '../dto/gig.dto';
import {
  FINAL,
  HELD,
  REPEAT_PHONE_DAYS,
  cohortPayout,
  isMissed,
  payoutOnRelease,
  payoutOnTake,
  payoutSourceOf,
} from '../gigs.domain';
import {
  GigRepository,
  type GigFilter,
  type GigTotals,
} from '../repositories/gig.repository';
import type { Gig } from '../schemas/gig.schema';

const GIG_NOT_FOUND = 'This gig could not be found.';

export type AdminGigRow = Omit<Gig, '_id'> & {
  id: string;
  partner_name: string | null;
  missed: boolean;
};

export interface RepeatPhone {
  phone: string;
  /** The partner entered their own number as a farmer. */
  partner_phone: boolean;
  /** Other gigs this phone was at within `REPEAT_PHONE_DAYS` of this one. */
  gigs: { gig_id: string; agent_id: string | null; starts_at: Date }[];
}

export type AdminGigView = Omit<Gig, 'photos' | '_id'> & {
  id: string;
  missed: boolean;
  partner: { agent_id: string; name: string | null; phone: string } | null;
  /** `url` is signed for an hour; `null` when the file cannot be signed. */
  photos: { id: string; at: Date; url: string | null }[];
  repeat_phones: RepeatPhone[];
};

export type GigSummary = GigTotals & { from: string; to: string };

/** HO posts gigs, hands them out, and reviews the partner's proof. */
@Injectable()
export class AdminGigsService {
  constructor(
    private readonly gigs: GigRepository,
    private readonly agents: AgentsService,
    private readonly counters: CountersService,
    private readonly settings: SettingsService,
    private readonly storage: StorageService,
    private readonly earning: EarningCohortsService,
  ) {}

  async list(query: AdminGigsQueryDto): Promise<PageResult<AdminGigRow>> {
    const { rows, total } = await this.gigs.page(
      filterOf(query, query.from, query.to),
      query.skip,
      query.limit,
      { starts_at: -1 },
    );
    const names = await this.agents.partnersByAgentIds([
      ...new Set(rows.flatMap((r) => (r.agent_id ? [r.agent_id] : []))),
    ]);
    const now = new Date();
    return new PageResult(
      rows.map(({ _id, ...r }) => ({
        id: _id,
        ...r,
        payout_source: payoutSourceOf(r),
        partner_name: r.agent_id ? (names.get(r.agent_id)?.name ?? null) : null,
        missed: isMissed(r, now),
      })),
      total,
      query,
    );
  }

  /** Cards for IST days, by default the whole of this IST month (gigs ahead included). */
  async summary(query: AdminGigsQueryDto): Promise<GigSummary> {
    const key = istMonthKey(new Date());
    const from = query.from ?? `${key}-01`;
    const to =
      query.to ??
      istDate(new Date(istMonthStart(addMonths(key, 1)).getTime() - DAY_MS));
    const totals = await this.gigs.totals(filterOf(query, from, to));
    return { ...totals, from, to };
  }

  async get(id: string): Promise<AdminGigView> {
    return this.view(await this.require(id));
  }

  async create(dto: CreateGigDto, by: string): Promise<AdminGigView> {
    const starts_at = new Date(dto.starts_at);
    const ends_at = new Date(dto.ends_at);
    timeCheck(starts_at, ends_at, true);
    const rules = await this.settings.get();
    const saved = await this.gigs.create({
      _id: await this.counters.nextGigId(),
      title: dto.title,
      village: dto.village,
      district: dto.district || null,
      state: dto.state || null,
      pincode: dto.pincode || null,
      venue: dto.venue || null,
      venue_point: dto.venue_point
        ? { lat: dto.venue_point.lat, lng: dto.venue_point.lng }
        : null,
      starts_at,
      ends_at,
      expected_farmers: dto.expected_farmers ?? 0,
      min_farmers: dto.min_farmers ?? rules.gig_min_farmers,
      photos_required: dto.photos_required ?? rules.gig_photos_required,
      // Left empty: the taker's earning-cohort rate, fixed when they take it.
      payout: dto.payout ?? null,
      payout_source:
        dto.payout === undefined || dto.payout === null ? 'cohort' : 'gig',
      products: dto.products ?? [],
      requirements: dto.requirements ?? [],
      cohorts: [...new Set(dto.cohorts ?? [])],
      status: 'open',
      agent_id: null,
      accepted_at: null,
      assigned_by: null,
      releases: [],
      check_in: null,
      attendees: [],
      photos: [],
      submitted_at: null,
      reviewed_by: null,
      reviewed_at: null,
      reject_reason: null,
      cancelled_by: null,
      cancel_reason: null,
      posted_by: by,
      updated_by: by,
    });
    return this.view(saved);
  }

  /** Only while nobody holds it: a partner took it on these terms. */
  async update(
    id: string,
    dto: UpdateGigDto,
    by: string,
  ): Promise<AdminGigView> {
    const current = await this.require(id);
    if (current.status !== 'open' || current.agent_id) {
      throw conflict(
        'GIG_CLOSED',
        'A partner holds this gig, or it is closed, so it can no longer be edited.',
      );
    }
    const { starts_at, ends_at, venue_point, cohorts, payout, ...rest } = dto;
    // A validated DTO carries every declared field, `undefined` when not sent.
    const set: Partial<Gig> = {
      ...(Object.fromEntries(
        Object.entries(rest)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, v === '' ? null : v]),
      ) as Partial<Gig>),
      updated_by: by,
    };
    if (starts_at !== undefined) set.starts_at = new Date(starts_at);
    if (ends_at !== undefined) set.ends_at = new Date(ends_at);
    if (starts_at !== undefined || ends_at !== undefined) {
      timeCheck(
        set.starts_at ?? current.starts_at,
        set.ends_at ?? current.ends_at,
        starts_at !== undefined,
      );
    }
    if (venue_point !== undefined) {
      set.venue_point = venue_point
        ? { lat: venue_point.lat, lng: venue_point.lng }
        : null;
    }
    if (cohorts !== undefined) set.cohorts = [...new Set(cohorts)];
    if (payout !== undefined) {
      set.payout = payout;
      set.payout_source = payout === null ? 'cohort' : 'gig';
    }
    return this.view(
      await this.move(id, { status: 'open', agent_id: null }, { $set: set }),
    );
  }

  /** A gig anyone ever took stays for its history: cancel it instead. */
  async remove(id: string): Promise<{ deleted: true }> {
    if (await this.gigs.removeUntaken(id)) return { deleted: true };
    await this.require(id);
    throw conflict(
      'GIG_CLOSED',
      'This gig was taken before, so it cannot be deleted. Cancel it instead.',
    );
  }

  async assign(
    id: string,
    dto: AssignGigDto,
    by: string,
  ): Promise<AdminGigView> {
    const gig = await this.require(id);
    if (gig.status !== 'open') throw closed();
    const agent = await this.agents.requireByAgentId(dto.agent_id);
    if (agent.stage !== 'approved' || !agent.is_active) {
      throw badRequest(
        'VALIDATION_FAILED',
        'Only an approved, active partner can be given a gig.',
      );
    }
    if (gig.starts_at.getTime() <= Date.now()) {
      throw badRequest(
        'VALIDATION_FAILED',
        'This gig has already started — post a new one.',
      );
    }
    if (gig.cohorts.length > 0 && !gig.cohorts.includes(agent.cohort ?? '')) {
      throw badRequest(
        'VALIDATION_FAILED',
        'This gig is not for this partner’s cohort. Change the gig’s cohorts first.',
      );
    }
    const now = new Date();
    const pay =
      payoutSourceOf(gig) === 'cohort'
        ? payoutOnTake(gig, await this.takerRate(dto.agent_id))
        : {};
    const moved = await this.gigs.transition(
      id,
      // The pay as read: an edit meanwhile must not be overwritten.
      { status: 'open', agent_id: null, payout: gig.payout },
      {
        $set: {
          status: 'accepted',
          agent_id: dto.agent_id,
          accepted_at: now,
          assigned_by: by,
          ...pay,
          updated_by: by,
        },
      },
    );
    if (!moved) {
      throw conflict('GIG_TAKEN', 'Another partner took this gig first.');
    }
    return this.view(moved);
  }

  /**
   * Back to open for anyone. The partner's uploaded photos stay in the
   * bucket on purpose — kept for audit, only unlinked from the gig.
   */
  async reopen(id: string, by: string): Promise<AdminGigView> {
    const gig = await this.require(id);
    if (!HELD.includes(gig.status) || !gig.agent_id) throw closed();
    return this.view(
      await this.move(
        id,
        { status: gig.status, agent_id: gig.agent_id },
        {
          $set: {
            status: 'open',
            agent_id: null,
            accepted_at: null,
            assigned_by: null,
            check_in: null,
            attendees: [],
            photos: [],
            ...payoutOnRelease(gig),
            updated_by: by,
          },
          $push: {
            releases: { agent_id: gig.agent_id, at: new Date(), by: 'ho' },
          },
        },
      ),
    );
  }

  async cancel(id: string, reason: string, by: string): Promise<AdminGigView> {
    return this.view(
      await this.move(
        id,
        { status: { $nin: [...FINAL] } },
        {
          $set: {
            status: 'cancelled',
            cancelled_by: by,
            cancel_reason: reason,
            updated_by: by,
          },
        },
      ),
    );
  }

  async approve(id: string, by: string): Promise<AdminGigView> {
    return this.review(id, by, { status: 'approved' });
  }

  async reject(id: string, reason: string, by: string): Promise<AdminGigView> {
    return this.review(id, by, { status: 'rejected', reject_reason: reason });
  }

  private async review(
    id: string,
    by: string,
    decision: Partial<Gig>,
  ): Promise<AdminGigView> {
    return this.view(
      await this.move(
        id,
        { status: 'submitted' },
        {
          $set: {
            ...decision,
            reviewed_by: by,
            reviewed_at: new Date(),
            updated_by: by,
          },
        },
      ),
    );
  }

  /** What a cohort-paid gig pays this partner: their cohort's rate, else settings. */
  private async takerRate(agentId: string): Promise<number> {
    const [{ cohort }, settings] = await Promise.all([
      this.earning.current(agentId),
      this.settings.get(),
    ]);
    return cohortPayout(cohort.meeting_gig_payout, settings.gig_payout);
  }

  /** A transition that tells "gone" (404) from "moved meanwhile" (409). */
  private async move(
    id: string,
    when: QueryFilter<Gig>,
    update: UpdateQuery<Gig>,
  ): Promise<Gig> {
    const moved = await this.gigs.transition(id, when, update);
    if (moved) return moved;
    await this.require(id);
    throw closed();
  }

  private async require(id: string): Promise<Gig> {
    const gig = await this.gigs.find(id);
    if (!gig) throw notFound(GIG_NOT_FOUND);
    return gig;
  }

  private async view(gig: Gig): Promise<AdminGigView> {
    const phones = [...new Set(gig.attendees.map((a) => a.phone))];
    const [agent, urls, seen] = await Promise.all([
      gig.agent_id ? this.agents.requireByAgentId(gig.agent_id) : null,
      this.storage.sign(gig.photos.map((p) => p.path)),
      this.gigs.seenElsewhere(
        phones,
        new Date(gig.starts_at.getTime() - REPEAT_PHONE_DAYS * DAY_MS),
        gig._id,
      ),
    ]);
    const repeat_phones = phones.flatMap((phone): RepeatPhone[] => {
      const gigs = seen
        .filter((s) => s.phone === phone)
        .map(({ gig_id, agent_id, starts_at }) => ({
          gig_id,
          agent_id,
          starts_at,
        }));
      const partner_phone = agent?.phone === phone;
      return gigs.length > 0 || partner_phone
        ? [{ phone, partner_phone, gigs }]
        : [];
    });
    const { _id, ...rest } = gig;
    return {
      id: _id,
      ...rest,
      payout_source: payoutSourceOf(gig),
      missed: isMissed(gig, new Date()),
      partner:
        agent && gig.agent_id
          ? {
              agent_id: gig.agent_id,
              name: agent.profile?.name ?? agent.preview?.name ?? null,
              phone: agent.phone,
            }
          : null,
      photos: gig.photos.map((p) => ({
        id: p.id,
        at: p.at,
        url: urls.get(p.path) ?? null,
      })),
      repeat_phones,
    };
  }
}

function filterOf(
  query: AdminGigsQueryDto,
  from: string | undefined,
  to: string | undefined,
): GigFilter {
  const range = istDayRange(from, to);
  if (range.from && range.to && range.from >= range.to) {
    throw badRequest('VALIDATION_FAILED', '`from` must not be after `to`.');
  }
  return {
    status: query.status,
    agent_id: query.agent_id,
    state: query.state,
    district: query.district,
    ...range,
  };
}

function timeCheck(starts_at: Date, ends_at: Date, mustBeAhead: boolean): void {
  if (ends_at <= starts_at) {
    throw badRequest('VALIDATION_FAILED', 'The gig must end after it starts.');
  }
  if (mustBeAhead && starts_at <= new Date()) {
    throw badRequest('VALIDATION_FAILED', 'The gig must start in the future.');
  }
}

const closed = () =>
  conflict(
    'GIG_CLOSED',
    'This gig has moved on since you opened it. Please reload the page.',
  );
