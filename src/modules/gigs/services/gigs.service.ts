import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import {
  badRequest,
  conflict,
  forbidden,
  notFound,
} from '@common/errors/api-error';
import { PageResult } from '@common/http/page-result';
import { normalizeMobile } from '@common/utils/phone.util';
import { AgentsService } from '@modules/agents/services/agents.service';
import { EarningCohortsService } from '@modules/earning/services/earning-cohorts.service';
import { SettingsService } from '@modules/settings/services/settings.service';
import { StorageService } from '@modules/uploads/services/storage.service';

import {
  GIG_PHOTO_TYPES,
  type AddGigPhotoDto,
  type CheckinDto,
  type GigAttendeesDto,
  type GigPhotoTicketDto,
  type GigsQueryDto,
} from '../dto/gig.dto';
import {
  FINAL,
  MAX_GIG_PHOTOS,
  checkinFlags,
  cohortPayout,
  distanceKm,
  isMissed,
  istDayOf,
  payoutOnRelease,
  payoutOnTake,
  payoutSourceOf,
  releaseError,
  submitProblems,
  type GigPoint,
  type GigStatus,
  type PayoutSource,
} from '../gigs.domain';
import { GigRepository, type GigListRow } from '../repositories/gig.repository';
import type { Gig, GigAttendee, GigCheckin } from '../schemas/gig.schema';
import { GigReadsService } from './gig-reads.service';

type AgentRecord = Awaited<ReturnType<AgentsService['requireByAgentId']>>;

/** List reads leave the proof arrays out (the repository's projection). */
type ListedGig = Omit<Gig, 'attendees' | 'photos' | 'releases'> &
  Partial<Pick<Gig, 'attendees' | 'photos'>>;

export interface GigView {
  id: string;
  title: string;
  village: string;
  district: string | null;
  state: string | null;
  venue: string | null;
  /** The pinned venue, for directions; `null` when HO did not pin it. */
  venue_point: GigPoint | null;
  starts_at: Date;
  ends_at: Date;
  expected_farmers: number;
  min_farmers: number;
  photos_required: number;
  /** ₹ — on an open cohort-paid gig, what it would pay the viewer (their cohort's rate). */
  payout: number;
  /** `cohort` = the pay is the taker's earning-cohort rate, fixed when they take it. */
  payout_source: PayoutSource;
  products: string[];
  requirements: string[];
  status: GigStatus;
  distance_km: number | null;
  /** Held past its IST day: HO cancels or reopens it. */
  missed: boolean;
  check_in: GigCheckin | null;
  /** `null` in lists, which leave the proof out. */
  attendees_count: number | null;
  photos_count: number | null;
  reject_reason: string | null;
  cancel_reason: string | null;
}

export interface GigPhotoView {
  id: string;
  /** Signed for an hour; `null` when it could not be signed. */
  url: string | null;
  at: Date;
}

export interface GigDetail extends GigView {
  attendees: GigAttendee[];
  photos: GigPhotoView[];
}

export interface GigSummary {
  available: number;
  mine: number;
  /** ₹ of approved gigs held this IST month. */
  earned_this_month: number;
  pay_enabled: boolean;
}

export interface GigPhotoTicket {
  path: string;
  upload_url: string;
  method: 'PUT';
  headers: Record<string, string>;
  expires_at: Date;
}

const MINE: readonly GigStatus[] = ['accepted', 'checked_in', 'submitted'];
const HISTORY: readonly GigStatus[] = ['approved', 'rejected', 'cancelled'];
const OPEN_TTL_MS = 60_000;
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const PHOTO_URL_TTL_MS = 15 * 60 * 1000;
const PHOTO_EXT: Record<(typeof GIG_PHOTO_TYPES)[number], string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
};
const PHOTO_FILE =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(jpg|png|webp|heic)$/;
const SAME_DAY = 'You already have a gig that day.';
const NOT_FOUND = 'Gig not found.';

const closed = (message: string) => conflict('GIG_CLOSED', message);
const changed = () => closed('This gig changed — reload it and try again.');

const photoFolder = (agentId: string, gigId: string) =>
  `vistaar/gigs/${agentId}/${gigId}/`;

