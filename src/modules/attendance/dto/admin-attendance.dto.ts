import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, Matches } from 'class-validator';

import { DATE_PATTERN, MONTH_PATTERN } from '../attendance.domain';

export class AttendanceBoardQueryDto {
  @ApiPropertyOptional({
    example: '2026-10-12',
    description: 'IST day; default today',
  })
  @IsOptional()
  @Matches(DATE_PATTERN, {
    message: 'Please choose a valid date, for example 2026-10-13.',
  })
  date?: string;
}

export class PartnerAttendanceQueryDto {
  @ApiPropertyOptional({
    example: '2026-10',
    description: 'IST month; default this month',
  })
  @IsOptional()
  @Matches(MONTH_PATTERN, {
    message: 'Please choose a valid month, for example 2026-10.',
  })
  month?: string;
}

export class AttendanceRangeQueryDto {
  @ApiProperty({
    example: '2026-10-01',
    description: 'First IST day, included',
  })
  @Matches(DATE_PATTERN, {
    message: 'Please choose a valid start date, for example 2026-10-01.',
  })
  from!: string;

  @ApiProperty({
    example: '2026-10-13',
    description: 'Last IST day, included; at most 366 days after from',
  })
  @Matches(DATE_PATTERN, {
    message: 'Please choose a valid end date, for example 2026-10-13.',
  })
  to!: string;
}
