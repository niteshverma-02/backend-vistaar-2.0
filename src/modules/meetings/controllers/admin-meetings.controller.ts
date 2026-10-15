import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import type { PageResult } from '@common/http/page-result';
import { Can } from '@modules/access/guards/capability.guard';

import { AdminMeetingsQueryDto, MeetingParamDto } from '../dto/meeting.dto';
import {
  MeetingsService,
  type AdminMeetingDetail,
  type AdminMeetingView,
  type MeetingSummary,
} from '../services/meetings.service';

/**
 * HO reads partners' meetings. Read-only on purpose: a meeting and its
 * attendance are the partner's record, written only in the app.
 */
@ApiTags('admin · meetings')
@Controller('admin/meetings')
export class AdminMeetingsController {
  constructor(private readonly meetings: MeetingsService) {}

  @Get()
  @Can('leads.read')
  @ApiOperation({
    summary:
      'Every partner’s meetings, newest first; by partner, status, IST days',
  })
  list(
    @Query() query: AdminMeetingsQueryDto,
  ): Promise<PageResult<AdminMeetingView>> {
    return this.meetings.adminList(query);
  }

  @Get('summary')
  @Can('leads.read')
  @ApiOperation({
    summary:
      'Cards for IST days (default this month): meetings by status, partners, farmers invited / present, leads',
  })
  summary(@Query() query: AdminMeetingsQueryDto): Promise<MeetingSummary> {
    return this.meetings.adminSummary(query);
  }

  @Get(':id')
  @Can('leads.read')
  @ApiOperation({ summary: 'One meeting with its attendees and the partner' })
  get(@Param() { id }: MeetingParamDto): Promise<AdminMeetingDetail> {
    return this.meetings.adminGet(id);
  }
}
