import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { Types } from 'mongoose';

import type { PartnerRef } from '@common/auth/current-partner.decorator';
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
} from '@common/errors/api-error';
import { PageResult } from '@common/http/page-result';
import { normalizeMobile } from '@common/utils/phone.util';
import { AgentsService } from '@modules/agents/services/agents.service';
import { LeadsService } from '@modules/leads/services/leads.service';
import {
  SettingsService,
  type FarmerConsent,
} from '@modules/settings/services/settings.service';
import { StorageService } from '@modules/uploads/services/storage.service';

import type {
  AdminSubmissionQueryDto,
  LibraryQueryDto,
  MineQueryDto,
  SubmitTestimonialDto,
  UploadRequestDto,
  UploadTicketDto,
} from '../dto/submission.dto';
import {
  ConsentRepository,
  type ConsentRow,
} from '../repositories/consent.repository';
import { ReviewRepository } from '../repositories/review.repository';
import {
  SubmissionRepository,
  type SubmissionRow,
} from '../repositories/submission.repository';
import { TestimonialRepository } from '../repositories/testimonial.repository';
import {
  ACTION_FROM,
  MEDIA_TYPE_OF,
  UPLOAD_RULES,
  UPLOAD_URL_TTL_MS,
  canAct,
  mediaPathFor,
  ownsMedia,
  toContact,
  type MediaType,
  type SubmissionKind,
  type SubmissionStatus,
} from '../testimonials.domain';

export interface SubmissionMediaView {
  media_type: MediaType;
  /** Signed for an hour while undecided; the lasting link once approved. */
  url: string | null;
  duration_sec: number | null;
}

interface ProductView {
  bulk: string | null;
  family: string | null;
  name: string | null;
}

/** "My submissions". */
export interface MySubmissionView {
  id: string;
  status: SubmissionStatus;
  /** HO's reason for a rejection or removal. */
  reason: string | null;
  kind: SubmissionKind;
  farmer: { pii_id: string; name: string; village: string | null };
  product: ProductView;
  crop: string;
  text: string;
  rating: number;
  media: SubmissionMediaView | null;
  views: number;
  shares: number;
  /** Coins come with the wallet; `null` until then. */
  coins_awarded: number | null;
  gig_id: string | null;
  created_at: Date;
  decided_at: Date | null;
}

/** The library card — every partner sees it, so no phone and no `pii_id`. */
export interface LibraryItemView {
  id: string;
  farmer: {
    name: string;
    village: string | null;
    district: string | null;
    state: string | null;
  };
  partner_name: string | null;
  product: ProductView;
  crop: string;
  kind: SubmissionKind;
  text: string;
  rating: number;
  media: SubmissionMediaView | null;
  views: number;
  shares: number;
  created_at: Date;
}

export interface ConsentView {
  version: number;
  lang: string;
  text: string;
  given_at: Date;
  status: 'given' | 'withdrawn';
  withdrawn_at: Date | null;
  withdrawn_by: string | null;
  withdrawn_reason: string | null;
}

export interface AdminSubmissionView extends MySubmissionView {
  agent_id: string;
  partner_name: string | null;
  farmer: MySubmissionView['farmer'] & {
    contact: string;
    district: string | null;
    state: string | null;
  };
  decided_by: string | null;
  /** The shared rows an approval writes (Stockship's ids). */
  review_id: string;
  testimonial_id: string | null;
  consent: ConsentView | null;
  updated_at: Date;
}

const NOT_FOUND = 'This testimonial could not be found.';

@Injectable()
export class SubmissionsService {
  constructor(
    private readonly submissions: SubmissionRepository,
    private readonly consents: ConsentRepository,
    private readonly reviews: ReviewRepository,
    private readonly testimonials: TestimonialRepository,
    private readonly storage: StorageService,
    private readonly leads: LeadsService,
    private readonly agents: AgentsService,
    private readonly settings: SettingsService,
  ) {}

  // -------------------------------------------------------------- partner

  async consent(): Promise<FarmerConsent> {
    return (await this.settings.get()).testimonial_consent;
  }

