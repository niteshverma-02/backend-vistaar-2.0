import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import { PageQueryDto } from '@common/dto/page-query.dto';
import { MOBILE_EXAMPLE } from '@common/utils/phone.util';
import { DATE_PATTERN } from '@modules/attendance/attendance.domain';

import {
  MAX_ATTENDEES,
  MEETING_STATUSES,
  MEETING_TYPES,
  ORGANISERS,
  type MeetingStatus,
  type MeetingType,
  type Organiser,
} from '../meetings.domain';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const PINCODE = /^[1-9]\d{5}$/;
const PII_ID = /^PII-[A-Z0-9-]{1,20}$/i;
const PARTNER_ID = /^VST-[A-Z0-9-]{1,30}$/;

export class MeetingParamDto {
  @ApiProperty({ example: '6f1c2b0e-9a4d-4c1e-8b7a-2d5e3f4a1b9c' })
  @IsUUID()
  id!: string;
}

export class AttendeeParamDto extends MeetingParamDto {
  @ApiProperty({ example: MOBILE_EXAMPLE })
  @Matches(/^[6-9]\d{9}$/, { message: 'Use the 10-digit mobile.' })
  phone!: string;
}

/** What can change while the meeting is scheduled; only what is sent changes. */
export class UpdateMeetingDto {
  @ApiPropertyOptional({ enum: MEETING_TYPES })
  @IsOptional()
  @IsIn(MEETING_TYPES)
  type?: MeetingType;

  @ApiPropertyOptional({
    example: 'Crop demo · Rampur',
    description: 'Empty = "<type> · <village>"',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  title?: string;

  @ApiPropertyOptional({
    example: '2026-10-20T10:00:00+05:30',
    description: 'Must be in the future',
  })
  @IsOptional()
  @IsDateString()
  starts_at?: string;

  @ApiPropertyOptional({ example: 'Rampur' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Enter the village.' })
  @MaxLength(80)
  village?: string;

  @ApiPropertyOptional({ example: 'Panchayat bhawan', nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  venue?: string | null;

  @ApiPropertyOptional({
    example: '462026',
    nullable: true,
    description: 'Where WhatsApp invites will go once it is connected',
  })
  @IsOptional()
  @Matches(PINCODE, { message: 'Pincode must be 6 digits.' })
  pincode?: string | null;

  @ApiPropertyOptional({ enum: ORGANISERS })
  @IsOptional()
  @IsIn(ORGANISERS)
  organiser?: Organiser;

  @ApiPropertyOptional({
    example: 'Topics, products to demo, samples needed',
    nullable: true,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  agenda?: string | null;
}

export class CreateMeetingDto extends UpdateMeetingDto {
  @ApiProperty({
    description: 'The app makes the UUID, so a retried create is one meeting',
  })
  @IsUUID()
  id!: string;

  @ApiProperty({ enum: MEETING_TYPES })
  @IsIn(MEETING_TYPES)
  declare type: MeetingType;

  @ApiProperty({ example: '2026-10-20T10:00:00+05:30' })
  @IsDateString()
  declare starts_at: string;

  @ApiProperty({ example: 'Rampur' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Enter the village.' })
  @MaxLength(80)
  declare village: string;

  @ApiPropertyOptional({
    example: ['PII-1620070'],
    description: `Your own leads and customers to invite (\`GET /meetings/invitees\`); at most ${MAX_ATTENDEES}`,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ATTENDEES)
  @Matches(PII_ID, { each: true })
  invite?: string[];
}

export class CancelMeetingDto {
  @ApiPropertyOptional({ example: 'Rain' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class AttendeeInputDto {
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

  @ApiProperty()
  @IsBoolean()
  present!: boolean;
}

/** The whole list — invited farmers and walk-ins — as it now stands. */
export class AttendeesDto {
  @ApiProperty({ type: [AttendeeInputDto] })
  @IsArray()
  @ArrayMaxSize(MAX_ATTENDEES)
  @ValidateNested({ each: true })
  @Type(() => AttendeeInputDto)
  attendees!: AttendeeInputDto[];
}

export class MeetingsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    enum: MEETING_STATUSES,
    description: 'scheduled: soonest first; otherwise newest first',
  })
  @IsOptional()
  @IsIn(MEETING_STATUSES)
  status?: MeetingStatus;
}

export class InviteesQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: 'Name, village, crop, or mobile digits' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  q?: string;

  @ApiPropertyOptional({
    example: 'Rampur',
    description: "The meeting's village: those farmers come first",
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  village?: string;
}

export class AdminMeetingsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ example: 'VST-000006' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(PARTNER_ID, { message: 'This partner id is not valid.' })
  agent_id?: string;

  @ApiPropertyOptional({ enum: MEETING_STATUSES })
  @IsOptional()
  @IsIn(MEETING_STATUSES)
  status?: MeetingStatus;

  @ApiPropertyOptional({
    example: '2026-10-01',
    description: 'IST day, included',
  })
  @IsOptional()
  @Matches(DATE_PATTERN, { message: 'Use a date like 2026-10-01.' })
  from?: string;

  @ApiPropertyOptional({
    example: '2026-10-31',
    description: 'IST day, included',
  })
  @IsOptional()
  @Matches(DATE_PATTERN, { message: 'Use a date like 2026-10-31.' })
  to?: string;
}
