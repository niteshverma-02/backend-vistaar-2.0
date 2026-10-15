import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import {
  CurrentPartner,
  CurrentPartnerId,
  type PartnerRef,
} from '@common/auth/current-partner.decorator';
import type { PageResult } from '@common/http/page-result';
import { AddFarmerDto } from '@modules/leads/dto/lead.dto';
import type {
  InviteeCard,
  SavedLead,
} from '@modules/leads/services/leads.service';

import {
  AttendeeParamDto,
  AttendeesDto,
  CancelMeetingDto,
  CreateMeetingDto,
  InviteesQueryDto,
  MeetingParamDto,
  MeetingsQueryDto,
  UpdateMeetingDto,
} from '../dto/meeting.dto';
import {
  MeetingsService,
  type MeetingDetail,
  type MeetingView,
} from '../services/meetings.service';

/** Only stops a looping client. */
const WRITE_LIMIT = { default: { limit: 30, ttl: 60_000 } };

/** The partner's own meetings; nobody else's are ever read or written here. */
@ApiTags('app · meetings')
@ApiBearerAuth()
@Controller('meetings')
export class MeetingsController {
  constructor(private readonly meetings: MeetingsService) {}

  @Get()
  @ApiOperation({
    summary: 'My meetings: scheduled soonest first, else newest first',
  })
  list(
    @CurrentPartnerId() agentId: string,
    @Query() query: MeetingsQueryDto,
  ): Promise<PageResult<MeetingView>> {
    return this.meetings.list(agentId, query);
  }

  @Get('invitees')
  @ApiOperation({
    summary:
      'Whom I can invite: my customers and open leads, the village first',
  })
  invitees(
    @CurrentPartnerId() agentId: string,
    @Query() query: InviteesQueryDto,
  ): Promise<PageResult<InviteeCard>> {
    return this.meetings.invitees(agentId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One meeting, with its attendees' })
  get(
    @CurrentPartnerId() agentId: string,
    @Param() { id }: MeetingParamDto,
  ): Promise<MeetingDetail> {
    return this.meetings.get(agentId, id);
  }

  @Post()
  @Throttle(WRITE_LIMIT)
  @ApiOperation({
    summary:
      'Schedule a meeting (the app’s UUID; sending it again returns the same meeting)',
  })
  @ApiConflictResponse({ description: '`MEETING_EXISTS`' })
  create(
    @CurrentPartnerId() agentId: string,
    @Body() dto: CreateMeetingDto,
  ): Promise<MeetingDetail> {
    return this.meetings.create(agentId, dto);
  }

  @Patch(':id')
  @Throttle(WRITE_LIMIT)
  @ApiOperation({ summary: 'Change or reschedule — only while scheduled' })
  @ApiConflictResponse({ description: '`MEETING_CLOSED`' })
  update(
    @CurrentPartnerId() agentId: string,
    @Param() { id }: MeetingParamDto,
    @Body() dto: UpdateMeetingDto,
  ): Promise<MeetingDetail> {
    return this.meetings.update(agentId, id, dto);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Throttle(WRITE_LIMIT)
  @ApiOperation({ summary: 'Cancel (kept on record; there is no delete)' })
  @ApiConflictResponse({ description: '`MEETING_CLOSED`' })
  cancel(
    @CurrentPartnerId() agentId: string,
    @Param() { id }: MeetingParamDto,
    @Body() dto: CancelMeetingDto,
  ): Promise<MeetingDetail> {
    return this.meetings.cancel(agentId, id, dto);
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @Throttle(WRITE_LIMIT)
  @ApiOperation({ summary: 'Mark held — needs at least one farmer present' })
  @ApiConflictResponse({ description: '`MEETING_CLOSED`' })
  complete(
    @CurrentPartnerId() agentId: string,
    @Param() { id }: MeetingParamDto,
  ): Promise<MeetingDetail> {
    return this.meetings.complete(agentId, id);
  }

  @Put(':id/attendees')
  @Throttle(WRITE_LIMIT)
  @ApiOperation({
    summary:
      'The whole attendee list as it stands: presence and walk-ins (not once cancelled)',
  })
  @ApiConflictResponse({ description: '`MEETING_CLOSED`, `VERSION_CONFLICT`' })
  setAttendees(
    @CurrentPartnerId() agentId: string,
    @Param() { id }: MeetingParamDto,
    @Body() dto: AttendeesDto,
  ): Promise<MeetingDetail> {
    return this.meetings.setAttendees(agentId, id, dto);
  }

  @Post(':id/attendees/:phone/lead')
  @HttpCode(HttpStatus.OK)
  @Throttle(WRITE_LIMIT)
  @ApiOperation({
    summary:
      'Capture an attendee as my lead (the add-lead rules: consent, crop, acreage)',
  })
  @ApiConflictResponse({ description: '`MEETING_CLOSED`, `FARMER_TAKEN`, …' })
  captureLead(
    @CurrentPartner() partner: PartnerRef,
    @Param() { id, phone }: AttendeeParamDto,
    @Body() dto: AddFarmerDto,
  ): Promise<{ meeting: MeetingDetail; lead: SavedLead }> {
    return this.meetings.captureLead(partner, id, phone, dto);
  }
}
