import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

import { PageQueryDto } from '@common/dto/page-query.dto';

import { MAX_ANSWER, MAX_QUESTION, SECTION_KEY } from '../faqs.domain';

const SECTION_KEY_MESSAGE =
  'The FAQ section code can use only small English letters, numbers and _, and must start with a letter (for example payments).';

export class UpdateFaqDto {
  @ApiPropertyOptional({ example: 'payments', description: 'A section key' })
  @IsOptional()
  @Matches(SECTION_KEY, { message: SECTION_KEY_MESSAGE })
  category?: string;

  @ApiPropertyOptional({ example: 'Is TDS deducted?' })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(MAX_QUESTION)
  q?: string;

  @ApiPropertyOptional({
    example:
      'Yes, TDS applies as per law on commission. Keep your PAN updated to avoid higher deduction.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_ANSWER)
  a?: string;

  @ApiPropertyOptional({ example: 1, description: 'Lower first' })
  @IsOptional()
  @IsInt()
  order?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class CreateFaqDto extends UpdateFaqDto {
  @ApiProperty({ example: 'payments', description: 'A section key' })
  @Matches(SECTION_KEY, { message: SECTION_KEY_MESSAGE })
  declare category: string;

  @ApiProperty({ example: 'Is TDS deducted?' })
  @IsString()
  @MinLength(3)
  @MaxLength(MAX_QUESTION)
  declare q: string;

  @ApiProperty({
    example:
      'Yes, TDS applies as per law on commission. Keep your PAN updated to avoid higher deduction.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_ANSWER)
  declare a: string;
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

export class FaqListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: SORTS, default: '-created_at' })
  @IsIn(SORTS)
  declare sort: string;

  @ApiPropertyOptional({ example: 'payments', description: 'A section key' })
  @IsOptional()
  @Matches(SECTION_KEY, { message: SECTION_KEY_MESSAGE })
  category?: string;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(toOptionalBool)
  @IsBoolean()
  is_active?: boolean;
}