const forCohort = (g: { cohorts: string[] }, cohort: string | null) =>
  g.cohorts.length === 0 || (cohort !== null && g.cohorts.includes(cohort));

/**
 * The partner's side of gigs. Partners never create or delete a gig (HO's
 * desk does); accept / release is their take and give-back, the rest is the
 * proof on a gig they hold. Every move is conditional on the state read, so
 * two partners racing for one gig get one winner.
 */
@Injectable()
export class GigsService {
  /** Each process re-reads at most once a minute; a just-taken gig is refused at accept. */
  private open: { at: number; rows: ListedGig[] } | null = null;

  constructor(
    private readonly gigs: GigRepository,
    private readonly reads: GigReadsService,
    private readonly agents: AgentsService,
    private readonly settings: SettingsService,
    private readonly storage: StorageService,
    private readonly earning: EarningCohortsService,
  ) {}

  async list(
    agentId: string,
    query: GigsQueryDto,
  ): Promise<PageResult<GigView>> {
    const now = new Date();
    const agent = await this.agents.requireByAgentId(agentId);
    const at = pointOf(agent);
    if (query.tab === 'available') {
      const rows = await this.available(agent, now);
      const page = rows.slice(query.skip, query.skip + query.limit);
      // Read the cohort only when a gig on this page pays by it.
      const rate = page.some((g) => g.payout === null)
        ? await this.takerRate(agentId)
        : null;
      return new PageResult(
        page.map((g) => viewOf(g, agentId, at, now, rate)),
        rows.length,
        query,
      );
    }
    const mine = query.tab === 'mine';
    const { rows, total } = await this.gigs.page(
      { agent_id: agentId, status: mine ? MINE : HISTORY },
      query.skip,
      query.limit,
      { starts_at: mine ? 1 : -1 },
    );
    return new PageResult(
      rows.map((g) => viewOf(g, agentId, at, now)),
      total,
      query,
    );
  }

  async summary(agentId: string): Promise<GigSummary> {
    const now = new Date();
    const agent = await this.agents.requireByAgentId(agentId);
    const [available, mine, month, settings] = await Promise.all([
      this.available(agent, now),
      this.gigs.forAgentBetween(agentId, MINE, null, null),
      this.reads.monthStats(agentId, now),
      this.settings.get(),
    ]);
    return {
      available: available.length,
      mine: mine.length,
      earned_this_month: month.earnings,
      pay_enabled: settings.gig_pay_enabled,
    };
  }

  async get(agentId: string, id: string): Promise<GigDetail> {
    const [row, agent] = await Promise.all([
      this.gigs.find(id),
      this.agents.requireByAgentId(agentId),
    ]);
    const own = row?.agent_id === agentId;
    if (
      !row ||
      (!own && !(row.status === 'open' && forCohort(row, agent.cohort)))
    ) {
      throw notFound(NOT_FOUND);
    }
    const rate = row.payout === null ? await this.takerRate(agentId) : null;
    return this.detail(row, agentId, pointOf(agent), rate);
  }

  async accept(
    agentId: string,
    id: string,
  ): Promise<GigDetail & { warning: string | null }> {
    const agent = await this.requireWorkingPartner(agentId);
    const now = new Date();
    const row = await this.gigs.find(id);
    if (!row || !(row.agent_id === agentId || forCohort(row, agent.cohort))) {
      throw notFound(NOT_FOUND);
    }
    // A double tap, or a later step already done, answers with the gig as it is.
    const saved =
      row.agent_id === agentId &&
      (['accepted', 'checked_in', 'submitted'] as const).some(
        (s) => s === row.status,
      )
        ? row
        : await this.take(agentId, row, now);
    const day = istDayOf(saved.starts_at);
    const others = await this.gigs.heldBetween(agentId, day.from, day.to, id);
    return {
      ...(await this.detail(saved, agentId, pointOf(agent))),
      warning: others > 0 ? SAME_DAY : null,
    };
  }

