import { Injectable } from '@nestjs/common';
import { Types } from 'mongoose';

import { badRequest, conflict, notFound } from '@common/errors/api-error';
import { PageResult } from '@common/http/page-result';
import { normalizeMobile } from '@common/utils/phone.util';

import type {
  CreateTestimonialDto,
  TestimonialListQueryDto,
  UpdateTestimonialDto,
} from '../dto/testimonial.dto';
import { SubmissionRepository } from '../repositories/submission.repository';
import {
  TestimonialRepository,
  type TestimonialRow,
} from '../repositories/testimonial.repository';
import {
  MEDIA_TYPE_OF,
  OBJECT_ID,
  VISTAAR_SOURCE,
  statusOf,
  toContact,
  type MediaType,
  type TestimonialStatus,
  type TestimonialType,
} from '../testimonials.domain';

/** What the HO desk reads: the row with a string id, its tray, and the like counts. */
export interface AdminTestimonialView {
  _id: string;
  type: TestimonialType;
  bulk: string | null;
  family: string | null;
  media: { media_type: MediaType; media_url: string };
  review: string;
  user: { contact: string; name: string | null; profile_image: string | null };
  pii_id: string | null;
  verified: boolean;
  deleted: boolean;
  status: TestimonialStatus;
  likes: number;
  dislikes: number;
  /** A partner's, sent from the app — decided on the submissions desk. */
  from_partner: boolean;
  verified_by: string | null;
  deleted_by: string | null;
  created_at: Date;
  updated_at: Date;
}

/** One approved farmer quote, as My Story pre-fills it. */
export interface FarmerStoryView {
  id: string;
  name: string | null;
  quote: string;
  /** Trade name, else the SKU or combo family. */
  product: string | null;
  /** Known for a partner's testimonial; `null` for one HO filed. */
  crop: string | null;
  village: string | null;
  district: string | null;
  stars: number | null;
  media: { media_type: MediaType; media_url: string } | null;
  created_at: Date;
}

const TESTIMONIAL_NOT_FOUND =
  'This testimonial could not be found. It may have been deleted.';

@Injectable()
export class TestimonialsService {
  constructor(
    private readonly testimonials: TestimonialRepository,
    private readonly submissions: SubmissionRepository,
  ) {}

  /**
   * What My Story's "Farmer story" template picks from, newest first:
   * partners' approved testimonials (quotes included, with crop, place and
   * stars) and the ones HO filed. A partner's appears once, from its own row.
   */
  async forStories(limit: number): Promise<FarmerStoryView[]> {
    const [partners, filed] = await Promise.all([
      this.submissions.approvedQuotes(limit),
      this.testimonials.approvedWithReview(limit),
    ]);
    const linked = await this.submissions.linkedTestimonials(
      filed.map((r) => r._id),
    );
    const own = filed.filter((r) => !linked.has(r._id.toHexString()));
    const names = await this.testimonials.tradeNames([
      ...new Set(own.flatMap((r) => (r.bulk ? [r.bulk] : []))),
    ]);
    const stories: FarmerStoryView[] = [
      ...partners.map((r) => ({
        id: r._id,
        name: r.farmer_name,
        quote: r.text,
        product: r.product_name ?? r.bulk ?? r.family,
        crop: r.crop,
        village: r.village,
        district: r.district,
        stars: r.rating,
        media:
          r.kind !== 'text' && r.media_url
            ? { media_type: MEDIA_TYPE_OF[r.kind], media_url: r.media_url }
            : null,
        created_at: r.created_at,
      })),
      ...own.map((r) => ({
        id: r._id.toHexString(),
        name: r.user.name,
        quote: r.review,
        product:
          (r.bulk ? names.get(r.bulk) : null) ?? r.bulk ?? r.family ?? null,
        crop: null,
        village: null,
        district: null,
        stars: null,
        media: r.media,
        created_at: r.created_at,
      })),
    ];
    return stories
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
      .slice(0, limit);
  }

  async list(
    query: TestimonialListQueryDto,
  ): Promise<PageResult<AdminTestimonialView>> {
    const { rows, total } = await this.testimonials.page(
      {
        status: query.status,
        type: query.type,
        media_type: query.media_type,
        q: query.q,
      },
      query.skip,
      query.limit,
      query.sortSpec,
    );
    const linked = await this.submissions.linkedTestimonials(
      rows.map((r) => r._id),
    );
    return new PageResult(
      rows.map((r) => toView(r, linked.has(r._id.toHexString()))),
      total,
      query,
    );
  }

  summary(): Promise<Record<TestimonialStatus, number>> {
    return this.testimonials.counts();
  }

  async get(id: string): Promise<AdminTestimonialView> {
    const row = await this.require(id);
    return toView(row, await this.fromPartner(row._id));
  }

