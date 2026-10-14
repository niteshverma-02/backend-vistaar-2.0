import { Injectable } from '@nestjs/common';

import { badRequest, notFound } from '@common/errors/api-error';
import { PageResult } from '@common/http/page-result';
import { SettingsService } from '@modules/settings/services/settings.service';

import type {
  FeedbackListQueryDto,
  NpsReasonSetDto,
  SuggestionListQueryDto,
  UpdateFollowUpDto,
  UpdateSuggestionDto,
} from '../dto/feedback.dto';
import {
  NPS_BUCKETS,
  OBJECT_ID,
  SUGGESTION_REF,
  SUGGESTION_STATUSES,
  cleanChips,
  istRange,
  npsScore,
  type NpsBucket,
  type NpsReasonSet,
  type SuggestionStatus,
  withDefaults,
} from '../feedback.domain';
import {
  FeedbackRepository,
  type FeedbackRow,
} from '../repositories/feedback.repository';
import {
  ProductSuggestionRepository,
  type SuggestionRow,
  type TopProduct,
} from '../repositories/product-suggestion.repository';
import type { FollowUp, PartnerSnapshot } from '../schemas/feedback.schema';

export interface AdminFeedbackView {
  id: string;
  agent_id: string;
  partner: PartnerSnapshot;
  nps: number;
  bucket: NpsBucket;
  reasons: string[];
  comment: string | null;
  rating: number | null;
  follow_up: (FollowUp & { overdue: boolean }) | null;
  created_at: Date;
}

export interface FeedbackSummary {
  from: string;
  to: string;
  total: number;
  counts: Record<NpsBucket, number>;
  /** −100…100; `null` with no answers in the range. */
  nps: number | null;
  rating: {
    count: number;
    /** One decimal; `null` with no stars given. */
    average: number | null;
    /** Index 0 = 1 star … index 4 = 5 stars. */
    stars: number[];
  };
  /** Most picked first, per bucket. */
  reasons: Record<NpsBucket, { reason: string; count: number }[]>;
  /** All open call-backs, not only the range's. */
  follow_ups: { open: number; overdue: number };
}

export interface AdminSuggestionView {
  ref: string;
  agent_id: string;
  partner: PartnerSnapshot;
  product: string;
  crop: string | null;
  monthly_demand: string | null;
  note: string | null;
  status: SuggestionStatus;
  ho_note: string | null;
  updated_by: string | null;
  created_at: Date;
  updated_at: Date;
}

const FEEDBACK_NOT_FOUND =
  'This feedback could not be found. Please open it again from the list.';
const SUGGESTION_NOT_FOUND =
  'This suggestion could not be found. Please open it again from the list.';
const RANGE_INVALID =
  'Please choose a start date on or before the end date, at most a year apart.';
const TOP_PRODUCTS_DEFAULT = 20;

/** The HO desk's side: read answers, ring detractors back, edit the chips, triage suggestions. */
@Injectable()
export class AdminFeedbackService {
  constructor(
    private readonly feedback: FeedbackRepository,
    private readonly suggestions: ProductSuggestionRepository,
    private readonly settings: SettingsService,
  ) {}

  async list(
    query: FeedbackListQueryDto,
  ): Promise<PageResult<AdminFeedbackView>> {
    const range = optionalRange(query.from, query.to);
    const { rows, total } = await this.feedback.page(
      {
        bucket: query.bucket,
        follow_up: query.follow_up,
        agent_id: query.agent_id?.toUpperCase(),
        ...range,
        q: query.q,
      },
      query.skip,
      query.limit,
      query.sortSpec,
    );
    const now = new Date();
    return new PageResult(
      rows.map((r) => toFeedbackView(r, now)),
      total,
      query,
    );
  }

  async get(id: string): Promise<AdminFeedbackView> {
    if (!OBJECT_ID.test(id)) throw notFound(FEEDBACK_NOT_FOUND);
    const row = await this.feedback.find(id);
    if (!row) throw notFound(FEEDBACK_NOT_FOUND);
    return toFeedbackView(row, new Date());
  }

  async summary(from: string, to: string): Promise<FeedbackSummary> {
    const range = istRange(from, to);
    if (!range) throw invalid(RANGE_INVALID);
    const now = new Date();
    const [stats, follow_ups] = await Promise.all([
      this.feedback.stats(range.start, range.end),
      this.feedback.followUpCounts(now),
    ]);

    const counts = { detractor: 0, passive: 0, promoter: 0 };
    for (const b of stats.buckets) counts[b._id] = b.count;

    const stars = [0, 0, 0, 0, 0];
    for (const r of stats.ratings) {
      if (r._id >= 1 && r._id <= 5) stars[r._id - 1] = r.count;
    }
    const ratingCount = stars.reduce((a, b) => a + b, 0);
    const ratingSum = stars.reduce((a, n, i) => a + n * (i + 1), 0);

    const reasons = Object.fromEntries(
      NPS_BUCKETS.map((b) => [b, [] as { reason: string; count: number }[]]),
    ) as FeedbackSummary['reasons'];
    for (const r of stats.reasons) {
      reasons[r._id.bucket].push({ reason: r._id.reason, count: r.count });
    }

    return {
      from,
      to,
      total: counts.detractor + counts.passive + counts.promoter,
      counts,
      nps: npsScore(counts),
      rating: {
        count: ratingCount,
        average: ratingCount
          ? Math.round((ratingSum / ratingCount) * 10) / 10
          : null,
        stars,
      },
      reasons,
      follow_ups,
    };
  }

