import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import { PageQueryDto } from '@common/dto/page-query.dto';
import { MOBILE_EXAMPLE } from '@common/utils/phone.util';
import { DATE_PATTERN } from '@modules/attendance/attendance.domain';

import {
  GIG_STATUSES,
  MAX_GIG_ATTENDEES,
  MAX_GIG_PHOTOS,
  type GigStatus,
} from '../gigs.domain';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;
const GIG_ID = /^GIG-\d{6,}$/;
const PARTNER_ID = /^VST-[A-Z0-9-]{1,30}$/;
const COHORT_KEY = /^[a-z][a-z0-9_]{1,40}$/;

export class GigParamDto {
  @ApiProperty({ example: 'GIG-000001' })
  @Transform(upper)
  @Matches(GIG_ID, { message: 'This gig id is not valid.' })
  id!: string;
}

export class GigPhotoParamDto extends GigParamDto {
  @ApiProperty({ description: 'The photo id from the gig' })
  @Matches(/^[0-9a-f-]{36}$/i)
  photoId!: string;
}

export class PointDto {
  @ApiProperty({ example: 23.2599 })
  @IsLatitude()
  lat!: number;

  @ApiProperty({ example: 77.4126 })
  @IsLongitude()
  lng!: number;
}

// ── App ──────────────────────────────────────────────────────────────────

export const GIG_TABS = ['available', 'mine', 'history'] as const;
export type GigTab = (typeof GIG_TABS)[number];

export class GigsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    enum: GIG_TABS,
    default: 'available',
    description:
      'available: open gigs for my cohort and state, nearest first; mine: held or in review; history: decided or cancelled',
  })
  @IsOptional()
  @IsIn(GIG_TABS)
  tab: GigTab = 'available';
}

