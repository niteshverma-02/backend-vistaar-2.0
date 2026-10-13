import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { CurrentPartnerId } from '@common/auth/current-partner.decorator';

import {
  AttendanceDayView,
  AttendanceMonthQueryDto,
  AttendanceMonthView,
  PunchDto,
} from '../dto/attendance.dto';
import { AttendanceService } from '../services/attendance.service';

/** A real field day is a handful of punches; this only stops a looping client. */
const PUNCH_LIMIT = { default: { limit: 10, ttl: 60_000 } };

/** The partner's own attendance. Nothing in a path or body says whose. */
@ApiTags('app · attendance')
@ApiBearerAuth()
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get('today')
  @ApiOperation({ summary: "Today's punch state (IST day)" })
  @ApiOkResponse({ type: AttendanceDayView })
  today(@CurrentPartnerId() agentId: string): Promise<AttendanceDayView> {
    return this.attendance.today(agentId);
  }

  @Post('punch-in')
  @HttpCode(HttpStatus.OK)
  @Throttle(PUNCH_LIMIT)
  @ApiOperation({
    summary: 'Start a session (again after a punch-out); time is the server’s',
  })
  @ApiOkResponse({ type: AttendanceDayView })
  @ApiConflictResponse({
    description:
      '`ALREADY_PUNCHED_IN`, `PUNCH_LIMIT_REACHED` or `ATTENDANCE_CHANGED`',
  })
  punchIn(
    @CurrentPartnerId() agentId: string,
    @Body() dto: PunchDto,
  ): Promise<AttendanceDayView> {
    return this.attendance.punchIn(agentId, dto);
  }

  @Post('punch-out')
  @HttpCode(HttpStatus.OK)
  @Throttle(PUNCH_LIMIT)
  @ApiOperation({
    summary: "Close today's open session, from wherever the partner is",
  })
  @ApiOkResponse({ type: AttendanceDayView })
  @ApiConflictResponse({
    description: '`NOT_PUNCHED_IN` or `ATTENDANCE_CHANGED`',
  })
  punchOut(
    @CurrentPartnerId() agentId: string,
    @Body() dto: PunchDto,
  ): Promise<AttendanceDayView> {
    return this.attendance.punchOut(agentId, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'One month: days with a punch (newest first) and the summary',
  })
  @ApiOkResponse({ type: AttendanceMonthView })
  month(
    @CurrentPartnerId() agentId: string,
    @Query() query: AttendanceMonthQueryDto,
  ): Promise<AttendanceMonthView> {
    return this.attendance.month(agentId, query.month);
  }
}
