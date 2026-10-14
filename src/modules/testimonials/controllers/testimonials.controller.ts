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
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import {
  CurrentPartner,
  type PartnerRef,
} from '@common/auth/current-partner.decorator';
import type { PageResult } from '@common/http/page-result';
import type { FarmerConsent } from '@modules/settings/services/settings.service';

import {
  LibraryQueryDto,
  MineQueryDto,
  SubmitTestimonialDto,
  UploadRequestDto,
  UploadTicketDto,
} from '../dto/submission.dto';
import {
  SubmissionsService,
  type LibraryItemView,
  type MySubmissionView,
} from '../services/submissions.service';

/** A partner sends a few a day; this only stops a looping client. */
const WRITE_LIMIT = { default: { limit: 30, ttl: 60_000 } };
/** Plays and shares are taps, but not hundreds a minute. */
const COUNT_LIMIT = { default: { limit: 120, ttl: 60_000 } };

/** The partner's testimonials and the library. Nothing in a path or body says whose. */
@ApiTags('app · testimonials')
@ApiBearerAuth()
@Controller('testimonials')
export class TestimonialsController {
  constructor(private readonly submissions: SubmissionsService) {}

  @Get('consent')
  @ApiOperation({
    summary:
      'The wording the farmer agrees to (en / hi) and its version — send the version back on submit',
  })
  consent(): Promise<FarmerConsent> {
    return this.submissions.consent();
  }

  @Post('uploads')
  @Throttle(WRITE_LIMIT)
  @ApiOperation({
    summary:
      'A signed URL to PUT one video (≤ 60 MB, MP4/MOV/3GP/WEBM) or photo (≤ 10 MB) straight to storage',
  })
  @ApiOkResponse({ type: UploadTicketDto })
  uploadTicket(
    @CurrentPartner() partner: PartnerRef,
    @Body() dto: UploadRequestDto,
  ): Promise<UploadTicketDto> {
    return this.submissions.uploadTicket(partner, dto);
  }

  @Post()
  @Throttle(WRITE_LIMIT)
  @ApiOperation({
    summary:
      'Send a testimonial of one of my farmers to HO for approval (a retry with the same `id` returns the first)',
  })
  submit(
    @CurrentPartner() partner: PartnerRef,
    @Body() dto: SubmitTestimonialDto,
  ): Promise<MySubmissionView> {
    return this.submissions.submit(partner, dto);
  }

  @Get('mine')
  @ApiOperation({
    summary: 'My submissions, newest first, with status and reason',
  })
  mine(
    @CurrentPartner() partner: PartnerRef,
    @Query() query: MineQueryDto,
  ): Promise<PageResult<MySubmissionView>> {
    return this.submissions.mine(partner, query);
  }

  @Get('library')
  @ApiOperation({
    summary:
      'HO-approved farmer stories from every partner: search, product, crop, near me (state / district); most shared or newest',
  })
  library(
    @Query() query: LibraryQueryDto,
  ): Promise<PageResult<LibraryItemView>> {
    return this.submissions.library(query);
  }

  @Get('mine/:id')
  @ApiOperation({ summary: 'One of my submissions' })
  getMine(
    @CurrentPartner() partner: PartnerRef,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MySubmissionView> {
    return this.submissions.getMine(partner, id);
  }

  @Post(':id/view')
  @HttpCode(HttpStatus.OK)
  @Throttle(COUNT_LIMIT)
  @ApiOperation({ summary: 'Count a play / open of a library story' })
  view(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ views: number; shares: number }> {
    return this.submissions.count(id, 'views');
  }

  @Post(':id/share')
  @HttpCode(HttpStatus.OK)
  @Throttle(COUNT_LIMIT)
  @ApiOperation({ summary: 'Count a WhatsApp share of a library story' })
  share(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ views: number; shares: number }> {
    return this.submissions.count(id, 'shares');
  }
}