  async release(agentId: string, id: string): Promise<GigDetail> {
    const row = await this.mine(agentId, id);
    if (row.status !== 'accepted') {
      throw closed('Only a gig you have not checked in to can be given back.');
    }
    const now = new Date();
    const why = releaseError(row.starts_at, now);
    if (why) throw closed(why);
    const saved = await this.gigs.transition(
      id,
      { status: 'accepted', agent_id: agentId },
      {
        $set: {
          status: 'open',
          agent_id: null,
          accepted_at: null,
          assigned_by: null,
          ...payoutOnRelease(row),
          updated_by: agentId,
        },
        $push: { releases: { agent_id: agentId, at: now, by: 'partner' } },
      },
    );
    if (!saved) throw changed();
    this.open = null;
    return this.detail(saved, agentId, null);
  }

  /** Server time and the flags HO reviews; nothing here refuses a check-in. */
  async checkIn(
    agentId: string,
    id: string,
    dto: CheckinDto,
  ): Promise<GigDetail> {
    const row = await this.mine(agentId, id);
    if (row.status === 'checked_in') return this.detail(row, agentId, null);
    if (row.status !== 'accepted')
      throw closed('This gig is not yours to check in to.');
    const now = new Date();
    const point = dto.location ?? null;
    const radius = (await this.settings.get()).gig_checkin_radius_m;
    const check_in: GigCheckin = {
      lat: point?.lat ?? null,
      lng: point?.lng ?? null,
      accuracy_m: dto.accuracy_m ?? null,
      at: now,
      ...checkinFlags(row, point, now, radius),
    };
    const saved = await this.gigs.transition(
      id,
      { status: 'accepted', agent_id: agentId },
      { $set: { status: 'checked_in', check_in, updated_by: agentId } },
    );
    if (!saved) throw changed();
    return this.detail(saved, agentId, null);
  }

  /** The whole list of farmers present, as it now stands. */
  async setAttendees(
    agentId: string,
    id: string,
    dto: GigAttendeesDto,
  ): Promise<GigDetail> {
    const seen = new Set<string>();
    const attendees: GigAttendee[] = dto.attendees.map((a) => {
      const phone = normalizeMobile(a.phone);
      if (!phone) {
        throw badRequest(
          'VALIDATION_FAILED',
          `${a.name}: enter a valid 10-digit mobile.`,
        );
      }
      if (seen.has(phone)) {
        throw badRequest('VALIDATION_FAILED', `${phone} is on the list twice.`);
      }
      seen.add(phone);
      return { phone, name: a.name, village: a.village || null };
    });
    await this.checkedIn(agentId, id);
    const saved = await this.gigs.transition(
      id,
      { status: 'checked_in', agent_id: agentId },
      { $set: { attendees, updated_by: agentId } },
    );
    if (!saved) throw changed();
    return this.detail(saved, agentId, null);
  }

  /** A one-photo PUT straight to the bucket, in this gig's folder of the partner. */
  async photoTicket(
    agentId: string,
    id: string,
    dto: GigPhotoTicketDto,
  ): Promise<GigPhotoTicket> {
    if (dto.size > PHOTO_MAX_BYTES) {
      throw badRequest(
        'FILE_TOO_LARGE',
        'This photo is too big. Please choose one smaller than 5 MB.',
      );
    }
    const row = await this.checkedIn(agentId, id);
    if (row.photos.length >= MAX_GIG_PHOTOS) throw tooManyPhotos();
    const path = `${photoFolder(agentId, id)}${randomUUID()}.${PHOTO_EXT[dto.content_type]}`;
    const { url, headers, expires } = await this.storage.signedUpload(
      path,
      dto.content_type,
      PHOTO_MAX_BYTES,
      PHOTO_URL_TTL_MS,
    );
    return {
      path,
      upload_url: url,
      method: 'PUT',
      headers,
      expires_at: expires,
    };
  }

