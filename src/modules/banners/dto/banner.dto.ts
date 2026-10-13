import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

import { PageQueryDto } from '@common/dto/page-query.dto';

import {
  BANNER_IMAGE_PATTERN,
  BANNER_REORDER_MAX,
  BANNER_STATUSES,
  BANNER_TONES,
  LINK_PATTERN,
  type BannerStatus,
  type BannerTone,
} from '../banners.domain';

const COHORT_KEY = /^[a-z][a-z0-9_]{1,40}$/;

export class UpdateBannerDto {
  @ApiPropertyOptional({
    example: { en: 'Rabi Booking Open', hi: 'रबी बुकिंग शुरू' },
  })
  @IsOptional()
  @IsObject()
  title?: Record<string, string>;

  @ApiPropertyOptional({
    example: {
      en: 'Book humic acid & zinc before 15 Oct — extra 3% on orders above ₹10,000',
    },
    nullable: true,
    description: 'Required without an image',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsObject()
  subtitle?: Record<string, string> | null;

  @ApiPropertyOptional({
    example: { en: 'Book now', hi: 'अभी बुक करें' },
    nullable: true,
    description: 'Button text; required without an image',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsObject()
  cta?: Record<string, string> | null;

  @ApiPropertyOptional({
    example: 'vistaar/banners/2b1f3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d.jpg',
    nullable: true,
    description:
      'The `path` from `POST /admin/banners/image`; null = a banner the app draws from text',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(BANNER_IMAGE_PATTERN, {
    message: 'The banner image was not found. Please upload it again.',
  })
  image?: string | null;

  @ApiPropertyOptional({
    example: '/products',
    description: 'In-app route, starting with `/`',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  @Matches(LINK_PATTERN, {
    message:
      'The link must be a screen in the app, for example /products or /events.',
  })
  link?: string;

  @ApiPropertyOptional({ enum: BANNER_TONES, example: 'primary' })
  @IsOptional()
  @IsIn(BANNER_TONES)
  tone?: BannerTone;

  @ApiPropertyOptional({ example: '🌾', nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(16)
  emoji?: string | null;

  @ApiPropertyOptional({
    example: ['vistaar_agent', 'ex_employee'],
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

  @ApiPropertyOptional({
    example: '2026-10-01T00:00:00+05:30',
    nullable: true,
    description: 'Not shown before; null = at once',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsDateString()
  starts_at?: string | null;

  @ApiPropertyOptional({
    example: '2026-10-15T23:59:59+05:30',
    nullable: true,
    description: 'Not shown from; null = never ends',
  })
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

export class CreateBannerDto extends UpdateBannerDto {
  @ApiProperty({ example: { en: 'Rabi Booking Open' } })
  @IsObject()
  declare title: Record<string, string>;

  @ApiProperty({ example: '/products' })
  @IsString()
  @MaxLength(300)
  @Matches(LINK_PATTERN, {
    message:
      'The link must be a screen in the app, for example /products or /events.',
  })
  declare link: string;
}

const SORTS = [
  'order',
  '-order',
  'created_at',
  '-created_at',
  'updated_at',
  '-updated_at',
  'starts_at',
  '-starts_at',
  'ends_at',
  '-ends_at',
] as const;

export class BannerListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: SORTS, default: '-created_at' })
  @IsIn(SORTS)
  declare sort: string;

  @ApiPropertyOptional({ enum: BANNER_STATUSES })
  @IsOptional()
  @IsIn(BANNER_STATUSES)
  status?: BannerStatus;

  @ApiPropertyOptional({
    example: 'vistaar_agent',
    description: 'Banners this cohort sees (its own + every-partner ones)',
  })
  @IsOptional()
  @Matches(COHORT_KEY)
  cohort?: string;
}

/** The whole carousel, first slide first. Every banner, so no two end up on one position. */
export class ReorderBannersDto {
  @ApiProperty({
    type: [String],
    example: ['2b1f3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'],
    description: 'Every banner id, in the new order',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BANNER_REORDER_MAX)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  ids!: string[];
}

export class UploadedBannerImageDto {
  @ApiProperty({
    example: 'vistaar/banners/2b1f3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d.jpg',
    description: 'Send as `image` when saving the banner',
  })
  path!: string;

  @ApiProperty({ description: 'Permanent download URL, for the preview' })
  url!: string;

  @ApiProperty({ example: 'image/jpeg' })
  content_type!: string;

  @ApiProperty({ example: 182344 })
  size!: number;

  @ApiProperty({ example: 1200 })
  width!: number;

  @ApiProperty({ example: 400 })
  height!: number;
}
