import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentAdmin } from '@common/decorators/current-principal.decorator';
import type { PageResult } from '@common/http/page-result';
import type { AdminPrincipal } from '@common/interfaces/principal.interface';
import { Can } from '@modules/access/guards/capability.guard';

import {
  FeedbackListQueryDto,
  FeedbackSummaryQueryDto,
  NpsReasonSetDto,
  UpdateFollowUpDto,
} from '../dto/feedback.dto';
import type { NpsReasonSet } from '../feedback.domain';
import {
  AdminFeedbackService,
  type AdminFeedbackView,
  type FeedbackSummary,
} from '../services/admin-feedback.service';

@ApiTags('admin · feedback')
@Controller('admin/feedback')
export class AdminFeedbackController {
  constructor(private readonly feedback: AdminFeedbackService) {}

  @Get()
  @Can('feedback.read')
  @ApiOperation({
    summary:
      'Partners’ NPS answers, newest first; filter by group, call-back state, partner, IST dates or words',
  })
  list(
    @Query() query: FeedbackListQueryDto,
  ): Promise<PageResult<AdminFeedbackView>> {
    return this.feedback.list(query);
  }

  @Get('summary')
  @Can('feedback.read')
  @ApiOperation({
    summary:
      'NPS score, group counts, app stars and top reasons over IST days (≤ 366), plus open call-backs',
  })
  summary(@Query() query: FeedbackSummaryQueryDto): Promise<FeedbackSummary> {
    return this.feedback.summary(query.from, query.to);
  }

  @Get('reasons')
  @Can('feedback.read')
  @ApiOperation({
    summary: 'The question and chips the app shows per NPS group',
  })
  reasons(): Promise<NpsReasonSet> {
    return this.feedback.reasons();
  }

  @Put('reasons')
  @Can('feedback.write')
  @ApiOperation({
    summary:
      'Replace the question and chips for all three groups; the app shows them within a minute',
  })
  setReasons(
    @Body() dto: NpsReasonSetDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<NpsReasonSet> {
    return this.feedback.setReasons(dto, admin.email);
  }

  @Get(':id')
  @Can('feedback.read')
  @ApiOperation({ summary: 'One answer' })
  get(@Param('id') id: string): Promise<AdminFeedbackView> {
    return this.feedback.get(id);
  }

  @Patch(':id/follow-up')
  @Can('feedback.write')
  @ApiOperation({
    summary: 'Mark a detractor’s call-back done (with a note) or reopen it',
  })
  setFollowUp(
    @Param('id') id: string,
    @Body() dto: UpdateFollowUpDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminFeedbackView> {
    return this.feedback.setFollowUp(id, dto, admin.email);
  }
}
