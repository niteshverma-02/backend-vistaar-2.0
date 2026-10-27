import { HttpStatus, Injectable } from '@nestjs/common';

import type { PartnerRef } from '@common/auth/current-partner.decorator';
import {
  apiError,
  badRequest,
  conflict,
  forbidden,
  notFound,
} from '@common/errors/api-error';
import { PageResult } from '@common/http/page-result';
import {
  DAY_MS,
  istDate,
  istDayRange,
  istDayStart,
  istMonthKey,
} from '@common/utils/ist-day.util';
import { normalizeMobile } from '@common/utils/phone.util';
import { AgentsService } from '@modules/agents/services/agents.service';
import { AddFarmerDto } from '@modules/leads/dto/lead.dto';
import type { LeadStage } from '@modules/leads/leads.domain';
import {
  LeadsService,
  type InviteeCard,
  type SavedLead,
} from '@modules/leads/services/leads.service';
import { RewardsService } from '@modules/rewards/services/rewards.service';

import type {
  AdminMeetingsQueryDto,
  AttendeesDto,
  CancelMeetingDto,
  CreateMeetingDto,
  InviteesQueryDto,
  MeetingsQueryDto,
  UpdateMeetingDto,
} from '../dto/meeting.dto';
import {
  attendanceError,
  completeError,
  countsOf,
  defaultTitle,
  duplicatePhone,
  editError,
  mergeAttendees,
  type Attendee,
} from '../meetings.domain';
import {
  MeetingRepository,
  type MeetingBrief,
  type MeetingTotals,
} from '../repositories/meeting.repository';
import type { Meeting } from '../schemas/meeting.schema';
import { MeetingNotifier } from './meeting-notifier.service';

export type MeetingView = Omit<MeetingBrief, '_id' | 'agent_id'> & {
  id: string;
};

export interface AttendeeView extends Attendee {
  /** The farmer's stage with this partner now; `null` = not their lead. */
  stage: LeadStage | null;
}

export interface MeetingDetail extends MeetingView {
  attendees: AttendeeView[];
}

export interface AdminMeetingView extends MeetingView {
  agent_id: string;
  partner_name: string | null;
}

export type AdminMeetingDetail = AdminMeetingView & {
  attendees: AttendeeView[];
};

export interface MeetingSummary extends MeetingTotals {
  from: string;
  to: string;
}

/** Two tries: a capture landing between the read and the write is merged in. */
const ATTENDANCE_TRIES = 2;

const closed = (message: string) => conflict('MEETING_CLOSED', message);

function viewOf(row: MeetingBrief | Meeting): MeetingView {
  const { _id, agent_id: _a, attendees: _l, ...rest } = row as Meeting;
  return { id: _id, ...rest };
}

/**
 * Partner meetings: the partner calls their own farmers, marks who came, adds
 * walk-ins and captures leads. Only the partner writes; HO reads.
 */
@Injectable()
export class MeetingsService {
  constructor(
    private readonly meetings: MeetingRepository,
    private readonly leads: LeadsService,
    private readonly agents: AgentsService,
    private readonly notifier: MeetingNotifier,
    private readonly rewards: RewardsService,
  ) {}

  async list(
    agentId: string,
    query: MeetingsQueryDto,
  ): Promise<PageResult<MeetingView>> {
    const { rows, total } = await this.meetings.page(
      { agent_id: agentId, status: query.status },
      query.skip,
      query.limit,
      { starts_at: query.status === 'scheduled' ? 1 : -1 },
    );
    return new PageResult(rows.map(viewOf), total, query);
  }

  /** The partner's meetings starting in `[from, to)`, by status, with the farmers they reached — My Activity. */
  totalsMine(agentId: string, from: Date, to: Date): Promise<MeetingTotals> {
    return this.meetings.totals({ agent_id: agentId, from, to });
  }

  async get(agentId: string, id: string): Promise<MeetingDetail> {
    return this.detail(await this.mine(agentId, id));
  }

  async invitees(
    agentId: string,
    query: InviteesQueryDto,
  ): Promise<PageResult<InviteeCard>> {
    const all = await this.leads.invitees(agentId, query.q, query.village);
    return new PageResult(
      all.slice(query.skip, query.skip + query.limit),
      all.length,
      query,
    );
  }

