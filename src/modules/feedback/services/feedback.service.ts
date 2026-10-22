import { Injectable } from '@nestjs/common';

import { tooMany } from '@common/errors/api-error';
import { istDayStart } from '@common/utils/ist-day.util';
import { AgentsService } from '@modules/agents/services/agents.service';
import { CountersService } from '@modules/counters/services/counters.service';
import { SettingsService } from '@modules/settings/services/settings.service';

import type {
  FeedbackReceiptView,
  SubmitFeedbackDto,
  SuggestProductDto,
  SuggestionReceiptView,
} from '../dto/feedback.dto';
import {
  FEEDBACK_PER_DAY_MAX,
  SUGGESTIONS_PER_DAY_MAX,
  cleanReasons,
  followUpDueAt,
  formatSuggestionRef,
  npsBucket,
  productKey,
  withDefaults,
  type NpsReasonSet,
} from '../feedback.domain';
import { FeedbackRepository } from '../repositories/feedback.repository';
import { ProductSuggestionRepository } from '../repositories/product-suggestion.repository';
import type { PartnerSnapshot } from '../schemas/feedback.schema';

type AgentRecord = Awaited<ReturnType<AgentsService['requireByAgentId']>>;

/** The partner's side of the Feedback screen. Who answered is the token's partner, always. */
@Injectable()
export class FeedbackService {
  constructor(
    private readonly feedback: FeedbackRepository,
    private readonly suggestions: ProductSuggestionRepository,
    private readonly agents: AgentsService,
    private readonly counters: CountersService,
    private readonly settings: SettingsService,
  ) {}

  /** HO's question and chips per bucket (settings are cached ≤ 60 s), else the app's own. */
  async reasons(): Promise<NpsReasonSet> {
    return withDefaults((await this.settings.get()).feedback_reasons);
  }

  async submit(
    agentId: string,
    dto: SubmitFeedbackDto,
  ): Promise<FeedbackReceiptView> {
    const now = new Date();
    checkCap(
      await this.feedback.countSince(agentId, istDayStart(now)),
      FEEDBACK_PER_DAY_MAX,
      'You have sent a lot of feedback today. Please try again tomorrow.',
    );
    const partner = snapshot(await this.agents.requireByAgentId(agentId));
    const bucket = npsBucket(dto.nps);
    const saved = await this.feedback.create({
      agent_id: agentId,
      partner,
      nps: dto.nps,
      bucket,
      reasons: cleanReasons(dto.reasons),
      comment: dto.comment?.trim() || null,
      rating: dto.rating ?? null,
      follow_up:
        bucket === 'detractor'
          ? {
              status: 'open',
              due_at: followUpDueAt(now),
              owner_agent_id: partner.owner_agent_id,
              note: null,
              done_by: null,
              done_at: null,
            }
          : null,
    });
    return {
      id: String(saved._id),
      bucket,
      follow_up_due_at: saved.follow_up?.due_at ?? null,
      created_at: saved.created_at,
    };
  }

  async suggest(
    agentId: string,
    dto: SuggestProductDto,
  ): Promise<SuggestionReceiptView> {
    checkCap(
      await this.suggestions.countSince(agentId, istDayStart(new Date())),
      SUGGESTIONS_PER_DAY_MAX,
      'You have sent a lot of suggestions today. Please try again tomorrow.',
    );
    const partner = snapshot(await this.agents.requireByAgentId(agentId));
    const product = dto.product.trim().replace(/\s+/g, ' ');
    const saved = await this.suggestions.create({
      _id: formatSuggestionRef(await this.counters.nextSuggestionNumber()),
      agent_id: agentId,
      partner,
      product,
      product_key: productKey(product),
      crop: dto.crop?.trim() || null,
      monthly_demand: dto.monthly_demand?.trim() || null,
      note: dto.note?.trim() || null,
      status: 'new',
      ho_note: null,
      updated_by: null,
    });
    return { ref: saved._id, product, created_at: saved.created_at };
  }
}

function checkCap(used: number, max: number, message: string): void {
  if (used >= max) throw tooMany('FEEDBACK_LIMIT', message, [message]);
}

function snapshot(agent: AgentRecord): PartnerSnapshot {
  return {
    name: agent.profile?.name ?? agent.preview?.name ?? null,
    phone: agent.phone,
    cohort: agent.cohort ?? null,
    district: agent.profile?.district ?? agent.preview?.district ?? null,
    state: agent.profile?.state ?? agent.preview?.state ?? null,
    owner_agent_id: agent.owner_agent_id ?? null,
  };
}
