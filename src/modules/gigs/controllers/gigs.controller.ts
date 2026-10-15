import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { CurrentPartnerId } from '@common/auth/current-partner.decorator';
import type { PageResult } from '@common/http/page-result';

import {
  AddGigPhotoDto,
  CheckinDto,
  GigAttendeesDto,
  GigParamDto,
  GigPhotoParamDto,
  GigPhotoTicketDto,
  GigsQueryDto,
} from '../dto/gig.dto';
import {
  GigsService,
  type GigDetail,
  type GigPhotoTicket,
  type GigSummary,
  type GigView,
} from '../services/gigs.service';

/** Only stops a looping client. */
const WRITE_LIMIT = { default: { limit: 30, ttl: 60_000 } };

/**
 * The partner's gigs. No create or delete here — gigs are HO's; accept and
 * release are the partner's take and give-back, the rest is the proof.
 */
@ApiTags('app · gigs')
@ApiBearerAuth()
@Controller('gigs')
export class GigsController {
  constructor(private readonly gigs: GigsService) {}

  @Get()
  @ApiOperation({
    summary:
      'Gigs: available (open, my cohort and state, nearest first), mine (held or in review), history',
  })
  list(
    @CurrentPartnerId() agentId: string,
    @Query() query: GigsQueryDto,
  ): Promise<PageResult<GigView>> {
    return this.gigs.list(agentId, query);
  }

  @Get('summary')
  @ApiOperation({
    summary:
      'Tab counts, gig pay earned this IST month, and whether gig pay is on',
  })
  summary(@CurrentPartnerId() agentId: string): Promise<GigSummary> {
    return this.gigs.summary(agentId);
  }

  @Get(':id')
  @ApiOperation({
    summary:
      'One gig: open for my cohort, or my own with its farmers and photos',
  })
  get(
    @CurrentPartnerId() agentId: string,
    @Param() { id }: GigParamDto,
  ): Promise<GigDetail> {
    return this.gigs.get(agentId, id);
  }

  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  @Throttle(WRITE_LIMIT)
  @ApiOperation({
    summary:
      'Take an open gig; `warning` when I already hold a gig that day (never blocks)',
  })
  @ApiConflictResponse({ description: '`GIG_TAKEN`, `GIG_CLOSED`' })
  accept(
    @CurrentPartnerId() agentId: string,
    @Param() { id }: GigParamDto,
  ): Promise<GigDetail & { warning: string | null }> {
    return this.gigs.accept(agentId, id);
  }

  @Post(':id/release')
  @HttpCode(HttpStatus.OK)
  @Throttle(WRITE_LIMIT)
  @ApiOperation({
    summary: 'Give a gig back — only before its IST day and before check-in',
  })
  @ApiConflictResponse({ description: '`GIG_CLOSED`' })
  release(
    @CurrentPartnerId() agentId: string,
    @Param() { id }: GigParamDto,
  ): Promise<GigDetail> {
    return this.gigs.release(agentId, id);
  }

  @Post(':id/check-in')
  @HttpCode(HttpStatus.OK)
  @Throttle(WRITE_LIMIT)
  @ApiOperation({
    summary:
      'Check in at the venue (server time; early / late / far / no GPS are flagged, never refused)',
  })
  @ApiConflictResponse({ description: '`GIG_CLOSED`' })
  checkIn(
    @CurrentPartnerId() agentId: string,
    @Param() { id }: GigParamDto,
    @Body() dto: CheckinDto,
  ): Promise<GigDetail> {
    return this.gigs.checkIn(agentId, id, dto);
  }

  @Put(':id/attendees')
  @Throttle(WRITE_LIMIT)
  @ApiOperation({
    summary: 'The whole list of farmers present, as it stands (after check-in)',
  })
  @ApiConflictResponse({ description: '`GIG_CLOSED`' })
  setAttendees(
    @CurrentPartnerId() agentId: string,
    @Param() { id }: GigParamDto,
    @Body() dto: GigAttendeesDto,
  ): Promise<GigDetail> {
    return this.gigs.setAttendees(agentId, id, dto);
  }

  @Post(':id/photos/upload-url')
  @HttpCode(HttpStatus.OK)
  @Throttle(WRITE_LIMIT)
  @ApiOperation({
    summary: 'A signed URL to PUT one photo (≤ 5 MB) straight to storage',
  })
  @ApiBadRequestResponse({
    description: '`FILE_TOO_LARGE`, `VALIDATION_FAILED`',
  })
  @ApiConflictResponse({ description: '`GIG_CLOSED`' })
  photoTicket(
    @CurrentPartnerId() agentId: string,
    @Param() { id }: GigParamDto,
    @Body() dto: GigPhotoTicketDto,
  ): Promise<GigPhotoTicket> {
    return this.gigs.photoTicket(agentId, id, dto);
  }

  @Post(':id/photos')
  @Throttle(WRITE_LIMIT)
  @ApiOperation({
    summary:
      'Add an uploaded photo to the gig (the same path twice is a no-op)',
  })
  @ApiBadRequestResponse({
    description: '`MEDIA_NOT_FOUND`, `VALIDATION_FAILED`',
  })
  @ApiConflictResponse({ description: '`GIG_CLOSED`' })
  addPhoto(
    @CurrentPartnerId() agentId: string,
    @Param() { id }: GigParamDto,
    @Body() dto: AddGigPhotoDto,
  ): Promise<GigDetail> {
    return this.gigs.addPhoto(agentId, id, dto);
  }

  @Delete(':id/photos/:photoId')
  @Throttle(WRITE_LIMIT)
  @ApiOperation({ summary: 'Remove a photo and its file (before submit)' })
  @ApiConflictResponse({ description: '`GIG_CLOSED`' })
  removePhoto(
    @CurrentPartnerId() agentId: string,
    @Param() { id, photoId }: GigPhotoParamDto,
  ): Promise<GigDetail> {
    return this.gigs.removePhoto(agentId, id, photoId);
  }

  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  @Throttle(WRITE_LIMIT)
  @ApiOperation({
    summary:
      'Send the proof for HO review — needs the minimum farmers and photos',
  })
  @ApiBadRequestResponse({
    description: '`VALIDATION_FAILED` with what is missing in `details`',
  })
  @ApiConflictResponse({ description: '`GIG_CLOSED`' })
  submit(
    @CurrentPartnerId() agentId: string,
    @Param() { id }: GigParamDto,
  ): Promise<GigDetail> {
    return this.gigs.submit(agentId, id);
  }
}