  async addPhoto(
    agentId: string,
    id: string,
    dto: AddGigPhotoDto,
  ): Promise<GigDetail> {
    const row = await this.checkedIn(agentId, id);
    const { path } = dto;
    if (row.photos.some((p) => p.path === path)) {
      return this.detail(row, agentId, null);
    }
    if (row.photos.length >= MAX_GIG_PHOTOS) throw tooManyPhotos();
    const folder = photoFolder(agentId, id);
    const name = path.startsWith(folder)
      ? PHOTO_FILE.exec(path.slice(folder.length))
      : null;
    const file = name ? await this.storage.stat(path) : null;
    if (
      !name ||
      !file ||
      file.size > PHOTO_MAX_BYTES ||
      !(GIG_PHOTO_TYPES as readonly string[]).includes(file.contentType)
    ) {
      throw badRequest(
        'MEDIA_NOT_FOUND',
        'The photo did not finish uploading. Please upload it again.',
      );
    }
    const saved = await this.gigs.transition(
      id,
      {
        status: 'checked_in',
        agent_id: agentId,
        'photos.path': { $ne: path },
        [`photos.${MAX_GIG_PHOTOS - 1}`]: { $exists: false },
      },
      {
        $push: { photos: { id: name[1], path, at: new Date() } },
        $set: { updated_by: agentId },
      },
    );
    if (!saved) throw changed();
    return this.detail(saved, agentId, null);
  }

  async removePhoto(
    agentId: string,
    id: string,
    photoId: string,
  ): Promise<GigDetail> {
    const row = await this.checkedIn(agentId, id);
    const photo = row.photos.find((p) => p.id === photoId.toLowerCase());
    // Already gone: a retried delete answers with the gig as it is.
    if (!photo) return this.detail(row, agentId, null);
    const saved = await this.gigs.transition(
      id,
      { status: 'checked_in', agent_id: agentId },
      { $pull: { photos: { id: photo.id } }, $set: { updated_by: agentId } },
    );
    if (!saved) throw changed();
    await this.storage.remove(photo.path);
    return this.detail(saved, agentId, null);
  }

  async submit(agentId: string, id: string): Promise<GigDetail> {
    const row = await this.mine(agentId, id);
    if (row.status === 'submitted') return this.detail(row, agentId, null);
    if (row.status !== 'checked_in') throw closed('Check in at the gig first.');
    const problems = submitProblems(
      row,
      row.attendees.length,
      row.photos.length,
    );
    if (problems.length > 0) {
      throw badRequest('VALIDATION_FAILED', problems[0], problems);
    }
    const saved = await this.gigs.transition(
      id,
      { status: 'checked_in', agent_id: agentId },
      {
        $set: {
          status: 'submitted',
          submitted_at: new Date(),
          updated_by: agentId,
        },
      },
    );
    if (!saved) throw changed();
    return this.detail(saved, agentId, null);
  }

  // ── helpers ────────────────────────────────────────────────────────────

  /** Open gigs this partner may take: cohort, same state when both are known; nearest first. */
  private async available(agent: AgentRecord, now: Date): Promise<ListedGig[]> {
    const state =
      (agent.profile?.state ?? agent.preview.state)?.toUpperCase() ?? null;
    const at = pointOf(agent);
    const rows = (await this.openRows()).filter(
      (g) =>
        g.starts_at > now &&
        forCohort(g, agent.cohort) &&
        (!state || !g.state || g.state === state),
    );
    if (!at) return rows;
    // Stable: unknown distances keep the soonest-first order, after the known ones.
    const km = (g: ListedGig) => distanceKm(at, g.venue_point) ?? Infinity;
    return [...rows].sort((a, b) => km(a) - km(b));
  }

  private async openRows(): Promise<ListedGig[]> {
    if (this.open && Date.now() - this.open.at < OPEN_TTL_MS) {
      return this.open.rows;
    }
    const rows: ListedGig[] = await this.gigs.openFrom(new Date());
    this.open = { at: Date.now(), rows };
    return rows;
  }

  private async take(agentId: string, row: Gig, now: Date): Promise<Gig> {
    if (row.status !== 'open') throw taken(row);
    if (row.starts_at <= now) throw closed('This gig has already started.');
    const pay =
      payoutSourceOf(row) === 'cohort'
        ? payoutOnTake(row, await this.takerRate(agentId))
        : {};
    const saved = await this.gigs.transition(
      row._id,
      // The pay as read: HO changing it meanwhile must not be overwritten.
      {
        status: 'open',
        agent_id: null,
        starts_at: { $gt: now },
        payout: row.payout,
      },
      {
        $set: {
          status: 'accepted',
          agent_id: agentId,
          accepted_at: now,
          assigned_by: null,
          ...pay,
          updated_by: agentId,
        },
      },
    );
    if (!saved) throw gigTaken();
    this.open = null;
    return saved;
  }

