import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, Matches } from 'class-validator';

import { PageQueryDto } from '@common/dto/page-query.dto';
import {
  DATE_PATTERN,
  MONTH_PATTERN,
} from '@modules/attendance/attendance.domain';

import { KKD_CHANNELS, type KkdChannel } from '../kkd-activity.domain';

const PII_PATTERN = /^PII-[A-Z0-9-]{1,20}$/;
const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class KkdActivityQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    example: 'PII-1620690',
    description: 'One of your farmers only (Customer details → KKD & App)',
  })
  @IsOptional()
  @Transform(upper)
  @Matches(PII_PATTERN, { message: 'This farmer is not valid.' })
  customer?: string;

  @ApiPropertyOptional({ enum: KKD_CHANNELS, description: 'Store or app only' })
  @IsOptional()
  @IsIn(KKD_CHANNELS)
  channel?: KkdChannel;

  @ApiPropertyOptional({
    example: '2026-10-01',
    description: 'First IST day, included',
  })
  @IsOptional()
  @Matches(DATE_PATTERN, {
    message: 'Please choose a valid start date, for example 2026-10-01.',
  })
  from?: string;

  @ApiPropertyOptional({
    example: '2026-10-31',
    description: 'Last IST day, included',
  })
  @IsOptional()
  @Matches(DATE_PATTERN, {
    message: 'Please choose a valid end date, for example 2026-10-31.',
  })
  to?: string;
}

export class KkdSummaryQueryDto {
  @ApiPropertyOptional({
    example: '2026-10',
    description: 'IST month of the walk-in and order tiles; default this month',
  })
  @IsOptional()
  @Matches(MONTH_PATTERN, {
    message: 'Please choose a valid month, for example 2026-10.',
  })
  month?: string;

  @ApiPropertyOptional({
    example: 'PII-1620690',
    description: 'One of your farmers only',
  })
  @IsOptional()
  @Transform(upper)
  @Matches(PII_PATTERN, { message: 'This farmer is not valid.' })
  customer?: string;
}