  async create(agentId: string, dto: CreateMeetingDto): Promise<MeetingDetail> {
    await this.requireWorkingPartner(agentId);
    // A retry can arrive after the start time: answer with the meeting made.
    const existing = await this.meetings.find(dto.id);
    if (existing) return this.retried(existing, agentId);
    const startsAt = futureOrThrow(dto.starts_at);
    const attendees = await this.invited(agentId, dto.invite ?? []);
    const row: Omit<Meeting, 'created_at' | 'updated_at'> = {
      _id: dto.id,
      agent_id: agentId,
      type: dto.type,
      title: dto.title || defaultTitle(dto.type, dto.village),
      starts_at: startsAt,
      village: dto.village,
      venue: dto.venue || null,
      pincode: dto.pincode || null,
      organiser: dto.organiser ?? 'self',
      agenda: dto.agenda || null,
      status: 'scheduled',
      attendees,
      counts: countsOf(attendees),
      completed_at: null,
      cancelled_at: null,
      cancel_note: null,
    };
    const saved = await this.meetings.create(row);
    if (!saved) {
      const raced = await this.meetings.find(dto.id);
      if (!raced)
        throw conflict('MEETING_EXISTS', 'This meeting id is already in use.');
      return this.retried(raced, agentId);
    }
    this.notifier.scheduled(saved);
    return this.detail(saved);
  }

  async update(
    agentId: string,
    id: string,
    dto: UpdateMeetingDto,
  ): Promise<MeetingDetail> {
    const row = await this.mine(agentId, id);
    const why = editError(row.status);
    if (why) throw closed(why);
    const set: Partial<Meeting> = {};
    if (dto.type !== undefined) set.type = dto.type;
    if (dto.village !== undefined) set.village = dto.village;
    if (dto.starts_at !== undefined)
      set.starts_at = futureOrThrow(dto.starts_at);
    if (dto.venue !== undefined) set.venue = dto.venue || null;
    if (dto.pincode !== undefined) set.pincode = dto.pincode || null;
    if (dto.organiser !== undefined) set.organiser = dto.organiser;
    if (dto.agenda !== undefined) set.agenda = dto.agenda || null;
    if (dto.title !== undefined) {
      set.title =
        dto.title ||
        defaultTitle(set.type ?? row.type, set.village ?? row.village);
    }
    const saved = await this.meetings.updateScheduled(id, agentId, set);
    if (!saved) throw closed('This meeting is no longer scheduled.');
    if (set.starts_at && set.starts_at.getTime() !== row.starts_at.getTime()) {
      this.notifier.rescheduled(saved);
    }
    return this.detail(saved);
  }

  /** Cancel replaces delete: the meeting and its attendance stay on record. */
  async cancel(
    agentId: string,
    id: string,
    dto: CancelMeetingDto,
  ): Promise<MeetingDetail> {
    const row = await this.mine(agentId, id);
    const why = editError(row.status);
    if (why) throw closed(why);
    const saved = await this.meetings.updateScheduled(id, agentId, {
      status: 'cancelled',
      cancelled_at: new Date(),
      cancel_note: dto.note || null,
    });
    if (!saved) throw closed('This meeting is no longer scheduled.');
    this.notifier.cancelled(saved);
    return this.detail(saved);
  }

  async complete(agentId: string, id: string): Promise<MeetingDetail> {
    const row = await this.mine(agentId, id);
    const why = completeError(row.status, row.attendees);
    if (why) {
      throw row.status === 'scheduled'
        ? badRequest('VALIDATION_FAILED', why)
        : closed(why);
    }
    const saved = await this.meetings.updateScheduled(
      id,
      agentId,
      { status: 'completed', completed_at: new Date() },
      { 'attendees.present': true },
    );
    if (!saved) throw closed('This meeting changed — reload it and try again.');
    return this.detail(saved);
  }

