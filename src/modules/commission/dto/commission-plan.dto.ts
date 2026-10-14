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

import { MAX_SLABS } from '../commission.domain';

const COHORT_PATTERN = /^[a-z][a-z0-9_]{1,40}$/;

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
  @ApiProperty({ example: 'vistaar_agent', description: 'Cohort key' })
  @Matches(COHORT_PATTERN, { message: 'Please choose a partner type.' })
  cohort!: string;

  @ApiProperty({
    example: '2026-11',
    description: 'IST month it starts in — this month or later',
  })
  @Matches(MONTH_PATTERN, {
    message: 'Please choose a valid month, for example 2026-11.',
  })
  effective_from!: string;

  @ApiProperty({
    type: [SlabDto],
    description: 'From ₹0 up, each starting where the last ends',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SLABS)
  @ValidateNested({ each: true })
  @Type(() => SlabDto)
  slabs!: SlabDto[];

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

/** Any of the terms; `draft` alone signs a plan off (or back) whatever its month. */
export class UpdatePlanDto extends PartialType(
  OmitType(CreatePlanDto, ['cohort', 'effective_from'] as const),
) {}

export class PlanListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ example: 'vistaar_agent' })
  @IsOptional()
  @Matches(COHORT_PATTERN, { message: 'This partner type is not valid.' })
  cohort?: string;
}

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
}

export class PlanParamDto {
  @ApiProperty({ example: 'vistaar_agent@2026-11' })
  @Matches(/^[a-z][a-z0-9_]{1,40}@\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'This plan id is not valid.',
  })
  id!: string;
}