  /** A one-file PUT straight to the bucket, in the partner's own folder. */
  async uploadTicket(
    partner: PartnerRef,
    dto: UploadRequestDto,
  ): Promise<UploadTicketDto> {
    const rule = UPLOAD_RULES[dto.kind];
    const ext = rule.types[dto.content_type];
    if (!ext) {
      throw badRequest(
        'FILE_TYPE_NOT_ALLOWED',
        dto.kind === 'video'
          ? 'This video type is not allowed. Please record an MP4 or MOV video.'
          : 'This photo type is not allowed. Please choose a JPG, PNG, WEBP or HEIC photo.',
      );
    }
    if (dto.size > rule.maxBytes) {
      throw badRequest(
        'FILE_TOO_LARGE',
        dto.kind === 'video'
          ? 'This video is too big. Please record a shorter clip (under 1 minute).'
          : `This photo is too big. Please choose one smaller than ${rule.maxBytes / (1024 * 1024)} MB.`,
      );
    }
    const path = mediaPathFor(partner.agent_id, dto.kind, randomUUID(), ext);
    const { url, headers, expires } = await this.storage.signedUpload(
      path,
      dto.content_type,
      rule.maxBytes,
      UPLOAD_URL_TTL_MS,
    );
    return {
      path,
      upload_url: url,
      method: 'PUT',
      headers,
      expires_at: expires,
    };
  }

  /**
   * Sent to HO for approval. Every refusal comes before the first write; the
   * consent is written before the submission, so a submission never exists
   * without one. A retry with the same id answers the first.
   */
  async submit(
    partner: PartnerRef,
    dto: SubmitTestimonialDto,
  ): Promise<MySubmissionView> {
    const id = dto.id.toLowerCase();
    const again = await this.submissions.findMine(partner.agent_id, id);
    if (again) return this.mineView(again);

    const agent = await this.agents.requireByAgentId(partner.agent_id);
    if (agent.stage === 'blocked' || !agent.is_active) {
      throw forbidden(
        'ACCOUNT_BLOCKED',
        'This account is blocked. Contact Katyayani support.',
      );
    }
    if (agent.stage !== 'approved') {
      throw forbidden(
        'PARTNER_NOT_APPROVED',
        'You can send testimonials once your account is approved.',
      );
    }

    const consent = await this.consent();
    if (dto.consent_version !== consent.version) {
      throw conflict(
        'CONSENT_OUTDATED',
        'The consent wording has changed — show the farmer the new text and ask again.',
        [`current_version=${consent.version}`],
      );
    }
    const consentText =
      dto.consent_lang === 'hi'
        ? (consent.text.hi ?? consent.text.en)
        : consent.text.en;

    // Not one of the partner's farmers answers 404, the same as no farmer.
    const farmer = await this.leads.getMine(partner, dto.pii_id);
    const product = await this.productOf(dto.bulk, dto.family);
    const text = dto.text?.trim() ?? '';
    const media = await this.mediaOf(partner.agent_id, dto, text);

    const now = new Date();
    const piiId = dto.pii_id.toUpperCase();
    await this.consents.insert({
      _id: id,
      agent_id: partner.agent_id,
      pii_id: piiId,
      farmer_name: farmer.name,
      version: consent.version,
      text: consentText,
      lang: dto.consent_lang,
      given_at: now,
    });
    const inserted = await this.submissions.insert({
      _id: id,
      agent_id: partner.agent_id,
      partner_name: agent.profile?.name ?? agent.preview?.name ?? null,
      pii_id: piiId,
      farmer_name: farmer.name,
      farmer_contact: toContact(normalizeMobile(farmer.phone) ?? farmer.phone),
      village: farmer.village ?? null,
      district: farmer.district ?? null,
      state: farmer.state ?? null,
      type: product.bulk ? 'product' : 'combo',
      bulk: product.bulk,
      family: product.family,
      product_name: product.name,
      crop: dto.crop.trim(),
      kind: dto.kind,
      text,
      rating: dto.rating,
      media_path: media?.path ?? null,
      duration_sec: media?.duration_sec ?? null,
      review_id: new Types.ObjectId(),
      testimonial_id: dto.kind === 'text' ? null : new Types.ObjectId(),
      gig_id: null,
    });
    const row = await this.submissions.findMine(partner.agent_id, id);
    // Taken by another partner's row — a UUID the app did not make itself.
    if (!inserted && !row) {
      throw badRequest(
        'VALIDATION_FAILED',
        'This testimonial could not be sent. Please try again.',
      );
    }
    return this.mineView(row!);
  }