  async create(
    dto: CreateTestimonialDto,
    by: string,
  ): Promise<AdminTestimonialView> {
    const bulk = dto.bulk?.trim() || null;
    const family = dto.family?.trim() || null;
    if (!bulk === !family) {
      throw invalid('Please choose either a product or a combo (not both).');
    }
    const mobile = normalizeMobile(dto.user.contact);
    if (!mobile) throw invalid('Please enter a valid 10-digit mobile number.');

    const exists = bulk
      ? await this.testimonials.productExists(bulk)
      : await this.testimonials.comboExists(family!);
    if (!exists) {
      throw badRequest(
        'PRODUCT_NOT_FOUND',
        bulk
          ? 'This product could not be found. Please choose it again from the list.'
          : 'This combo could not be found. Please choose it again from the list.',
      );
    }

    const now = new Date();
    const saved = await this.testimonials.create({
      source: VISTAAR_SOURCE,
      type: bulk ? 'product' : 'combo',
      bulk,
      family,
      verified: dto.verified ?? false,
      deleted: false,
      media: dto.media,
      feedbacks: [],
      review: dto.review?.trim() ?? '',
      pii_id: null,
      user: {
        contact: toContact(mobile),
        name: dto.user.name?.trim() || null,
        profile_image: null,
      },
      verified_by: dto.verified ? by : null,
      deleted_by: null,
      created_at: now,
      updated_at: now,
      __v: 0,
    });
    return toView(saved, false);
  }

  async update(
    id: string,
    dto: UpdateTestimonialDto,
    by: string,
  ): Promise<AdminTestimonialView> {
    const { name, ...rest } = dto;
    // The validated DTO carries every declared field, unsent ones `undefined`,
    // and the raw driver would store those as `null` over the row's values.
    const sent = Object.entries(rest).filter(([, v]) => v !== undefined);
    const set: Partial<TestimonialRow> & Record<string, unknown> =
      Object.fromEntries(sent);
    if (rest.review !== undefined) set.review = rest.review.trim();
    if (name !== undefined) set['user.name'] = name.trim() || null;
    if (Object.keys(set).length === 0)
      throw invalid(
        'Nothing was changed. Please edit something before saving.',
      );
    // Who decided, as Stockship's own desk records it.
    if (rest.verified !== undefined)
      set.verified_by = rest.verified ? by : null;
    if (rest.deleted !== undefined) set.deleted_by = rest.deleted ? by : null;

    checkId(id);
    await this.refusePartners(id);
    const updated = await this.testimonials.update(id, set);
    if (!updated) throw notFound(TESTIMONIAL_NOT_FOUND);
    return toView(updated, false);
  }

  /** For good. Removing (`deleted: true`) is the undoable way. */
  async remove(id: string): Promise<{ deleted: true }> {
    checkId(id);
    await this.refusePartners(id);
    if (!(await this.testimonials.remove(id)))
      throw notFound(TESTIMONIAL_NOT_FOUND);
    return { deleted: true };
  }

  /**
   * A partner's testimonial has its status, reason and consent on its own
   * row; changing the shared copy from here would leave the two disagreeing.
   */
  private async refusePartners(id: string): Promise<void> {
    if (await this.fromPartner(new Types.ObjectId(id))) {
      throw conflict(
        'TESTIMONIAL_FROM_PARTNER',
        "This is a partner's testimonial. Please approve or remove it from Partner testimonials.",
      );
    }
  }

  private async fromPartner(id: Types.ObjectId): Promise<boolean> {
    return (await this.submissions.linkedTestimonials([id])).size > 0;
  }

  private async require(id: string): Promise<TestimonialRow> {
    checkId(id);
    const row = await this.testimonials.find(id);
    if (!row) throw notFound(TESTIMONIAL_NOT_FOUND);
    return row;
  }
}

function checkId(id: string): void {
  if (!OBJECT_ID.test(id))
    throw invalid(
      'This testimonial could not be found. Please open it again from the list.',
    );
}

function invalid(message: string) {
  return badRequest('VALIDATION_FAILED', message, [message]);
}

export function toView(
  t: TestimonialRow,
  fromPartner: boolean,
): AdminTestimonialView {
  const feedbacks = t.feedbacks ?? [];
  const likes = feedbacks.filter((f) => f.status).length;
  return {
    _id: String(t._id),
    type: t.type ?? 'product',
    bulk: t.bulk ?? null,
    family: t.family ?? null,
    media: t.media,
    review: t.review ?? '',
    user: {
      contact: t.user?.contact ?? '',
      name: t.user?.name ?? null,
      profile_image: t.user?.profile_image ?? null,
    },
    pii_id: t.pii_id ?? null,
    verified: !!t.verified,
    deleted: !!t.deleted,
    status: statusOf({ verified: !!t.verified, deleted: !!t.deleted }),
    likes,
    dislikes: feedbacks.length - likes,
    from_partner: fromPartner,
    verified_by: t.verified_by ?? null,
    deleted_by: t.deleted_by ?? null,
    created_at: t.created_at,
    updated_at: t.updated_at,
  };
}
