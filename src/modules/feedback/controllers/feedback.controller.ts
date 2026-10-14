import { Body, Controller, Get, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { CurrentPartnerId } from '@common/auth/current-partner.decorator';

import {
  FeedbackReceiptView,
  NpsReasonSetDto,
  SubmitFeedbackDto,
  SuggestProductDto,
  SuggestionReceiptView,
} from '../dto/feedback.dto';
import type { NpsReasonSet } from '../feedback.domain';
import { FeedbackService } from '../services/feedback.service';

/** A person taps Submit a few times at most; this only stops a looping client. */
const SUBMIT_LIMIT = { default: { limit: 5, ttl: 60_000 } };

/** The Feedback screen. Who answered is the token's partner; nothing in a body says so. */
@ApiTags('app · feedback')
@ApiBearerAuth()
@Controller('feedback')
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Get('reasons')
  @ApiOperation({
    summary:
      'The follow-up question and reason chips for each NPS group (HO-edited, cached ≤ 60 s)',
  })
  @ApiOkResponse({ type: NpsReasonSetDto })
  reasons(): Promise<NpsReasonSet> {
    return this.feedback.reasons();
  }

  @Post()
  @Throttle(SUBMIT_LIMIT)
  @ApiOperation({
    summary:
      'Send an NPS answer with reasons, a comment and app stars; a 0–6 opens a call-back',
  })
  @ApiCreatedResponse({ type: FeedbackReceiptView })
  @ApiTooManyRequestsResponse({ description: '`FEEDBACK_LIMIT` — 10 a day' })
  submit(
    @CurrentPartnerId() agentId: string,
    @Body() dto: SubmitFeedbackDto,
  ): Promise<FeedbackReceiptView> {
    return this.feedback.submit(agentId, dto);
  }

  @Post('suggestions')
  @Throttle(SUBMIT_LIMIT)
  @ApiOperation({
    summary:
      'Suggest a product farmers ask for; answers with its SUG- reference',
  })
  @ApiCreatedResponse({ type: SuggestionReceiptView })
  @ApiTooManyRequestsResponse({ description: '`FEEDBACK_LIMIT` — 20 a day' })
  suggest(
    @CurrentPartnerId() agentId: string,
    @Body() dto: SuggestProductDto,
  ): Promise<SuggestionReceiptView> {
    return this.feedback.suggest(agentId, dto);
  }
}