  async mine(
    partner: PartnerRef,
    query: MineQueryDto,
  ): Promise<PageResult<MySubmissionView>> {
    const { rows, total } = await this.submissions.pageMine(
      partner.agent_id,
      query.status,
      query.skip,
      query.limit,
    );
    const urls = await this.signUndecided(rows);
    return new PageResult(
      rows.map((r) => toMine(r, urls)),
      total,
      query,
    );
  }

  async getMine(partner: PartnerRef, id: string): Promise<MySubmissionView> {
    const row = await this.submissions.findMine(
      partner.agent_id,
      id.toLowerCase(),
    );
    if (!row) throw notFound(NOT_FOUND);
    return this.mineView(row);
  }

  /** Approved stories from every partner. Approved media is already public: nothing to sign. */
  async library(query: LibraryQueryDto): Promise<PageResult<LibraryItemView>> {
    const { rows, total } = await this.submissions.library(
      {
        q: query.q,
        bulk: query.bulk,
        family: query.family,
        crop: query.crop,
        kind: query.kind,
        state: query.state,
        district: query.district,
      },
      query.skip,
      query.limit,
      query.sort === 'newest' ? 'newest' : 'shared',
    );
    return new PageResult(rows.map(toLibrary), total, query);
  }

  /** Counted only while it is in the library; anything else is "not found". */
  async count(
    id: string,
    field: 'views' | 'shares',
  ): Promise<{ views: number; shares: number }> {
    const counts = await this.submissions.bump(id.toLowerCase(), field);
    if (!counts) throw notFound(NOT_FOUND);
    return counts;
  }

  // -------------------------------------------------------------- HO

  async list(
    query: AdminSubmissionQueryDto,
  ): Promise<PageResult<AdminSubmissionView>> {
    const { rows, total } = await this.submissions.adminPage(
      {
        status: query.status,
        kind: query.kind,
        agent_id: query.agent_id?.toUpperCase(),
        q: query.q,
      },
      query.skip,
      query.limit,
      query.sortSpec,
    );
    const [urls, consents] = await Promise.all([
      this.signUndecided(rows),
      this.consents.findMany(rows.map((r) => r._id)),
    ]);
    return new PageResult(
      rows.map((r) => toAdmin(r, urls, consents.get(r._id) ?? null)),
      total,
      query,
    );
  }

  summary(): Promise<Record<SubmissionStatus, number>> {
    return this.submissions.counts();
  }

  async get(id: string): Promise<AdminSubmissionView> {
    const row = await this.require(id);
    return this.adminView(row);
  }

  /**
   * Shown on the product page and in the library: the shared rows are written
   * (or shown again), the media gets its lasting link, then the status moves.
   * If a removal or withdrawal won the race meanwhile, the rows go hidden again.
   */
  async approve(id: string, by: string): Promise<AdminSubmissionView> {
    const row = await this.require(id);
    this.allow('approve', row.status);
    const consent = await this.consents.find(row._id);
    if (consent?.status === 'withdrawn') {
      throw conflict(
        'CONSENT_WITHDRAWN',
        'The farmer withdrew consent for this testimonial. It cannot be shown again.',
      );
    }

    const mediaUrl = row.media_path
      ? await this.storage.publish(row.media_path)
      : null;
    await this.showShared(row, mediaUrl, by);
    // A withdrawal marks the consent before it erases, so a withdrawal that
    // erased before our write above is seen here — and its erase is redone.
    if ((await this.consents.find(row._id))?.status === 'withdrawn') {
      await this.eraseShared(row);
      throw conflict(
        'CONSENT_WITHDRAWN',
        'The farmer withdrew consent for this testimonial. It cannot be shown again.',
      );
    }

    const now = new Date();
    const moved = await this.submissions.transition(row._id, [row.status], {
      status: 'approved',
      reason: null,
      media_url: mediaUrl,
      decided_by: by,
      decided_at: now,
      approved_at: now,
    });
    if (!moved) {
      const latest = await this.require(row._id);
      if (latest.status !== 'approved') await this.takeDown(latest, by);
      throw changedMeanwhile();
    }
    return this.adminView(moved);
  }

