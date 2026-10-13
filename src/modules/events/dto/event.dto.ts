import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

import { PageQueryDto } from '@common/dto/page-query.dto';

import {
  EVENT_STATUSES,
  EVENT_TYPES,
  MAX_SEATS,
  type EventStatus,
  type EventType,
} from '../events.domain';

const COHORT_KEY = /^[a-z][a-z0-9_]{1,40}$/;

export class UpdateEventDto {
  @ApiPropertyOptional({ example: 'Kisan Mela · Barabanki' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title?: string;

  @ApiPropertyOptional({ enum: EVENT_TYPES })
  @IsOptional()
  @IsIn(EVENT_TYPES)
  type?: EventType;

  @ApiPropertyOptional({ example: '2026-10-25T10:00:00+05:30' })
  @IsOptional()
  @IsDateString()
  starts_at?: string;

  @ApiPropertyOptional({ example: 'Mandi Samiti ground, Barabanki' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  location?: string;

  @ApiPropertyOptional({
    example: 'Free soil testing and product demo',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(300)
  note?: string | null;

  @ApiPropertyOptional({ example: 40, minimum: 1, maximum: MAX_SEATS })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_SEATS)
  seats?: number;

  @ApiPropertyOptional({
    example: ['vistaar_agent'],
    description: 'Cohort keys; empty = every partner',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @Matches(COHORT_KEY, {
    each: true,
    message: 'One of the chosen partner types is not valid.',
  })
  cohorts?: string[];

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class CreateEventDto extends UpdateEventDto {
  @ApiProperty({ example: 'Kisan Mela · Barabanki' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  declare title: string;

  @ApiProperty({ enum: EVENT_TYPES })
  @IsIn(EVENT_TYPES)
  declare type: EventType;

  @ApiProperty({ example: '2026-10-25T10:00:00+05:30' })
  @IsDateString()
  declare starts_at: string;

  @ApiProperty({ example: 'Mandi Samiti ground, Barabanki' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  declare location: string;

  @ApiProperty({ example: 40 })
  @IsInt()
  @Min(1)
  @Max(MAX_SEATS)
  declare seats: number;
}

const SORTS = [
  'starts_at',
  '-starts_at',
  'created_at',
  '-created_at',
  'registered_count',
  '-registered_count',
] as const;

export class EventListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: SORTS, default: '-created_at' })
  @IsIn(SORTS)
  declare sort: string;

  @ApiPropertyOptional({ enum: EVENT_STATUSES })
  @IsOptional()
  @IsIn(EVENT_STATUSES)
  status?: EventStatus;

  @ApiPropertyOptional({ enum: EVENT_TYPES })
  @IsOptional()
  @IsIn(EVENT_TYPES)
  type?: EventType;

  @ApiPropertyOptional({ example: 'vistaar_agent' })
  @IsOptional()
  @Matches(COHORT_KEY)
  cohort?: string;
}

/** The partner's past events: newest first, paged. */
export class PastEventsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: ['-starts_at'], default: '-starts_at' })
  @IsIn(['-starts_at'])
  declare sort: string;
}
