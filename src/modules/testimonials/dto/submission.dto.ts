import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { PageQueryDto } from '@common/dto/page-query.dto';

import {
  CONSENT_LANGS,
  type ConsentLang,
} from '../schemas/testimonial-consent.schema';
import {
  RATING_MAX,
  RATING_MIN,
  SUBMISSION_KINDS,
  SUBMISSION_STATUSES,
  VIDEO_MAX_SECONDS,
  type SubmissionKind,
  type SubmissionStatus,
} from '../testimonials.domain';

const PII_ID = /^PII-\d+$/i;
const AGENT_ID = /^VST-\d+$/i;

export class UploadRequestDto {
  @ApiProperty({ enum: ['video', 'photo'], example: 'video' })
  @IsIn(['video', 'photo'])
  kind!: 'video' | 'photo';

  @ApiProperty({ example: 'video/mp4' })
  @IsString()
  @MaxLength(60)
  content_type!: string;

  @ApiProperty({ example: 18_874_368, description: 'Bytes' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  size!: number;
}

export class UploadTicketDto {
  @ApiProperty({
    example: 'vistaar/testimonials/VST-000123/video/3f1c….mp4',
    description: 'Send this as `media_path` when submitting',
  })
  path!: string;
  @ApiProperty({ description: 'PUT the file here' })
  upload_url!: string;
  @ApiProperty({ example: 'PUT' })
  method!: 'PUT';
  @ApiProperty({
    description: 'Send exactly these headers with the PUT',
    example: {
      'Content-Type': 'video/mp4',
      'x-goog-content-length-range': '1,62914560',
    },
  })
  headers!: Record<string, string>;
  @ApiProperty()
  expires_at!: Date;
}

export class SubmitTestimonialDto {
  @ApiProperty({
    example: '0b6e7c1e-2f7a-4c55-9a43-6b0f0e3f8a11',
    description:
      'Made by the app once per testimonial; a retry with the same id returns the first',
  })
  @IsUUID()
  id!: string;

  @ApiProperty({
    example: 'PII-1618191',
    description: 'One of your own farmers (leads)',
  })
  @Matches(PII_ID, { message: 'Please pick the farmer from your list.' })
  pii_id!: string;

  @ApiPropertyOptional({
    example: 'BK-48',
    description: 'The product (bulk SKU). Send this or `family`.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  bulk?: string;

  @ApiPropertyOptional({ description: 'A combo family. Send this or `bulk`.' })
  @IsOptional()
  @IsString()
  @MaxLength(400)
  family?: string;

  @ApiProperty({ example: 'Wheat' })
  @IsString()
  @IsNotEmpty({ message: 'Enter the crop' })
  @MaxLength(40)
  crop!: string;

  @ApiProperty({ enum: SUBMISSION_KINDS, example: 'video' })
  @IsIn(SUBMISSION_KINDS)
  kind!: SubmissionKind;

  @ApiPropertyOptional({
    description:
      'From `POST /testimonials/uploads`. Required for video / photo',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  media_path?: string;

  @ApiPropertyOptional({
    example: 42,
    description: `Video only, 1–${VIDEO_MAX_SECONDS} seconds`,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(VIDEO_MAX_SECONDS)
  duration_sec?: number;

  @ApiPropertyOptional({
    example: 'Yield went up after two sprays.',
    description: "The farmer's words. Required for a quote",
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  text?: string;

  @ApiProperty({ minimum: RATING_MIN, maximum: RATING_MAX, example: 5 })
  @Type(() => Number)
  @IsInt({ message: 'Give a rating' })
  @Min(RATING_MIN, { message: 'Give a rating' })
  @Max(RATING_MAX)
  rating!: number;

  @ApiProperty({
    example: 1,
    description:
      'The `version` from `GET /testimonials/consent` the farmer agreed to',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  consent_version!: number;

  @ApiProperty({ enum: CONSENT_LANGS, example: 'hi' })
  @IsIn(CONSENT_LANGS)
  consent_lang!: ConsentLang;
}

export class MineQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: SUBMISSION_STATUSES })
  @IsOptional()
  @IsIn(SUBMISSION_STATUSES)
  status?: SubmissionStatus;
}

export class LibraryQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: ['shared', 'newest'], default: 'shared' })
  @IsIn(['shared', 'newest'])
  declare sort: string;

  @ApiPropertyOptional({
    description: 'Farmer, village, district, product, crop or words',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;

  @ApiPropertyOptional({ example: 'BK-48' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  bulk?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(400)
  family?: string;

  @ApiPropertyOptional({ example: 'Wheat' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  crop?: string;

  @ApiPropertyOptional({ enum: SUBMISSION_KINDS })
  @IsOptional()
  @IsIn(SUBMISSION_KINDS)
  kind?: SubmissionKind;

  @ApiPropertyOptional({ description: '"Near me": the partner’s state' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  state?: string;

  @ApiPropertyOptional({ description: '"Near me": the partner’s district' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  district?: string;

  constructor() {
    super();
    this.sort = 'shared';
  }
}

const ADMIN_SORTS = [
  'created_at',
  '-created_at',
  'updated_at',
  '-updated_at',
  '-shares',
] as const;

export class AdminSubmissionQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: ADMIN_SORTS, default: '-created_at' })
  @IsIn(ADMIN_SORTS)
  declare sort: string;

  @ApiPropertyOptional({ enum: SUBMISSION_STATUSES })
  @IsOptional()
  @IsIn(SUBMISSION_STATUSES)
  status?: SubmissionStatus;

  @ApiPropertyOptional({ enum: SUBMISSION_KINDS })
  @IsOptional()
  @IsIn(SUBMISSION_KINDS)
  kind?: SubmissionKind;

  @ApiPropertyOptional({ example: 'VST-000123' })
  @IsOptional()
  @Matches(AGENT_ID, { message: 'Please enter a partner ID like VST-000123.' })
  agent_id?: string;

  @ApiPropertyOptional({
    description: 'Farmer, phone, partner, village, product or crop',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;
}

export class RejectDto {
  @ApiProperty({
    example: 'The video is too dark — please record again in daylight.',
    description: 'Shown to the partner',
  })
  @IsString()
  @IsNotEmpty({ message: 'Please write why it was not approved.' })
  @MaxLength(300)
  reason!: string;
}

export class RemoveDto {
  @ApiPropertyOptional({
    example: 'Product discontinued',
    description: 'Shown to the partner',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class WithdrawConsentDto {
  @ApiProperty({
    example: 'Farmer called the helpline on 14 Oct and asked to remove it.',
  })
  @IsString()
  @IsNotEmpty({ message: 'Please write how the farmer asked for this.' })
  @MaxLength(300)
  reason!: string;
}
