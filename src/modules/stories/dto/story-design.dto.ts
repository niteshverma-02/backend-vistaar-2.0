import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

import { PageQueryDto } from '@common/dto/page-query.dto';

import {
  DESIGN_IMAGE_PATTERN,
  DESIGN_KEY,
  FESTIVAL_STATUSES,
  MAX_OVERLAY,
  STORY_TEMPLATES,
  type DesignColorKey,
  type FestivalStatus,
  type StoryTemplate,
} from '../stories.domain';

const COLORS_EXAMPLE = {
  bg_from: '#7A1F5C',
  bg_to: '#F29A1F',
  text: '#FFFFFF',
  accent: '#FFD84D',
  accent_text: '#3A1030',
};

export class UpdateStoryDesignDto {
  @ApiPropertyOptional({ example: { en: 'Diwali lights', hi: 'दीवाली रोशनी' } })
  @IsOptional()
  @IsObject()
  label?: Record<string, string>;

  @ApiPropertyOptional({
    example: COLORS_EXAMPLE,
    description:
      'The whole palette, `#RRGGBB` or `#RRGGBBAA`. Required: bg_from, bg_to, text, accent. ' +
      'Left out → derived: subtext (text at 82%), accent_text (bg_from), soft (white 16%), ' +
      'deco (white 7%), avatar (bg_from). On edit, replaces the stored palette.',
  })
  @IsOptional()
  @IsObject()
  colors?: Partial<Record<DesignColorKey, string>>;

  @ApiPropertyOptional({
    example: 'vistaar/story-designs/2b1f3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d.jpg',
    nullable: true,
    description:
      'Art from POST /admin/story-designs/image; null = colours only',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(DESIGN_IMAGE_PATTERN, {
    message: 'The image was not found. Please upload it again.',
  })
  image?: string | null;

  @ApiPropertyOptional({
    example: 0.35,
    description: `0–${MAX_OVERLAY}: bg_from laid over the art so text reads (default 0.35 with art)`,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(MAX_OVERLAY)
  overlay?: number;

  @ApiPropertyOptional({
    enum: STORY_TEMPLATES,
    isArray: true,
    example: ['festival', 'custom'],
    description: 'Templates it is offered on; empty = all',
  })
  @IsOptional()
  @IsArray()
  @IsIn(STORY_TEMPLATES, { each: true })
  templates?: StoryTemplate[];

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

  @ApiPropertyOptional({
    example: 5,
    description: 'Lower first; the first live one is the default',
  })
  @IsOptional()
  @IsInt()
  order?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class CreateStoryDesignDto extends UpdateStoryDesignDto {
  @ApiProperty({
    example: 'diwali_lights',
    description: 'Stable key; saved stories keep it, so it cannot change later',
  })
  @Matches(DESIGN_KEY, {
    message:
      'The short name can use only small letters, numbers and _, and must start with a letter (for example diwali_2026).',
  })
  key!: string;

  @ApiProperty({ example: { en: 'Diwali lights' } })
  @IsObject()
  declare label: Record<string, string>;

  @ApiProperty({ example: COLORS_EXAMPLE })
  @IsObject()
  declare colors: Partial<Record<DesignColorKey, string>>;
}

const SORTS = [
  'order',
  '-order',
  'created_at',
  '-created_at',
  'starts_at',
  '-starts_at',
] as const;

export class StoryDesignListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: SORTS, default: '-created_at' })
  @IsIn(SORTS)
  declare sort: string;

  @ApiPropertyOptional({ enum: FESTIVAL_STATUSES })
  @IsOptional()
  @IsIn(FESTIVAL_STATUSES)
  status?: FestivalStatus;
}

export class UploadedDesignImageDto {
  @ApiProperty({
    example: 'vistaar/story-designs/2b1f3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d.jpg',
    description: 'Send as `image` when saving the design',
  })
  path!: string;

  @ApiProperty({ description: 'Permanent download URL, for the preview' })
  url!: string;

  @ApiProperty({ example: 'image/jpeg' })
  content_type!: string;

  @ApiProperty({ example: 412344 })
  size!: number;

  @ApiProperty({ example: 1080 })
  width!: number;

  @ApiProperty({ example: 1920 })
  height!: number;
}
