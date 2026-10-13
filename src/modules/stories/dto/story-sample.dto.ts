import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

import { PageQueryDto } from '@common/dto/page-query.dto';

import { FESTIVAL_KEY } from '../stories.domain';

export class UpdateStorySampleDto {
  @ApiPropertyOptional({ example: 'Ramesh Yadav' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional({ example: 'Rampur', nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(80)
  village?: string | null;

  @ApiPropertyOptional({ example: 'Lucknow', nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(80)
  district?: string | null;

  @ApiPropertyOptional({ example: 'Uttar Pradesh', nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(80)
  state?: string | null;

  @ApiPropertyOptional({ example: 'Humic + Fulvic Acid 98%' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  product?: string;

  @ApiPropertyOptional({ example: 'Wheat', nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(60)
  crop?: string | null;

  @ApiPropertyOptional({
    example:
      'Roots were much stronger this season, got 2 quintal extra per acre.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(400)
  quote?: string;

  @ApiPropertyOptional({ example: 5, minimum: 1, maximum: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  stars?: number;

  @ApiPropertyOptional({ example: 1, description: 'Lower first' })
  @IsOptional()
  @IsInt()
  order?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class CreateStorySampleDto extends UpdateStorySampleDto {
  @ApiProperty({
    example: 'wheat_humic_lucknow',
    description: 'Stable key; cannot change later',
  })
  @Matches(FESTIVAL_KEY, {
    message:
      'The short name can use only small letters, numbers and _, and must start with a letter (for example diwali_2026).',
  })
  key!: string;

  @ApiProperty({ example: 'Ramesh Yadav' })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  declare name: string;

  @ApiProperty({ example: 'Humic + Fulvic Acid 98%' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  declare product: string;

  @ApiProperty({ example: 'Roots were much stronger this season.' })
  @IsString()
  @MinLength(1)
  @MaxLength(400)
  declare quote: string;
}

/** `?is_active=true|false`; absent = both. */
const toOptionalBool = ({ value }: { value: unknown }): boolean | undefined =>
  value === true || value === 'true'
    ? true
    : value === false || value === 'false'
      ? false
      : undefined;

const SORTS = [
  'order',
  '-order',
  'created_at',
  '-created_at',
  'updated_at',
  '-updated_at',
] as const;

export class StorySampleListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: SORTS, default: '-created_at' })
  @IsIn(SORTS)
  declare sort: string;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(toOptionalBool)
  @IsBoolean()
  is_active?: boolean;
}
