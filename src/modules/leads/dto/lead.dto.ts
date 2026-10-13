import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { PageQueryDto } from '@common/dto/page-query.dto';
import { MOBILE_EXAMPLE } from '@common/utils/phone.util';

import {
  ACTIVITY_TYPES,
  FOUND_VIA,
  LEAD_STAGES,
  MAX_CROPS,
  type FoundVia,
  type LeadStage,
} from '../leads.domain';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const trimEach = ({ value }: { value: unknown }) =>
  Array.isArray(value)
    ? (value as unknown[]).map((v) => (typeof v === 'string' ? v.trim() : v))
    : value;

const toBool = ({ value }: { value: unknown }) =>
  value === true || value === 'true';

/** No farm is bigger; a larger figure is a typo. */
const MAX_ACRES = 10_000;
/** ₹10 crore — far above any first order. */
const MAX_EXPECTED_VALUE = 100_000_000;

/**
 * Add a farmer (Lovable "Add lead"). Mandatory (TL, PRD): name, mobile,
 * village, the farm — at least one crop and an area above 0 — and the
 * farmer's consent. Sending a mobile the partner already holds updates it.
 */
export class AddFarmerDto {
  @ApiProperty({ example: MOBILE_EXAMPLE, description: 'The farmer’s mobile' })
  @IsString()
  @MaxLength(20)
  phone!: string;

  @ApiProperty({ example: 'Ramesh Patel' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Enter the farmer’s name.' })
  @MaxLength(80)
  name!: string;

  @ApiProperty({ example: 'Rampur' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Enter the village.' })
  @MaxLength(80)
  village!: string;

  @ApiPropertyOptional({ example: 'Bhopal' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  district?: string;

  @ApiPropertyOptional({
    example: '462026',
    description: 'Sets the state (and the district when none is sent)',
  })
  @IsOptional()
  @Matches(/^[1-9]\d{5}$/, { message: 'Pincode must be 6 digits.' })
  pincode?: string;

  @ApiProperty({
    example: ['Wheat'],
    description: `Main crop first; 1 to ${MAX_CROPS}`,
  })
  @Transform(trimEach)
  @IsArray()
  @ArrayMinSize(1, { message: 'Pick the main crop.' })
  @ArrayMaxSize(MAX_CROPS)
  @IsString({ each: true })
  @IsNotEmpty({ each: true, message: 'A crop needs a name.' })
  @MaxLength(60, { each: true })
  crops!: string[];

  @ApiProperty({ example: 5, description: 'Total farm, in acres' })
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Enter acres.' })
  @IsPositive({ message: 'Farm area must be more than 0 acres.' })
  @Max(MAX_ACRES)
  acreage!: number;

  @ApiPropertyOptional({
    enum: FOUND_VIA,
    description: 'How you found the farmer',
  })
  @IsOptional()
  @IsIn(FOUND_VIA)
  found_via?: FoundVia;

  @ApiPropertyOptional({
    example: 2500,
    description: 'Expected first order, ₹',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_EXPECTED_VALUE)
  expected_value?: number;

  @ApiPropertyOptional({
    example: '2026-10-15T10:00:00+05:30',
    description: 'Next follow-up — must be in the future',
  })
  @IsOptional()
  @IsDateString()
  next_follow_up?: string;

  @ApiPropertyOptional({ example: 'Needs a fungicide for paddy blast' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiProperty({
    example: 1,
    description:
      'Version of the consent wording the partner ticked (`GET /leads/consent`)',
  })
  @IsInt()
  @Min(1)
  consent_version!: number;

  @ApiPropertyOptional({
    description:
      'Ex-employee partners: "I did not handle this farmer while at Katyayani in the last 12 months" — required for them',
  })
  @IsOptional()
  @IsBoolean()
  ex_employee_declared?: boolean;
}

/** Work a lead (Lovable lead detail): only what is sent changes; `null` clears. */
export class UpdateLeadDto {
  @ApiPropertyOptional({
    enum: LEAD_STAGES,
    description:
      '`won` is set by the first order, never sent; `lost` needs `lost_reason`',
  })
  @IsOptional()
  @IsIn(LEAD_STAGES)
  stage?: LeadStage;

  @ApiPropertyOptional({ example: 'Price too high' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  lost_reason?: string;

  @ApiPropertyOptional({
    example: '2026-10-15T10:00:00+05:30',
    nullable: true,
    description: 'Future date-time; `null` clears',
  })
  @IsOptional()
  @IsDateString()
  next_follow_up?: string | null;

  @ApiPropertyOptional({ example: 2500, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_EXPECTED_VALUE)
  expected_value?: number | null;
}

export class AddActivityDto {
  @ApiProperty({ enum: ACTIVITY_TYPES })
  @IsIn(ACTIVITY_TYPES)
  type!: (typeof ACTIVITY_TYPES)[number];

  @ApiProperty({ example: 'Called — will buy after rain' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Write what happened.' })
  @MaxLength(500)
  text!: string;
}

export class CheckPhoneQueryDto {
  @ApiProperty({ example: MOBILE_EXAMPLE })
  @IsString()
  @MaxLength(20)
  phone!: string;
}

export class PiiParamDto {
  @ApiProperty({ example: 'PII-1620070' })
  @Matches(/^PII-[A-Z0-9-]{1,20}$/i)
  piiId!: string;
}

export class FarmerLeadQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    description: 'Name, village, crop, or digits of the mobile',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  q?: string;

  @ApiPropertyOptional({ enum: LEAD_STAGES })
  @IsOptional()
  @IsIn(LEAD_STAGES)
  stage?: LeadStage;

  @ApiPropertyOptional({
    description: 'Only open leads whose follow-up is today or overdue',
  })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  due?: boolean;
}

export class AdminLeadQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    description: 'Name, village, crop, or digits of the mobile',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  q?: string;

  @ApiPropertyOptional({
    example: 'VST-000001',
    description: 'One partner’s farmers',
  })
  @IsOptional()
  @Matches(/^VST-\d+$/i)
  agent_id?: string;

  @ApiPropertyOptional({ enum: LEAD_STAGES })
  @IsOptional()
  @IsIn(LEAD_STAGES)
  stage?: LeadStage;

  @ApiPropertyOptional({ enum: ['created', 'linked'] })
  @IsOptional()
  @IsIn(['created', 'linked'])
  origin?: 'created' | 'linked';

  @ApiPropertyOptional({ example: 'MADHYA PRADESH' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  state?: string;

  @ApiPropertyOptional({
    example: '2026-10-01',
    description: 'Added on or after',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    example: '2026-10-31',
    description: 'Added on or before (whole day)',
  })
  @IsOptional()
  @IsDateString()
  to?: string;
}