  /** Not shown anywhere, and the partner is told why. Nothing shared was written. */
  async reject(
    id: string,
    reason: string,
    by: string,
  ): Promise<AdminSubmissionView> {
    const row = await this.require(id);
    this.allow('reject', row.status);
    const moved = await this.submissions.transition(
      row._id,
      ACTION_FROM.reject,
      {
        status: 'rejected',
        reason: reason.trim(),
        decided_by: by,
        decided_at: new Date(),
      },
    );
    if (!moved) throw changedMeanwhile();
    return this.adminView(moved);
  }

  /** Taken down after approval; approving again puts it back. */
  async remove(
    id: string,
    reason: string | undefined,
    by: string,
  ): Promise<AdminSubmissionView> {
    const row = await this.require(id);
    this.allow('remove', row.status);
    await this.hideShared(row, by);
    const moved = await this.submissions.transition(
      row._id,
      ACTION_FROM.remove,
      {
        status: 'removed',
        reason: reason?.trim() || null,
        media_url: null,
        decided_by: by,
        decided_at: new Date(),
      },
    );
    if (!moved) throw changedMeanwhile();
    return this.adminView(moved);
  }

  /**
   * The farmer asked for it to come down: the consent is marked withdrawn
   * (and kept — it is the record), the shared rows and the file are erased,
   * and the testimonial can never be approved again.
   */
  async withdrawConsent(
    id: string,
    reason: string,
    by: string,
  ): Promise<AdminSubmissionView> {
    const row = await this.require(id);
    const now = new Date();
    const withdrawn = await this.consents.withdraw(
      row._id,
      by,
      reason.trim(),
      now,
    );
    // Already withdrawn: a retry finishes one that failed part-way; a
    // finished one (removed, file gone) is refused as before.
    const finished = row.status === 'removed' && !row.media_path;
    if (
      !withdrawn &&
      (finished || (await this.consents.find(row._id))?.status !== 'withdrawn')
    ) {
      throw conflict(
        'CONSENT_WITHDRAWN',
        'Consent for this testimonial was already withdrawn.',
      );
    }

    await this.eraseShared(row);

    const moved = await this.submissions.transition(
      row._id,
      ['submitted', 'approved', 'rejected', 'removed'],
      {
        status: 'removed',
        reason: 'The farmer withdrew consent.',
        media_path: null,
        media_url: null,
        decided_by: by,
        decided_at: now,
      },
    );
    return this.adminView(moved ?? row);
  }

  // -------------------------------------------------------------- helpers

  private async require(id: string): Promise<SubmissionRow> {
    const row = await this.submissions.find(id.toLowerCase());
    if (!row) throw notFound(NOT_FOUND);
    return row;
  }

  private allow(
    action: 'approve' | 'reject' | 'remove',
    status: SubmissionStatus,
  ): void {
    if (!canAct(action, status)) {
      throw conflict(
        'TESTIMONIAL_NOT_ALLOWED',
        `This testimonial is ${status}; it cannot be ${
          { approve: 'approved', reject: 'rejected', remove: 'removed' }[action]
        } now. Please reload it.`,
      );
    }
  }

