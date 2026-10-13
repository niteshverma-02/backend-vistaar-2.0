import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Can } from '@modules/access/guards/capability.guard';

import {
  AttendanceBoardQueryDto,
  AttendanceRangeQueryDto,
  PartnerAttendanceQueryDto,
} from '../dto/admin-attendance.dto';
import type { AttendanceMonthView } from '../dto/attendance.dto';
import {
  AdminAttendanceService,
  type AttendanceBoard,
  type AttendanceRange,
  type PartnerRef,
} from '../services/admin-attendance.service';

/** Head office reads partners' attendance; only the partner's app ever punches. */
@ApiTags('admin · attendance')
@Controller('admin/attendance')
export class AdminAttendanceController {
  constructor(private readonly attendance: AdminAttendanceService) {}

  @Get()
  @Can('attendance.read')
  @ApiOperation({
    summary:
      "One IST day across every approved partner, with the day's counts and a 14-day trend",
  })
  board(@Query() query: AttendanceBoardQueryDto): Promise<AttendanceBoard> {
    return this.attendance.board(query.date);
  }

  @Get('range')
  @Can('attendance.read')
  @ApiOperation({
    summary:
      'Every approved partner over a range of IST days (week, month, 90 days, a year — at most 366 days): per-partner roll-up, a day mark string, and the per-day trend',
  })
  range(@Query() query: AttendanceRangeQueryDto): Promise<AttendanceRange> {
    return this.attendance.range(query.from, query.to);
  }

  @Get('partners/:agentId')
  @Can('attendance.read')
  @ApiOperation({
    summary: "One partner's month: days with a punch and the summary",
  })
  partner(
    @Param('agentId') agentId: string,
    @Query() query: PartnerAttendanceQueryDto,
  ): Promise<AttendanceMonthView & { partner: PartnerRef }> {
    return this.attendance.partner(agentId, query.month);
  }
}
