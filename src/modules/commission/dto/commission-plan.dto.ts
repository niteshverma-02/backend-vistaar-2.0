import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
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
import { MONTH_PATTERN } from '@modules/attendance/attendance.domain';

import {
  MAX_MIN_ORDER_VALUE,
  MAX_SLABS,
  PLAN_KINDS,
  type PlanKind,
} from '../commission.domain';

/** A partner type (`vistaar_agent`) or an earning cohort (`ec_paddy_belt`). */
const COHORT = '(?:ec_[a-z0-9_]{1,40}|[a-z][a-z0-9_]{1,40})';
const COHORT_PATTERN = new RegExp(`^${COHORT}$`);
const PLAN_ID_PATTERN = new RegExp(`^${COHORT}@\\d{4}-(0[1-9]|1[0-2])$`);

export class SlabDto {
  @ApiProperty({
    example: 50000,
    description: '₹ of delivered sales, included',
  })
  @IsInt()
  @Min(0)
  from!: number;

  @ApiProperty({
    example: 100000,
    nullable: true,
    type: Number,
    description: 'Excluded; `null` on the last slab (no top)',
  })
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(1)
  to!: number | null;

  @ApiProperty({ example: 7, description: '% — up to two decimals' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  rate!: number;
}

export class CreatePlanDto {
  @ApiProperty({
    example: 'ec_paddy_belt',
    description:
      'An earning cohort id (`ec_…`) — or a partner-type key, whose plan only orders placed before the partner’s first earning cohort use',
  })
  @Matches(COHORT_PATTERN, { message: 'Please choose a cohort.' })
  cohort!: string;

  @ApiProperty({
    example: '2026-11',
    description: 'IST month it starts in — this month or later',
  })
  @Matches(MONTH_PATTERN, {
    message: 'Please choose a valid month, for example 2026-11.',
  })
  effective_from!: string;

  @ApiPropertyOptional({
    enum: PLAN_KINDS,
    default: 'slabs',
    description:
      '`slabs`: send `slabs`. `fixed`: send one `rate` — every order earns it whatever the month’s sales',
  })
  @IsOptional()
  @IsIn(PLAN_KINDS)
  kind?: PlanKind;

  @ApiPropertyOptional({
    type: [SlabDto],
    description:
      'Kind `slabs` (required there): from ₹0 up, each starting where the last ends',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SLABS)
  @ValidateNested({ each: true })
  @Type(() => SlabDto)
  slabs?: SlabDto[];

  @ApiPropertyOptional({
    example: 6,
    description: 'Kind `fixed` (required there): the % — up to two decimals',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  rate?: number;

  @ApiPropertyOptional({
    example: 2000,
    nullable: true,
    type: Number,
    description:
      'Earning cohorts only (not `ec_default`): ₹ of base an order needs to earn on this plan; below it the order earns the default cohort’s. `null` = none',
  })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsInt()
  @Min(1)
  @Max(MAX_MIN_ORDER_VALUE)
  min_order_value?: number | null;

  @ApiPropertyOptional({
    type: [String],
    example: ['The slab is decided by delivered sales in the calendar month.'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  notes?: string[];

  @ApiPropertyOptional({
    description:
      '`true` (default) = not signed off; the app shows a "Draft" tag',
  })
  @IsOptional()
  @IsBoolean()
  draft?: boolean;
}

/**
 * Any of the terms; `draft` alone signs a plan off (or back) whatever its
 * month. Changing the kind needs its terms (`rate` or `slabs`) with it.
 */
export class UpdatePlanDto extends PartialType(
  OmitType(CreatePlanDto, ['cohort', 'effective_from'] as const),
) {}

export class PlanListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ example: 'ec_paddy_belt' })
  @IsOptional()
  @Matches(COHORT_PATTERN, { message: 'This cohort is not valid.' })
  cohort?: string;
}

export const PLAN_SCOPES = ['partner_type', 'earning'] as const;
export type PlanScope = (typeof PLAN_SCOPES)[number];

export class PlanInEffectQueryDto {
  @ApiPropertyOptional({
    example: '2026-10',
    description: 'IST month; this month when left out',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @Matches(MONTH_PATTERN, {
    message: 'Please choose a valid month, for example 2026-10.',
  })
  month?: string;

  @ApiPropertyOptional({
    enum: PLAN_SCOPES,
    default: 'partner_type',
    description:
      '`partner_type`: each active partner type (onboarding cohort). `earning`: each active earning cohort, `ec_default` last',
  })
  @IsOptional()
  @IsIn(PLAN_SCOPES)
  scope?: PlanScope;
}

export class PlanParamDto {
  @ApiProperty({ example: 'ec_paddy_belt@2026-11' })
  @Matches(PLAN_ID_PATTERN, { message: 'This plan id is not valid.' })
  id!: string;
}