export class CheckinDto {
  @ApiPropertyOptional({
    type: PointDto,
    description: 'The phone GPS now; leave out when there is no fix (flagged)',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PointDto)
  location?: PointDto;

  @ApiPropertyOptional({ example: 12, description: 'GPS accuracy, m' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100000)
  accuracy_m?: number;
}

export class GigAttendeeDto {
  @ApiProperty({ example: MOBILE_EXAMPLE })
  @IsString()
  @MaxLength(20)
  phone!: string;

  @ApiProperty({ example: 'Ramesh Patel' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Enter the farmer’s name.' })
  @MaxLength(80)
  name!: string;

  @ApiPropertyOptional({ example: 'Rampur' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  village?: string;
}

/** The whole list of farmers present, as it now stands. */
export class GigAttendeesDto {
  @ApiProperty({ type: [GigAttendeeDto] })
  @IsArray()
  @ArrayMaxSize(MAX_GIG_ATTENDEES)
  @ValidateNested({ each: true })
  @Type(() => GigAttendeeDto)
  attendees!: GigAttendeeDto[];
}

export const GIG_PHOTO_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
] as const;

export class GigPhotoTicketDto {
  @ApiProperty({ enum: GIG_PHOTO_TYPES })
  @IsIn(GIG_PHOTO_TYPES)
  content_type!: (typeof GIG_PHOTO_TYPES)[number];

  @ApiProperty({ example: 850000, description: 'Bytes' })
  @IsInt()
  @Min(1)
  size!: number;
}

export class AddGigPhotoDto {
  @ApiProperty({
    description: 'The `path` from the upload ticket, after the PUT',
  })
  @IsString()
  @MaxLength(300)
  path!: string;
}

// ── HO ───────────────────────────────────────────────────────────────────

/** What HO may change while nobody holds the gig; only what is sent changes. */
export class UpdateGigDto {
  @ApiPropertyOptional({ example: 'Paddy blast demo · Rampur' })
  @ValidateIf((_, v) => v !== undefined)
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title?: string;

  @ApiPropertyOptional({ example: 'Rampur' })
  @ValidateIf((_, v) => v !== undefined)
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  village?: string;

  @ApiPropertyOptional({ example: 'Bhopal', nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  district?: string | null;

  @ApiPropertyOptional({ example: 'MADHYA PRADESH', nullable: true })
  @IsOptional()
  @Transform(upper)
  @IsString()
  @MaxLength(60)
  state?: string | null;

  @ApiPropertyOptional({ example: '462026', nullable: true })
  @IsOptional()
  @Matches(/^[1-9]\d{5}$/, { message: 'Pincode must be 6 digits.' })
  pincode?: string | null;

  @ApiPropertyOptional({ example: 'Panchayat bhawan', nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  venue?: string | null;

  @ApiPropertyOptional({
    type: PointDto,
    nullable: true,
    description: 'Pin the venue: check-in distance is measured from it',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PointDto)
  venue_point?: PointDto | null;

  @ApiPropertyOptional({ example: '2026-10-25T10:00:00+05:30' })
  @ValidateIf((_, v) => v !== undefined)
  @IsDateString()
  starts_at?: string;

  @ApiPropertyOptional({ example: '2026-10-25T12:00:00+05:30' })
  @ValidateIf((_, v) => v !== undefined)
  @IsDateString()
  ends_at?: string;

  @ApiPropertyOptional({ example: 25 })
  @ValidateIf((_, v) => v !== undefined)
  @IsInt()
  @Min(0)
  @Max(MAX_GIG_ATTENDEES)
  expected_farmers?: number;

  @ApiPropertyOptional({
    example: 15,
    description: 'Default: settings `gig_min_farmers`',
  })
  @ValidateIf((_, v) => v !== undefined)
  @IsInt()
  @Min(1)
  @Max(MAX_GIG_ATTENDEES)
  min_farmers?: number;

  @ApiPropertyOptional({
    example: 3,
    description: 'Default: settings `gig_photos_required`',
  })
  @ValidateIf((_, v) => v !== undefined)
  @IsInt()
  @Min(0)
  @Max(MAX_GIG_PHOTOS)
  photos_required?: number;

  @ApiPropertyOptional({
    example: 250,
    description: '₹. Default: settings `gig_payout`',
  })
  @ValidateIf((_, v) => v !== undefined)
  @IsInt()
  @Min(0)
  @Max(100000)
  payout?: number;

  @ApiPropertyOptional({ example: ['Humic acid 98%'] })
  @ValidateIf((_, v) => v !== undefined)
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  products?: string[];

  @ApiPropertyOptional({ example: ['2 testimonials', 'Banner photo'] })
  @ValidateIf((_, v) => v !== undefined)
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  requirements?: string[];

  @ApiPropertyOptional({
    example: ['vistaar_agent'],
    description: 'Empty = every partner',
  })
  @ValidateIf((_, v) => v !== undefined)
  @IsArray()
  @ArrayMaxSize(20)
  @Matches(COHORT_KEY, { each: true })
  cohorts?: string[];
}

export class CreateGigDto extends UpdateGigDto {
  @ApiProperty({ example: 'Paddy blast demo · Rampur' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  declare title: string;

  @ApiProperty({ example: 'Rampur' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  declare village: string;

  @ApiProperty({ example: '2026-10-25T10:00:00+05:30' })
  @IsDateString()
  declare starts_at: string;

  @ApiProperty({ example: '2026-10-25T12:00:00+05:30' })
  @IsDateString()
  declare ends_at: string;
}

export class AssignGigDto {
  @ApiProperty({ example: 'VST-000006' })
  @Transform(upper)
  @Matches(PARTNER_ID, { message: 'This partner id is not valid.' })
  agent_id!: string;
}

export class GigReasonDto {
  @ApiProperty({ example: 'Photos do not show the meeting' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Give a reason — the partner sees it.' })
  @MaxLength(300)
  reason!: string;
}

export class AdminGigsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: GIG_STATUSES })
  @IsOptional()
  @IsIn(GIG_STATUSES)
  status?: GigStatus;

  @ApiPropertyOptional({ example: 'VST-000006' })
  @IsOptional()
  @Transform(upper)
  @Matches(PARTNER_ID, { message: 'This partner id is not valid.' })
  agent_id?: string;

  @ApiPropertyOptional({ example: 'MADHYA PRADESH' })
  @IsOptional()
  @Transform(upper)
  @IsString()
  @MaxLength(60)
  state?: string;

  @ApiPropertyOptional({ example: 'Bhopal' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  district?: string;

  @ApiPropertyOptional({
    example: '2026-10-01',
    description: 'IST day of the gig, included',
  })
  @IsOptional()
  @Matches(DATE_PATTERN, { message: 'Use a date like 2026-10-01.' })
  from?: string;

  @ApiPropertyOptional({
    example: '2026-10-31',
    description: 'IST day of the gig, included',
  })
  @IsOptional()
  @Matches(DATE_PATTERN, { message: 'Use a date like 2026-10-31.' })
  to?: string;
}
