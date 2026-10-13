import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, Matches } from 'class-validator';

import { PageQueryDto } from '@common/dto/page-query.dto';

import { STORY_TEMPLATES, type StoryTemplate } from '../stories.domain';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const AGENT_ID = /^VST-\d+$/;

export class StoryStatsQueryDto {
  @ApiPropertyOptional({
    example: '2026-09-13',
    description: 'IST day; default 29 days before `to`',
  })
  @IsOptional()
  @Matches(DATE, {
    message: 'The start date is not valid (for example 2026-10-01).',
  })
  from?: string;

  @ApiPropertyOptional({
    example: '2026-10-12',
    description: 'IST day; default today',
  })
  @IsOptional()
  @Matches(DATE, {
    message: 'The end date is not valid (for example 2026-10-31).',
  })
  to?: string;
}

export class StoryPartnersQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ example: '2026-09-13' })
  @IsOptional()
  @Matches(DATE, {
    message: 'The start date is not valid (for example 2026-10-01).',
  })
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-12' })
  @IsOptional()
  @Matches(DATE, {
    message: 'The end date is not valid (for example 2026-10-31).',
  })
  to?: string;
}

const SORTS = [
  'last_used_at',
  '-last_used_at',
  'created_at',
  '-created_at',
  'share_count',
  '-share_count',
] as const;

export class AdminStoryListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: SORTS, default: '-created_at' })
  @IsIn(SORTS)
  declare sort: string;

  @ApiPropertyOptional({ example: 'VST-000001' })
  @IsOptional()
  @Matches(AGENT_ID, {
    message: 'The partner ID is not valid (for example VST-123).',
  })
  agent_id?: string;

  @ApiPropertyOptional({ enum: STORY_TEMPLATES })
  @IsOptional()
  @IsIn(STORY_TEMPLATES)
  template?: StoryTemplate;
}
