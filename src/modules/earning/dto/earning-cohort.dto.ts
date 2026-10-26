import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDefined,
  IsInt,
  IsNotEmpty,
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

import {
  COHORT_ID_PATTERN,
  COHORT_KEY_PATTERN,
  DAY_KEY_PATTERN,
  MAX_COHORT_CONDITIONS,
  MAX_DISTRICTS,
  MAX_PINCODES,
  MAX_STATES,
} from '../earning.domain';
import { RuleConditionDto } from './earning-rule.dto';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const lower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;
const eachTrim = ({ value }: { value: unknown }) =>
  Array.isArray(value)
    ? value.map((v: unknown) => (typeof v === 'string' ? v.trim() : v))
    : value;
const eachUpper = ({ value }: { value: unknown }) =>
  Array.isArray(value)
    ? value.map((v: unknown) =>
        typeof v === 'string' ? v.trim().toUpperCase() : v,
      )
    : value;
const toBool = ({ value }: { value: unknown }) =>
  value === true || value === 'true' || value === '1'
    ? true
    : value === false || value === 'false' || value === '0'
      ? false
      : value;

const PINCODE = /^[1-9]\d{5}$/;
const STARTS_ON =
  'IST day the cohort starts taking partners, included (`YYYY-MM-DD`); null / left out = open. Not on ec_default (400 EARNING_COHORT_LOCKED)';
const ENDS_ON =
  'IST day the cohort stops taking partners, included (`YYYY-MM-DD`), on or after starts_on; null / left out = open. Not on ec_default (400 EARNING_COHORT_LOCKED)';
const PAYOUT_MAX = 100_000;
const COUNT_MAX = 100_000;

/** Several values = any of them; filters together = all; empty / null = not used. */
export class EarningFiltersDto {
  @ApiPropertyOptional({
    type: [String],
    example: ['MADHYA PRADESH'],
    description: 'Profile state is any of these (kept upper case)',
  })
  @IsOptional()
  @Transform(eachUpper)
  @IsArray()
  @ArrayMaxSize(MAX_STATES)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(60, { each: true })
  states?: string[] | null;

  @ApiPropertyOptional({
    type: [String],
    example: ['Bhopal', 'Sehore'],
    description: 'Profile district is any of these (any case)',
  })
  @IsOptional()
  @Transform(eachTrim)
  @IsArray()
  @ArrayMaxSize(MAX_DISTRICTS)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(60, { each: true })
  districts?: string[] | null;

  @ApiPropertyOptional({
    type: [String],
    example: ['462026'],
    description: 'Profile pincode is any of these',
  })
  @IsOptional()
  @Transform(eachTrim)
  @IsArray()
  @ArrayMaxSize(MAX_PINCODES)
  @Matches(PINCODE, { each: true, message: 'Each pincode must be 6 digits.' })
  pincodes?: string[] | null;

