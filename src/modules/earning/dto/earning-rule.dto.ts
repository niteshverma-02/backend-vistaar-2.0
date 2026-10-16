import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
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
  EARNING_TRIGGERS,
  MAX_CONDITIONS,
  OPERATORS,
  REWARD_KINDS,
  type ConditionValue,
  type EarningTrigger,
  type Operator,
  type RewardKind,
} from '../earning.domain';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const lower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
const toBool = ({ value }: { value: unknown }) =>
  value === true || value === 'true' || value === '1'
    ? true
    : value === false || value === 'false' || value === '0'
      ? false
      : value;

const RULE_ID = /^[0-9a-f-]{36}$/i;
const REWARD_MAX = 100_000;

/** Checked against the catalog (`GET /admin/earning-rules/catalog`) on save. */
export class RuleConditionDto {
  @ApiProperty({ example: 'crops', description: 'A field of the trigger' })
  @IsString()
  @MaxLength(40)
  field!: string;

  @ApiProperty({ enum: OPERATORS, example: 'any_of' })
  @IsIn(OPERATORS)
  op!: Operator;

  @ApiProperty({
    example: ['Wheat', 'Soybean'],
    description:
      'A string (eq), a number (eq / gte / lte) or a list of strings (in / any_of) — as the field type takes',
  })
  @IsDefined()
  value!: ConditionValue;
}

export class RuleRewardDto {
  @ApiProperty({ enum: REWARD_KINDS, example: 'coin' })
  @IsIn(REWARD_KINDS)
  kind!: RewardKind;

  @ApiProperty({
    example: 10,
    description: 'Coins, or ₹ for a gig; whole, ≥ 1',
  })
  @IsInt()
  @Min(1)
  @Max(REWARD_MAX)
  amount!: number;
}

export class CreateEarningRuleDto {
  @ApiProperty({ example: 'ec_default' })
  @Transform(lower)
  @Matches(COHORT_ID_PATTERN, { message: 'This cohort id is not valid.' })
  cohort_id!: string;

  @ApiProperty({ example: 'Paddy farmer, 2+ acres' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  @ApiProperty({ enum: EARNING_TRIGGERS, example: 'lead_created' })
  @IsIn(EARNING_TRIGGERS)
  trigger!: EarningTrigger;

  @ApiPropertyOptional({
    type: [RuleConditionDto],
    description: `All must hold; empty = every time (≤ ${MAX_CONDITIONS})`,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_CONDITIONS)
  @ValidateNested({ each: true })
  @Type(() => RuleConditionDto)
  conditions?: RuleConditionDto[];

  @ApiProperty({ type: RuleRewardDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => RuleRewardDto)
  reward!: RuleRewardDto;
}

/** Only what is sent changes. The trigger and cohort never change. */
export class UpdateEarningRuleDto {
  @ApiProperty({
    example: 2,
    description: 'The `version` HO read. A stale one is 409 VERSION_CONFLICT.',
  })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional({ example: 'Paddy farmer, 2+ acres' })
  @ValidateIf((_, v) => v !== undefined)
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional({
    type: [RuleConditionDto],
    description: 'The whole list; [] = every time',
  })
  @ValidateIf((_, v) => v !== undefined)
  @IsArray()
  @ArrayMaxSize(MAX_CONDITIONS)
  @ValidateNested({ each: true })
  @Type(() => RuleConditionDto)
  conditions?: RuleConditionDto[];

  @ApiPropertyOptional({ type: RuleRewardDto })
  @ValidateIf((_, v) => v !== undefined)
  @IsDefined()
  @ValidateNested()
  @Type(() => RuleRewardDto)
  reward?: RuleRewardDto;
}

export class ReorderEarningRulesDto {
  @ApiProperty({ example: 'ec_default' })
  @Transform(lower)
  @Matches(COHORT_ID_PATTERN, { message: 'This cohort id is not valid.' })
  cohort_id!: string;

  @ApiProperty({
    type: [String],
    description:
      'Every active rule id of the cohort, once, first looked at first',
  })
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(500)
  @Matches(RULE_ID, { each: true })
  ids!: string[];
}

export class EarningRuleParamDto {
  @ApiProperty({ description: 'The rule id (UUID)' })
  @Matches(RULE_ID, { message: 'This rule id is not valid.' })
  id!: string;
}

export class EarningRulesQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ example: 'ec_default' })
  @IsOptional()
  @Transform(lower)
  @Matches(COHORT_ID_PATTERN)
  cohort_id?: string;

  @ApiPropertyOptional({ enum: EARNING_TRIGGERS })
  @IsOptional()
  @IsIn(EARNING_TRIGGERS)
  trigger?: EarningTrigger;

  @ApiPropertyOptional({ description: 'Also list archived rules' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  include_archived?: boolean;
}
