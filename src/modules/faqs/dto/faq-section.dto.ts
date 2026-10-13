import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

import { MAX_SECTION_LABEL, SECTION_KEY } from '../faqs.domain';

export class UpdateFaqSectionDto {
  @ApiPropertyOptional({ example: 'Payments' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_SECTION_LABEL)
  label?: string;

  @ApiPropertyOptional({ example: '💰', nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(16)
  emoji?: string | null;

  @ApiPropertyOptional({ example: 3, description: 'Lower first' })
  @IsOptional()
  @IsInt()
  order?: number;

  @ApiPropertyOptional({
    example: true,
    description: '`false` hides the section and its FAQs from the app',
  })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class CreateFaqSectionDto extends UpdateFaqSectionDto {
  @ApiProperty({
    example: 'payments',
    description: 'Stable key; cannot change later',
  })
  @Matches(SECTION_KEY, {
    message:
      'key must be lowercase letters, digits or _, starting with a letter.',
  })
  key!: string;

  @ApiProperty({ example: 'Payments' })
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_SECTION_LABEL)
  declare label: string;
}

/** `?is_active=true|false`; absent = both. */
const toOptionalBool = ({ value }: { value: unknown }): boolean | undefined =>
  value === true || value === 'true'
    ? true
    : value === false || value === 'false'
      ? false
      : undefined;

export class FaqSectionListQueryDto {
  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(toOptionalBool)
  @IsBoolean()
  is_active?: boolean;
}