  private async showShared(
    row: SubmissionRow,
    mediaUrl: string | null,
    by: string,
  ): Promise<void> {
    const user = {
      contact: row.farmer_contact,
      name: row.farmer_name,
      profile_image: null,
    };
    await this.reviews.show(
      row.review_id,
      {
        rating: row.rating,
        review: row.text,
        images: [],
        pii_id: row.pii_id,
        user: { ...user, email: null },
        type: row.type,
        bulk: row.bulk,
        family: row.family,
      },
      by,
    );
    if (row.testimonial_id && row.kind !== 'text' && mediaUrl) {
      await this.testimonials.show(
        row.testimonial_id,
        {
          type: row.type,
          bulk: row.bulk,
          family: row.family,
          media: { media_type: MEDIA_TYPE_OF[row.kind], media_url: mediaUrl },
          review: row.text,
          pii_id: row.pii_id,
          user,
        },
        by,
      );
    }
  }

  /** Gone for good (consent withdrawn): every step is safe to run twice. */
  private async eraseShared(row: SubmissionRow): Promise<void> {
    await this.reviews.erase(row.review_id);
    if (row.testimonial_id) await this.testimonials.erase(row.testimonial_id);
    if (row.media_path) await this.storage.remove(row.media_path);
  }

  /** Off the product page: erased when consent is withdrawn, else only hidden. */
  private async takeDown(row: SubmissionRow, by: string): Promise<void> {
    if ((await this.consents.find(row._id))?.status === 'withdrawn')
      await this.eraseShared(row);
    else await this.hideShared(row, by);
  }

  private async hideShared(row: SubmissionRow, by: string): Promise<void> {
    await this.reviews.hide(row.review_id, by);
    if (row.testimonial_id)
      await this.testimonials.hide(row.testimonial_id, by);
    if (row.media_path) await this.storage.unpublish(row.media_path);
  }

  /** Stockship's catalogue is the list; its name is kept for the library cards. */
  private async productOf(
    rawBulk: string | undefined,
    rawFamily: string | undefined,
  ): Promise<ProductView> {
    const bulk = rawBulk?.trim() || null;
    const family = rawFamily?.trim() || null;
    if (!bulk === !family) {
      throw invalid('Please choose either a product or a combo (not both).');
    }
    if (bulk) {
      const names = await this.testimonials.tradeNames([bulk]);
      if (!names.has(bulk) && !(await this.testimonials.productExists(bulk))) {
        throw productNotFound();
      }
      return { bulk, family: null, name: names.get(bulk) ?? null };
    }
    if (!(await this.testimonials.comboExists(family!)))
      throw productNotFound();
    return {
      bulk: null,
      family,
      name: await this.testimonials.comboName(family!),
    };
  }

  /**
   * A quote needs words and no file; a video or photo needs its own upload,
   * of its kind, actually in the bucket and within the size the kind allows.
   */
  private async mediaOf(
    agentId: string,
    dto: SubmitTestimonialDto,
    text: string,
  ): Promise<{ path: string; duration_sec: number | null } | null> {
    if (dto.kind === 'text') {
      if (text.length < 2) throw invalid("Please write the farmer's words.");
      if (dto.media_path) {
        throw invalid('A quote has no photo or video. Please remove it.');
      }
      return null;
    }
    const path = dto.media_path?.trim();
    if (!path) {
      throw invalid(
        dto.kind === 'video'
          ? 'Please record the video first.'
          : 'Please take the photo first.',
      );
    }
    if (dto.kind === 'video' && !dto.duration_sec) {
      throw invalid('The video length is missing. Please record it again.');
    }
    const rule = UPLOAD_RULES[dto.kind];
    // One file, one testimonial: erasing one (consent withdrawn) deletes the file.
    if (await this.submissions.mediaTaken(agentId, path)) {
      throw invalid(
        'This photo or video is already on another testimonial. Please upload it again.',
      );
    }
    const file = ownsMedia(agentId, dto.kind, path)
      ? await this.storage.stat(path)
      : null;
    if (
      !file ||
      file.size > rule.maxBytes ||
      !(file.contentType in rule.types)
    ) {
      throw badRequest(
        'MEDIA_NOT_FOUND',
        dto.kind === 'video'
          ? 'The video did not finish uploading. Please upload it again.'
          : 'The photo did not finish uploading. Please upload it again.',
      );
    }
    return {
      path,
      duration_sec: dto.kind === 'video' ? (dto.duration_sec ?? null) : null,
    };
  }