  /**
   * The attendee list as it now stands. Invited farmers keep their invite;
   * anyone else is a walk-in. A phone that is one of the partner's own leads
   * is linked to it; nobody else's records are looked at.
   */
  async setAttendees(
    agentId: string,
    id: string,
    dto: AttendeesDto,
  ): Promise<MeetingDetail> {
    const sent = dto.attendees.map((a) => {
      const phone = normalizeMobile(a.phone);
      if (!phone) {
        throw badRequest(
          'VALIDATION_FAILED',
          `${a.name}: enter a valid 10-digit mobile.`,
        );
      }
      return { ...a, phone };
    });
    const twice = duplicatePhone(sent);
    if (twice) {
      throw badRequest('VALIDATION_FAILED', `${twice} is on the list twice.`);
    }
    const own = await this.leads.mineByPhones(
      agentId,
      sent.map((a) => a.phone),
    );
    for (let attempt = 1; ; attempt += 1) {
      const row = await this.mine(agentId, id);
      const why = attendanceError(row.status);
      if (why) throw closed(why);
      const invited = new Set(
        row.attendees.filter((a) => a.invited).map((a) => a.phone),
      );
      const merged: Attendee[] = mergeAttendees(
        row.attendees,
        sent.map((a) => ({
          phone: a.phone,
          name: a.name,
          village: a.village || null,
          pii_id: own.get(a.phone)?.pii_id ?? null,
          invited: invited.has(a.phone),
          present: a.present,
          walk_in: !invited.has(a.phone),
        })),
      );
      if (row.status === 'completed' && !merged.some((a) => a.present)) {
        throw badRequest(
          'VALIDATION_FAILED',
          'A held meeting needs at least one farmer present.',
        );
      }
      const saved = await this.meetings.setAttendees(
        id,
        agentId,
        row.updated_at,
        merged,
        countsOf(merged),
      );
      if (saved) return this.detail(saved);
      if (attempt >= ATTENDANCE_TRIES) {
        throw conflict(
          'VERSION_CONFLICT',
          'This meeting was saved meanwhile — reload it and try again.',
        );
      }
    }
  }

  /**
   * Adds one attendee as the partner's lead through the leads rules (consent,
   * crop, acreage, one farmer one partner), then marks them captured.
   */
  async captureLead(
    partner: PartnerRef,
    id: string,
    phone: string,
    dto: AddFarmerDto,
  ): Promise<{ meeting: MeetingDetail; lead: SavedLead }> {
    const row = await this.mine(partner.agent_id, id);
    const why = attendanceError(row.status);
    if (why) throw closed(why);
    if (!row.attendees.some((a) => a.phone === phone)) {
      throw notFound('This farmer is not on the meeting’s list.');
    }
    if (normalizeMobile(dto.phone) !== phone) {
      throw badRequest(
        'VALIDATION_FAILED',
        'The mobile does not match this attendee.',
      );
    }
    // Add-lead would update an existing lead's details; capture is for new ones.
    if ((await this.leads.mineByPhones(partner.agent_id, [phone])).has(phone)) {
      throw badRequest(
        'VALIDATION_FAILED',
        'This farmer is already your lead or customer — open them from the list.',
      );
    }
    const lead = await this.leads.upsert(
      partner,
      Object.assign(new AddFarmerDto(), dto, { found_via: 'meeting' }),
    );
    const saved = await this.meetings.markCaptured(
      id,
      partner.agent_id,
      phone,
      lead.pii_id,
    );
    // The capture can earn (the new lead itself may also pay lead_created).
    await this.rewards.meetingAttendeeCaptured(
      partner.agent_id,
      { pii_id: lead.pii_id, name: lead.name },
      id,
      dto.crops,
      dto.acreage,
    );
    // Cancelled in between: the lead stands, the meeting is shown as it is.
    return {
      meeting: await this.detail(
        saved ?? (await this.mine(partner.agent_id, id)),
      ),
      lead,
    };
  }

  /** Scheduled meetings starting today or tomorrow (IST), soonest first — Today's tasks. */
  soon(agentId: string, now: Date): Promise<MeetingView[]> {
    const from = istDayStart(now);
    return this.upcomingBetween(agentId, from, 2);
  }

  /** Scheduled meetings from now on, for the My Story invite picker. */
  upcoming(agentId: string, now: Date, days = 60): Promise<MeetingView[]> {
    return this.upcomingBetween(agentId, now, days);
  }

  // ── HO (read-only: meetings are the partner's) ─────────────────────────

