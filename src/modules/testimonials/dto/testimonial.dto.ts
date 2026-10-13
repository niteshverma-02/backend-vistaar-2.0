import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import { PageQueryDto } from '@common/dto/page-query.dto';

import {
  MEDIA_TYPES,
  MEDIA_URL,
  TESTIMONIAL_STATUSES,
  TESTIMONIAL_TYPES,
  type MediaType,
  type TestimonialStatus,
  type TestimonialType,
} from '../testimonials.domain';

export class TestimonialMediaDto {
  @ApiProperty({ enum: MEDIA_TYPES, example: 'video' })
  @IsIn(MEDIA_TYPES)
  media_type!: MediaType;

  @ApiProperty({
    example: 'https://firebasestorage.googleapis.com/…/story.mp4',
  })
  @IsString()
  @MaxLength(2000)
  @Matches(MEDIA_URL, {
    message: 'The photo or video link must start with https://.',
  })
  media_url!: string;
}

export class TestimonialPersonDto {
  @ApiProperty({
    example: '9155061725',
    description: 'Indian mobile; stored as +91…',
  })
  @IsString()
  contact!: string;

  @ApiPropertyOptional({ example: 'Ramu Kaka' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;
}

export class CreateTestimonialDto {
  @ApiPropertyOptional({
    example: 'NEEM-BULK-001',
    description: 'A product (bulk SKU). Send this or `family`.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  bulk?: string;

  @ApiPropertyOptional({
    example: 'FAM-NEEM-001',
    description: 'A combo family. Send this or `bulk`.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  family?: string;

  @ApiProperty({ type: TestimonialMediaDto })
  @ValidateNested()
  @Type(() => TestimonialMediaDto)
  media!: TestimonialMediaDto;

  @ApiPropertyOptional({ example: 'Great results on my crop!' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  review?: string;

  @ApiProperty({ type: TestimonialPersonDto })
  @ValidateNested()
  @Type(() => TestimonialPersonDto)
  user!: TestimonialPersonDto;

  @ApiPropertyOptional({
    example: false,
    description: 'true = approved at once',
  })
  @IsOptional()
  @IsBoolean()
  verified?: boolean;
}

/** Everything HO may change; `bulk` / `family` / `source` stay as filed. */
export class UpdateTestimonialDto {
  @ApiPropertyOptional({
    description: 'Approve (true) or send back to review (false)',
  })
  @IsOptional()
  @IsBoolean()
  verified?: boolean;

  @ApiPropertyOptional({
    description: 'Remove (true) or restore (false); nothing is lost',
  })
  @IsOptional()
  @IsBoolean()
  deleted?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  review?: string;

  @ApiPropertyOptional({ type: TestimonialMediaDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => TestimonialMediaDto)
  media?: TestimonialMediaDto;

  @ApiPropertyOptional({ example: 'Ramu Kaka' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;
}

const SORTS = [
  'created_at',
  '-created_at',
  'updated_at',
  '-updated_at',
] as const;

export class TestimonialListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: SORTS, default: '-created_at' })
  @IsIn(SORTS)
  declare sort: string;

  @ApiPropertyOptional({ enum: TESTIMONIAL_STATUSES })
  @IsOptional()
  @IsIn(TESTIMONIAL_STATUSES)
  status?: TestimonialStatus;

  @ApiPropertyOptional({ enum: TESTIMONIAL_TYPES })
  @IsOptional()
  @IsIn(TESTIMONIAL_TYPES)
  type?: TestimonialType;

  @ApiPropertyOptional({ enum: MEDIA_TYPES })
  @IsOptional()
  @IsIn(MEDIA_TYPES)
  media_type?: MediaType;

  @ApiPropertyOptional({ description: 'Words, name, phone, bulk or family' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;
}