  async setFollowUp(
    id: string,
    dto: UpdateFollowUpDto,
    by: string,
  ): Promise<AdminFeedbackView> {
    if (!OBJECT_ID.test(id)) throw notFound(FEEDBACK_NOT_FOUND);
    const done = dto.status === 'done';
    const row = await this.feedback.setFollowUp(id, {
      status: dto.status,
      note: dto.note?.trim() || null,
      done_by: done ? by : null,
      done_at: done ? new Date() : null,
    });
    if (row) return toFeedbackView(row, new Date());
    // Tell "no such feedback" apart from "a passive or promoter has no call-back".
    if (await this.feedback.find(id)) {
      throw invalid('Only a score of 0 to 6 has a call-back to close.');
    }
    throw notFound(FEEDBACK_NOT_FOUND);
  }

  async reasons(): Promise<NpsReasonSet> {
    return withDefaults((await this.settings.get()).feedback_reasons);
  }

  async setReasons(dto: NpsReasonSetDto, by: string): Promise<NpsReasonSet> {
    const next = {} as NpsReasonSet;
    for (const bucket of NPS_BUCKETS) {
      const chips = cleanChips(dto[bucket].chips);
      if (chips.length === 0) {
        throw invalid('Please keep at least one reason for every score group.');
      }
      next[bucket] = { question: dto[bucket].question.trim(), chips };
    }
    await this.settings.setFeedbackReasons(next, by);
    return next;
  }

  async listSuggestions(
    query: SuggestionListQueryDto,
  ): Promise<PageResult<AdminSuggestionView>> {
    const range = optionalRange(query.from, query.to);
    const { rows, total } = await this.suggestions.page(
      {
        status: query.status,
        agent_id: query.agent_id?.toUpperCase(),
        ...range,
        q: query.q,
      },
      query.skip,
      query.limit,
      query.sortSpec,
    );
    return new PageResult(rows.map(toSuggestionView), total, query);
  }

  async suggestionCounts(): Promise<Record<SuggestionStatus, number>> {
    const counts = Object.fromEntries(
      SUGGESTION_STATUSES.map((s) => [s, 0]),
    ) as Record<SuggestionStatus, number>;
    for (const c of await this.suggestions.statusCounts())
      counts[c._id] = c.count;
    return counts;
  }

  async topProducts(
    from: string,
    to: string,
    limit = TOP_PRODUCTS_DEFAULT,
  ): Promise<TopProduct[]> {
    const range = istRange(from, to);
    if (!range) throw invalid(RANGE_INVALID);
    return this.suggestions.topProducts(range.start, range.end, limit);
  }

  async getSuggestion(ref: string): Promise<AdminSuggestionView> {
    const row = SUGGESTION_REF.test(ref)
      ? await this.suggestions.find(ref)
      : null;
    if (!row) throw notFound(SUGGESTION_NOT_FOUND);
    return toSuggestionView(row);
  }

  async updateSuggestion(
    ref: string,
    dto: UpdateSuggestionDto,
    by: string,
  ): Promise<AdminSuggestionView> {
    if (dto.status === undefined && dto.ho_note === undefined) {
      throw invalid(
        'Nothing was changed. Please edit something before saving.',
      );
    }
    if (!SUGGESTION_REF.test(ref)) throw notFound(SUGGESTION_NOT_FOUND);
    const row = await this.suggestions.update(ref, {
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      ...(dto.ho_note !== undefined
        ? { ho_note: dto.ho_note.trim() || null }
        : {}),
      updated_by: by,
    });
    if (!row) throw notFound(SUGGESTION_NOT_FOUND);
    return toSuggestionView(row);
  }
}

function optionalRange(
  from?: string,
  to?: string,
): { start?: Date; end?: Date } {
  if (!from && !to) return {};
  // One end alone is open-ended on the other side, still bounded to a year.
  const range = istRange(from ?? to!, to ?? from!);
  if (!range) throw invalid(RANGE_INVALID);
  return {
    ...(from ? { start: range.start } : {}),
    ...(to ? { end: range.end } : {}),
  };
}

function invalid(message: string) {
  return badRequest('VALIDATION_FAILED', message, [message]);
}

export function toFeedbackView(r: FeedbackRow, now: Date): AdminFeedbackView {
  return {
    id: String(r._id),
    agent_id: r.agent_id,
    partner: r.partner,
    nps: r.nps,
    bucket: r.bucket,
    reasons: r.reasons ?? [],
    comment: r.comment ?? null,
    rating: r.rating ?? null,
    follow_up: r.follow_up
      ? {
          ...r.follow_up,
          overdue:
            r.follow_up.status === 'open' &&
            r.follow_up.due_at.getTime() < now.getTime(),
        }
      : null,
    created_at: r.created_at,
  };
}

function toSuggestionView(r: SuggestionRow): AdminSuggestionView {
  return {
    ref: r._id,
    agent_id: r.agent_id,
    partner: r.partner,
    product: r.product,
    crop: r.crop ?? null,
    monthly_demand: r.monthly_demand ?? null,
    note: r.note ?? null,
    status: r.status,
    ho_note: r.ho_note ?? null,
    updated_by: r.updated_by ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}
