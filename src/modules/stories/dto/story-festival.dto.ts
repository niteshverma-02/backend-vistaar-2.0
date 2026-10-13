import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

import { PageQueryDto } from '@common/dto/page-query.dto';

import {
  FESTIVAL_KEY,
  FESTIVAL_STATUSES,
  type FestivalStatus,
  type FestivalText,
} from '../stories.domain';

export class UpdateStoryFestivalDto {
  @ApiPropertyOptional({ example: { en: 'Diwali', hi: 'दीपावली' } })
  @IsOptional()
  @IsObject()
  label?: Record<string, string>;

  @ApiPropertyOptional({ example: '🪔' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  emoji?: string;

  @ApiPropertyOptional({
    example: {
      en: {
        headline: 'Happy Diwali',
        body: 'May your home and fields be filled with joy and a bumper harvest.',
      },
      hi: {
        headline: 'दीपावली की हार्दिक शुभकामनाएँ',
        body: 'आपके घर और खेत में सुख, समृद्धि और भरपूर फसल हो।',
      },
    },
    description: 'Per language: `headline` and `body`; `en` required',
  })
  @IsOptional()
  @IsObject()
  text?: Record<string, FestivalText>;

  @ApiPropertyOptional({ example: '2026-10-25T00:00:00+05:30', nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsDateString()
  starts_at?: string | null;

  @ApiPropertyOptional({ example: '2026-11-05T23:59:59+05:30', nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsDateString()
  ends_at?: string | null;

  @ApiPropertyOptional({ example: 1, description: 'Lower first' })
  @IsOptional()
  @IsInt()
  order?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class CreateStoryFestivalDto extends UpdateStoryFestivalDto {
  @ApiProperty({
    example: 'diwali',
    description: 'Stable key; cannot change later',
  })
  @Matches(FESTIVAL_KEY, {
    message:
      'The short name can use only small letters, numbers and _, and must start with a letter (for example diwali_2026).',
  })
  key!: string;

  @ApiProperty({ example: { en: 'Diwali' } })
  @IsObject()
  declare label: Record<string, string>;

  @ApiProperty({ example: '🪔' })
  @IsString()
  @MaxLength(16)
  declare emoji: string;

  @ApiProperty()
  @IsObject()
  declare text: Record<string, FestivalText>;
}

const SORTS = [
  'order',
  '-order',
  'created_at',
  '-created_at',
  'starts_at',
  '-starts_at',
] as const;

export class StoryFestivalListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: SORTS, default: '-created_at' })
  @IsIn(SORTS)
  declare sort: string;

  @ApiPropertyOptional({ enum: FESTIVAL_STATUSES })
  @IsOptional()
  @IsIn(FESTIVAL_STATUSES)
  status?: FestivalStatus;
}
