import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import { PageQueryDto } from '@common/dto/page-query.dto';

import {
  CROP_KEY,
  CROP_SEASONS,
  MAX_STAGES,
  MAX_STAGE_PRODUCTS,
  type CropSeason,
} from '../crop-calendar.domain';

export class CropStageDto {
  @ApiProperty({ example: 'Tillering' })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  stage!: string;

  @ApiProperty({ example: 'Dec' })
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  month!: string;

  @ApiProperty({ example: 'Humic acid with first irrigation' })
  @IsString()
  @MinLength(1)
  @MaxLength(400)
  advice!: string;

  @ApiProperty({ example: ['Humic + Fulvic Acid 98%'] })
  @IsArray()
  @ArrayMaxSize(MAX_STAGE_PRODUCTS)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  products!: string[];
}

export class UpdateCropDto {
  @ApiPropertyOptional({ example: 'Wheat' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  crop?: string;

  @ApiPropertyOptional({ example: '🌾', nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(16)
  emoji?: string | null;

  @ApiPropertyOptional({ enum: CROP_SEASONS })
  @IsOptional()
  @IsIn(CROP_SEASONS)
  season?: CropSeason;

  @ApiPropertyOptional({ example: 'Nov – Dec' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  sowing?: string;

  @ApiPropertyOptional({ example: 'Mar – Apr' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  harvest?: string;

  @ApiPropertyOptional({ type: [CropStageDto], description: 'In crop order' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_STAGES)
  @ValidateNested({ each: true })
  @Type(() => CropStageDto)
  stages?: CropStageDto[];

  @ApiPropertyOptional({ example: 1, description: 'Lower first' })
  @IsOptional()
  @IsInt()
  order?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class CreateCropDto extends UpdateCropDto {
  @ApiProperty({
    example: 'wheat',
    description: 'Stable key; cannot change later',
  })
  @Matches(CROP_KEY, {
    message:
      'The crop code can use only small English letters, numbers and _, and must start with a letter (for example wheat or green_gram).',
  })
  key!: string;

  @ApiProperty({ example: 'Wheat' })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  declare crop: string;

  @ApiProperty({ enum: CROP_SEASONS })
  @IsIn(CROP_SEASONS)
  declare season: CropSeason;

  @ApiProperty({ example: 'Nov – Dec' })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  declare sowing: string;

  @ApiProperty({ example: 'Mar – Apr' })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  declare harvest: string;

  @ApiProperty({ type: [CropStageDto] })
  @IsArray()
  @ArrayMaxSize(MAX_STAGES)
  @ValidateNested({ each: true })
  @Type(() => CropStageDto)
  declare stages: CropStageDto[];
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
  'crop',
  '-crop',
  'created_at',
  '-created_at',
  'updated_at',
  '-updated_at',
] as const;

export class CropListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: SORTS, default: '-created_at' })
  @IsIn(SORTS)
  declare sort: string;

  @ApiPropertyOptional({ enum: CROP_SEASONS })
  @IsOptional()
  @IsIn(CROP_SEASONS)
  season?: CropSeason;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(toOptionalBool)
  @IsBoolean()
  is_active?: boolean;
}