  @ApiPropertyOptional({
    example: 10,
    nullable: true,
    description:
      'Open leads (not won, not lost) the partner holds now ≥ this; null or 0 = not used',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(COUNT_MAX)
  min_leads?: number | null;

  @ApiPropertyOptional({
    example: 5,
    nullable: true,
    description:
      'Customers (won leads) the partner holds now ≥ this; null or 0 = not used',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(COUNT_MAX)
  min_customers?: number | null;
}

export class CreateEarningCohortDto {
  @ApiProperty({ example: 'Paddy belt, 10+ leads' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name!: string;

  @ApiPropertyOptional({
    example: 'paddy_belt',
    description:
      'The id to use (`ec_` added if missing); left out = made from the name. Never changes.',
  })
  @IsOptional()
  @Transform(lower)
  @Matches(COHORT_KEY_PATTERN, {
    message: 'The key is lower-case letters, digits and _ (at most 40).',
  })
  key?: string;

  @ApiPropertyOptional({ example: 'Bhopal division partners with a book' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  description?: string | null;

  @ApiPropertyOptional({
    type: [RuleConditionDto],
    description: `What places a partner here — all must hold, a list value on any entry (1–${MAX_COHORT_CONDITIONS}). Checked against GET /admin/earning-cohorts/catalog.`,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_COHORT_CONDITIONS)
  @ValidateNested({ each: true })
  @Type(() => RuleConditionDto)
  conditions?: RuleConditionDto[];

  @ApiPropertyOptional({
    type: EarningFiltersDto,
    description:
      'The legacy shape, taken only when `conditions` is absent and converted to conditions',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => EarningFiltersDto)
  filters?: EarningFiltersDto;

  @ApiPropertyOptional({
    example: 300,
    nullable: true,
    description:
      '₹ a meeting gig pays when HO leaves the gig payout empty; null = settings gig_payout',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(PAYOUT_MAX)
  meeting_gig_payout?: number | null;

  @ApiPropertyOptional({
    example: 10,
    nullable: true,
    description:
      'At most this % of an order subtotal its partners may pay with coins; null = 10',
  })
  @IsOptional()
  @IsInt({ message: 'coin_redeem_pct must be a whole number.' })
  @Min(0)
  @Max(100)
  coin_redeem_pct?: number | null;

  @ApiPropertyOptional({
    example: 200,
    nullable: true,
    description: 'At most this many coins on one order; null = no cap',
  })
  @IsOptional()
  @IsInt({ message: 'coin_redeem_max must be a whole number.' })
  @Min(1)
  @Max(1_000_000)
  coin_redeem_max?: number | null;

  @ApiPropertyOptional({
    example: '2026-11-01',
    nullable: true,
    type: String,
    description: STARTS_ON,
  })
  @IsOptional()
  @Matches(DAY_KEY_PATTERN, { message: 'Use a date like 2026-11-01.' })
  starts_on?: string | null;

  @ApiPropertyOptional({
    example: '2026-11-30',
    nullable: true,
    type: String,
    description: ENDS_ON,
  })
  @IsOptional()
  @Matches(DAY_KEY_PATTERN, { message: 'Use a date like 2026-11-30.' })
  ends_on?: string | null;
}

/** Only what is sent changes; `filters` keys merge over the stored ones. */
export class UpdateEarningCohortDto {
  @ApiProperty({
    example: 3,
    description: 'The `version` HO read. A stale one is 409 VERSION_CONFLICT.',
  })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional({ example: 'Paddy belt, 10+ leads' })
  @ValidateIf((_, v) => v !== undefined)
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  description?: string | null;

  @ApiPropertyOptional({
    type: [RuleConditionDto],
    description: `The whole list replaces (1–${MAX_COHORT_CONDITIONS}); not on the default cohort (400 EARNING_COHORT_LOCKED)`,
  })
  @ValidateIf((_, v) => v !== undefined)
  @IsArray()
  @ArrayMaxSize(MAX_COHORT_CONDITIONS)
  @ValidateNested({ each: true })
  @Type(() => RuleConditionDto)
  conditions?: RuleConditionDto[];

  @ApiPropertyOptional({
    type: EarningFiltersDto,
    description:
      'Legacy, taken only without `conditions`: keys merge over the stored legacy view; not on the default cohort (400 EARNING_COHORT_LOCKED)',
  })
  @ValidateIf((_, v) => v !== undefined)
  @IsDefined()
  @ValidateNested()
  @Type(() => EarningFiltersDto)
  filters?: EarningFiltersDto;

  @ApiPropertyOptional({ example: 300, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(PAYOUT_MAX)
  meeting_gig_payout?: number | null;

  @ApiPropertyOptional({
    example: 10,
    nullable: true,
    description:
      'At most this % of an order subtotal its partners may pay with coins; null = 10',
  })
  @IsOptional()
  @IsInt({ message: 'coin_redeem_pct must be a whole number.' })
  @Min(0)
  @Max(100)
  coin_redeem_pct?: number | null;

  @ApiPropertyOptional({
    example: 200,
    nullable: true,
    description: 'At most this many coins on one order; null = no cap',
  })
  @IsOptional()
  @IsInt({ message: 'coin_redeem_max must be a whole number.' })
  @Min(1)
  @Max(1_000_000)
  coin_redeem_max?: number | null;

  @ApiPropertyOptional({
    example: '2026-11-01',
    nullable: true,
    type: String,
    description: `${STARTS_ON}. \`null\` clears it.`,
  })
  @IsOptional()
  @Matches(DAY_KEY_PATTERN, { message: 'Use a date like 2026-11-01.' })
  starts_on?: string | null;

  @ApiPropertyOptional({
    example: '2026-11-30',
    nullable: true,
    type: String,
    description: `${ENDS_ON}. \`null\` clears it.`,
  })
  @IsOptional()
  @Matches(DAY_KEY_PATTERN, { message: 'Use a date like 2026-11-30.' })
  ends_on?: string | null;

  @ApiPropertyOptional({
    example: false,
    description:
      'The cohort’s own commission plan ON / OFF from this IST month: off = its partners earn ec_default’s plan (past months never change). `{ version, commission_enabled }` alone is valid; the state it already has changes nothing. ec_default cannot be switched off (400 EARNING_COHORT_LOCKED)',
  })
  @ValidateIf((_, v) => v !== undefined)
  @IsBoolean()
  commission_enabled?: boolean;
}

export class ReorderEarningCohortsDto {
  @ApiProperty({
    example: ['ec_paddy_belt', 'ec_bhopal'],
    description:
      'Every active cohort id but `ec_default`, once, first looked at first',
  })
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(200)
  @Matches(COHORT_ID_PATTERN, { each: true })
  ids!: string[];
}

export class EarningCohortParamDto {
  @ApiProperty({ example: 'ec_paddy_belt' })
  @Transform(lower)
  @Matches(COHORT_ID_PATTERN, { message: 'This cohort id is not valid.' })
  id!: string;
}

export class EarningCohortsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    description: 'Also list archived cohorts (after the active ones)',
  })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  include_archived?: boolean;
}

export class PartnerParamDto {
  @ApiProperty({ example: 'VST-000006' })
  @Transform(upper)
  @Matches(/^VST-[A-Z0-9-]{1,30}$/, {
    message: 'This partner id is not valid.',
  })
  agentId!: string;
}
