import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentAdmin } from '@common/decorators/current-principal.decorator';
import type { PageResult } from '@common/http/page-result';
import type { AdminPrincipal } from '@common/interfaces/principal.interface';
import { Can } from '@modules/access/guards/capability.guard';

import {
  AdminSubmissionQueryDto,
  RejectDto,
  RemoveDto,
  WithdrawConsentDto,
} from '../dto/submission.dto';
import {
  SubmissionsService,
  type AdminSubmissionView,
} from '../services/submissions.service';
import type { SubmissionStatus } from '../testimonials.domain';

/** Testimonials partners sent from the app: the approval queue and its decisions. */
@ApiTags('admin · testimonial submissions')
@Controller('admin/testimonial-submissions')
export class AdminTestimonialSubmissionsController {
  constructor(private readonly submissions: SubmissionsService) {}

  @Get()
  @Can('testimonials.read')
  @ApiOperation({
    summary:
      'Partner testimonials by status (submitted / approved / rejected / removed), newest first',
  })
  list(
    @Query() query: AdminSubmissionQueryDto,
  ): Promise<PageResult<AdminSubmissionView>> {
    return this.submissions.list(query);
  }

  @Get('summary')
  @Can('testimonials.read')
  @ApiOperation({ summary: 'How many in each status' })
  summary(): Promise<Record<SubmissionStatus, number>> {
    return this.submissions.summary();
  }

  @Get(':id')
  @Can('testimonials.read')
  @ApiOperation({ summary: 'One, with the media to play and the consent' })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<AdminSubmissionView> {
    return this.submissions.get(id);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @Can('testimonials.write')
  @ApiOperation({
    summary:
      'Show it: on the product page (Stockship) and in the app library. Also restores a removed or rejected one',
  })
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminSubmissionView> {
    return this.submissions.approve(id, admin.email);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @Can('testimonials.write')
  @ApiOperation({ summary: 'Not approved; the partner sees the reason' })
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminSubmissionView> {
    return this.submissions.reject(id, dto.reason, admin.email);
  }

  @Post(':id/remove')
  @HttpCode(HttpStatus.OK)
  @Can('testimonials.write')
  @ApiOperation({
    summary:
      'Take an approved one down everywhere; approving again restores it',
  })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RemoveDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminSubmissionView> {
    return this.submissions.remove(id, dto.reason, admin.email);
  }

  @Post(':id/withdraw-consent')
  @HttpCode(HttpStatus.OK)
  @Can('testimonials.write')
  @ApiOperation({
    summary:
      'The farmer withdrew consent: erase the shared rows and the file, for good. The consent record stays',
  })
  withdrawConsent(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: WithdrawConsentDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminSubmissionView> {
    return this.submissions.withdrawConsent(id, dto.reason, admin.email);
  }
}
