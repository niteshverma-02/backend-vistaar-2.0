import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

import { PageQueryDto } from '@common/dto/page-query.dto';
import { MONTH_PATTERN } from '@modules/attendance/attendance.domain';

import {
  ACTIVITY_KINDS,
  ACTIVITY_PERIODS,
  type ActivityKind,
  PERIODS,
  type ActivityPeriod,
  type Period,
} from '../performance.domain';

export class PerformanceQueryDto {
  @ApiPropertyOptional({
    enum: PERIODS,
    default: 'month',
    description: 'This month · the last 3 months with this one · April to now',
  })
  @IsOptional()
  @IsIn(PERIODS, { message: 'Please choose month, 3m or fy.' })
  period: Period = 'month';
}

export class ActivityQueryDto {
  @ApiPropertyOptional({ enum: ACTIVITY_PERIODS, default: 'day' })
  @IsOptional()
  @IsIn(ACTIVITY_PERIODS, {
    message: 'Please choose day, week, month, quarter, year or custom.',
  })
  period: ActivityPeriod = 'day';

  @ApiPropertyOptional({
    example: '2026-10-27',
    description:
      'Any IST day inside the period (custom: the first day); default today',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Please send the date as YYYY-MM-DD.',
  })
  date?: string;

  @ApiPropertyOptional({
    example: '2026-10-31',
    description:
      'custom only: the last day (included), at most a year after `date`',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Please send the date as YYYY-MM-DD.',
  })
  to?: string;
}

export class ActivityItemsQueryDto extends ActivityQueryDto {
  @ApiProperty({ enum: ACTIVITY_KINDS })
  @IsIn(ACTIVITY_KINDS, { message: 'Please choose which list to show.' })
  kind!: ActivityKind;
}

export class PerformanceAgentParamDto {
  @ApiProperty({ example: 'VST-000006' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^VST-\d{1,12}$/, { message: 'This partner id is not valid.' })
  agentId!: string;
}

export class SetTargetDto {
  @ApiProperty({
    example: 150000,
    nullable: true,
    type: Number,
    description:
      '₹ of delivered sales a month; `null` = back to the settings default',
  })
  @ValidateIf((_o, v) => v !== null)
  @IsInt({ message: 'Please enter the target in whole rupees.' })
  @Min(1)
  @Max(100_000_000)
  monthly_target!: number | null;
}

/** `GET /admin/performance`: approved partners, one page at a time, for a month. */
export class AdminPerformanceQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    example: '2026-10',
    description: 'IST month; this month when left out',
  })
  @IsOptional()
  @Matches(MONTH_PATTERN, {
    message: 'Please choose a valid month, for example 2026-10.',
  })
  month?: string;

  @ApiPropertyOptional({ example: 'vistaar_agent' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  cohort?: string;

  @ApiPropertyOptional({ example: 'MADHYA PRADESH' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  state?: string;

  @ApiPropertyOptional({ example: 'BHOPAL' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  district?: string;

  @ApiPropertyOptional({ description: 'Name, phone, VST- or PII- id' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  q?: string;
}

/** `GET /admin/performance/board`. */
export class BoardQueryDto {
  @ApiPropertyOptional({
    example: '2026-10',
    description: 'IST month; this month when left out',
  })
  @IsOptional()
  @Matches(MONTH_PATTERN, {
    message: 'Please choose a valid month, for example 2026-10.',
  })
  month?: string;
}