  private async mine(agentId: string, id: string): Promise<Gig> {
    const row = await this.gigs.find(id);
    if (!row || row.agent_id !== agentId) throw notFound(NOT_FOUND);
    return row;
  }

  private async checkedIn(agentId: string, id: string): Promise<Gig> {
    const row = await this.mine(agentId, id);
    if (row.status !== 'checked_in') {
      throw closed(
        row.status === 'accepted'
          ? 'Check in at the gig first.'
          : 'This gig’s proof can no longer be changed.',
      );
    }
    return row;
  }

  private async detail(
    row: Gig,
    agentId: string,
    at: GigPoint | null,
    rate: number | null = null,
  ): Promise<GigDetail> {
    const own = row.agent_id === agentId;
    const photos = own ? row.photos : [];
    const urls = await this.storage.sign(photos.map((p) => p.path));
    return {
      ...viewOf(row, agentId, at, new Date(), rate),
      attendees: own ? row.attendees : [],
      photos: photos.map((p) => ({
        id: p.id,
        url: urls.get(p.path) ?? null,
        at: p.at,
      })),
    };
  }

  /** What a cohort-paid gig pays this partner if they take it now. */
  private async takerRate(agentId: string): Promise<number> {
    const [{ cohort }, settings] = await Promise.all([
      this.earning.current(agentId),
      this.settings.get(),
    ]);
    return cohortPayout(cohort.meeting_gig_payout, settings.gig_payout);
  }

  /** Approved partners only, as for meetings. */
  private async requireWorkingPartner(agentId: string): Promise<AgentRecord> {
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
        'You can take gigs once your account is approved.',
      );
    }
    return agent;
  }
}

const gigTaken = () =>
  conflict('GIG_TAKEN', 'Another partner has just taken this gig.');

/** Held by another partner, or decided / cancelled. */
function taken(row: Gig) {
  return row.agent_id && !FINAL.includes(row.status)
    ? gigTaken()
    : closed('This gig is no longer open.');
}

function tooManyPhotos() {
  return badRequest(
    'VALIDATION_FAILED',
    `A gig takes at most ${MAX_GIG_PHOTOS} photos. Remove one first.`,
  );
}

function pointOf(agent: AgentRecord): GigPoint | null {
  const c = agent.location?.coordinates;
  return c ? { lat: c[1], lng: c[0] } : null;
}

/**
 * Proof and review fields only on the caller's own gig — never another
 * partner's. `rate` = the viewer's cohort pay, shown on an open cohort-paid gig.
 */
function viewOf(
  g: ListedGig,
  agentId: string,
  at: GigPoint | null,
  now: Date,
  rate: number | null = null,
): GigView {
  const own = g.agent_id === agentId;
  return {
    id: g._id,
    title: g.title,
    village: g.village,
    district: g.district,
    state: g.state,
    venue: g.venue,
    venue_point: g.venue_point,
    starts_at: g.starts_at,
    ends_at: g.ends_at,
    expected_farmers: g.expected_farmers,
    min_farmers: g.min_farmers,
    photos_required: g.photos_required,
    payout: g.payout ?? rate ?? 0,
    payout_source: payoutSourceOf(g),
    products: g.products,
    requirements: g.requirements,
    status: g.status,
    distance_km: distanceKm(at, g.venue_point),
    missed: own && isMissed(g, now),
    check_in: own ? g.check_in : null,
    attendees_count: own
      ? (g.attendees?.length ?? (g as GigListRow).attendees_count ?? null)
      : 0,
    photos_count: own
      ? (g.photos?.length ?? (g as GigListRow).photos_count ?? null)
      : 0,
    reject_reason: own ? g.reject_reason : null,
    cancel_reason: own ? g.cancel_reason : null,
  };
}