  /** Approved rows carry their lasting link; the rest are signed for an hour. */
  private signUndecided(rows: SubmissionRow[]): Promise<Map<string, string>> {
    return this.storage.sign(
      rows.flatMap((r) => (r.media_path && !r.media_url ? [r.media_path] : [])),
    );
  }

  private async mineView(row: SubmissionRow): Promise<MySubmissionView> {
    return toMine(row, await this.signUndecided([row]));
  }

  private async adminView(row: SubmissionRow): Promise<AdminSubmissionView> {
    const [urls, consent] = await Promise.all([
      this.signUndecided([row]),
      this.consents.find(row._id),
    ]);
    return toAdmin(row, urls, consent);
  }
}

function invalid(message: string) {
  return badRequest('VALIDATION_FAILED', message, [message]);
}

const productNotFound = () =>
  badRequest(
    'PRODUCT_NOT_FOUND',
    'This product could not be found. Please choose it again from the list.',
  );

const changedMeanwhile = () =>
  conflict(
    'TESTIMONIAL_NOT_ALLOWED',
    'Someone else changed this testimonial just now. Please reload it.',
  );

function mediaOf(
  r: SubmissionRow,
  urls: Map<string, string>,
): SubmissionMediaView | null {
  if (r.kind === 'text') return null;
  return {
    media_type: MEDIA_TYPE_OF[r.kind],
    url:
      r.media_url ?? (r.media_path ? (urls.get(r.media_path) ?? null) : null),
    duration_sec: r.duration_sec,
  };
}

const productOfRow = (r: SubmissionRow): ProductView => ({
  bulk: r.bulk,
  family: r.family,
  name: r.product_name,
});

export function toMine(
  r: SubmissionRow,
  urls: Map<string, string>,
): MySubmissionView {
  return {
    id: r._id,
    status: r.status,
    reason: r.reason,
    kind: r.kind,
    farmer: { pii_id: r.pii_id, name: r.farmer_name, village: r.village },
    product: productOfRow(r),
    crop: r.crop,
    text: r.text,
    rating: r.rating,
    media: mediaOf(r, urls),
    views: r.views,
    shares: r.shares,
    coins_awarded: null,
    gig_id: r.gig_id,
    created_at: r.created_at,
    decided_at: r.decided_at,
  };
}

export function toLibrary(r: SubmissionRow): LibraryItemView {
  return {
    id: r._id,
    farmer: {
      name: r.farmer_name,
      village: r.village,
      district: r.district,
      state: r.state,
    },
    partner_name: r.partner_name,
    product: productOfRow(r),
    crop: r.crop,
    kind: r.kind,
    text: r.text,
    rating: r.rating,
    media: mediaOf(r, new Map()),
    views: r.views,
    shares: r.shares,
    created_at: r.created_at,
  };
}

function toAdmin(
  r: SubmissionRow,
  urls: Map<string, string>,
  consent: ConsentRow | null,
): AdminSubmissionView {
  const mine = toMine(r, urls);
  return {
    ...mine,
    agent_id: r.agent_id,
    partner_name: r.partner_name,
    farmer: {
      ...mine.farmer,
      contact: r.farmer_contact,
      district: r.district,
      state: r.state,
    },
    decided_by: r.decided_by,
    review_id: r.review_id.toHexString(),
    testimonial_id: r.testimonial_id?.toHexString() ?? null,
    consent: consent
      ? {
          version: consent.version,
          lang: consent.lang,
          text: consent.text,
          given_at: consent.given_at,
          status: consent.status,
          withdrawn_at: consent.withdrawn_at,
          withdrawn_by: consent.withdrawn_by,
          withdrawn_reason: consent.withdrawn_reason,
        }
      : null,
    updated_at: r.updated_at,
  };
}