  async adminList(
    query: AdminMeetingsQueryDto,
  ): Promise<PageResult<AdminMeetingView>> {
    const range = istDayRange(query.from, query.to);
    if (range.from && range.to && range.from >= range.to) {
      throw badRequest('VALIDATION_FAILED', '`from` must not be after `to`.');
    }
    const { rows, total } = await this.meetings.page(
      { agent_id: query.agent_id, status: query.status, ...range },
      query.skip,
      query.limit,
      { starts_at: -1 },
    );
    const names = await this.agents.partnersByAgentIds([
      ...new Set(rows.map((r) => r.agent_id)),
    ]);
    return new PageResult(
      rows.map((r) => ({
        ...viewOf(r),
        agent_id: r.agent_id,
        partner_name: names.get(r.agent_id)?.name ?? null,
      })),
      total,
      query,
    );
  }

  async adminGet(id: string): Promise<AdminMeetingDetail> {
    const row = await this.meetings.find(id);
    if (!row) throw notFound('Meeting not found.');
    const [detail, names] = await Promise.all([
      this.detail(row),
      this.agents.partnersByAgentIds([row.agent_id]),
    ]);
    return {
      ...detail,
      agent_id: row.agent_id,
      partner_name: names.get(row.agent_id)?.name ?? null,
    };
  }

  /** Cards for a window of IST days (default this month): meetings, farmers reached, leads. */
  async adminSummary(query: {
    from?: string;
    to?: string;
    agent_id?: string;
  }): Promise<MeetingSummary> {
    const now = new Date();
    const from = query.from ?? istMonthKey(now) + '-01';
    const to = query.to ?? istDate(now);
    const range = istDayRange(from, to);
    if (range.from && range.to && range.from >= range.to) {
      throw badRequest('VALIDATION_FAILED', '`from` must not be after `to`.');
    }
    const totals = await this.meetings.totals({
      agent_id: query.agent_id,
      ...range,
    });
    return { ...totals, from, to };
  }

  // ── helpers ────────────────────────────────────────────────────────────

  private async upcomingBetween(
    agentId: string,
    from: Date,
    days: number,
  ): Promise<MeetingView[]> {
    const until = new Date(istDayStart(from).getTime() + days * DAY_MS);
    const rows = await this.meetings.scheduledBetween(agentId, from, until);
    return rows.map(viewOf);
  }

  private retried(row: Meeting, agentId: string): Promise<MeetingDetail> {
    if (row.agent_id !== agentId) {
      throw conflict('MEETING_EXISTS', 'This meeting id is already in use.');
    }
    return this.detail(row);
  }

  private async mine(agentId: string, id: string): Promise<Meeting> {
    const row = await this.meetings.find(id);
    if (!row || row.agent_id !== agentId) throw notFound('Meeting not found.');
    return row;
  }

  private async detail(row: Meeting): Promise<MeetingDetail> {
    const stages = await this.leads.mineByPhones(
      row.agent_id,
      row.attendees.map((a) => a.phone),
    );
    return {
      ...viewOf(row),
      attendees: row.attendees.map((a) => ({
        ...a,
        stage: stages.get(a.phone)?.stage ?? null,
      })),
    };
  }

  /** The partner's own farmers named in `invite`; anyone else is left out. */
  private async invited(
    agentId: string,
    piiIds: string[],
  ): Promise<Attendee[]> {
    if (piiIds.length === 0) return [];
    const wanted = new Set(piiIds.map((p) => p.toUpperCase()));
    const mine = await this.leads.invitees(agentId, undefined, undefined);
    return mine
      .filter((f) => wanted.has(f.pii_id))
      .map((f) => ({
        phone: f.phone,
        name: f.name,
        village: f.village,
        pii_id: f.pii_id,
        invited: true,
        present: false,
        walk_in: false,
        lead_captured: false,
      }));
  }

  /** Approved partners only, as for adding farmers. */
  private async requireWorkingPartner(agentId: string): Promise<void> {
    const agent = await this.agents.requireByAgentId(agentId);
    if (agent.stage === 'blocked' || !agent.is_active) {
      throw forbidden(
        'ACCOUNT_BLOCKED',
        'This account is blocked. Contact Katyayani support.',
      );
    }
    if (agent.stage !== 'approved') {
      throw forbidden(
        'PARTNER_NOT_APPROVED',
        'You can hold meetings once your account is approved.',
      );
    }
  }
}

function futureOrThrow(value: string): Date {
  const at = new Date(value);
  if (at.getTime() <= Date.now()) {
    throw apiError(
      HttpStatus.BAD_REQUEST,
      'VALIDATION_FAILED',
      'Pick a time in the future.',
    );
  }
  return at;
}
