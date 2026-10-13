import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class SubTypeDto {
  @ApiProperty({ example: 'progressive_farmer' })
  @Matches(/^[a-z][a-z0-9_]{1,40}$/)
  key!: string;

  @ApiProperty({ example: { en: 'Progressive farmer', hi: 'प्रगतिशील किसान' } })
  @IsObject()
  label!: Record<string, string>;
}

export class UpdateCohortDto {
  @ApiPropertyOptional({
    example: { en: 'Vistaar Agent', hi: 'विस्तार एजेंट' },
  })
  @IsOptional()
  @IsObject()
  label?: Record<string, string>;

  @ApiPropertyOptional({
    example: { en: 'Shop owner or village entrepreneur' },
  })
  @IsOptional()
  @IsObject()
  description?: Record<string, string>;

  @ApiPropertyOptional({ example: '🏪' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  icon?: string;

  @ApiPropertyOptional({ type: [SubTypeDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SubTypeDto)
  sub_types?: SubTypeDto[];

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  order?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class CreateCohortDto extends UpdateCohortDto {
  @ApiProperty({
    example: 'vistaar_agent',
    description: 'Permanent key — never renamed once used',
  })
  @Matches(/^[a-z][a-z0-9_]{1,40}$/, {
    message:
      'The partner type ID can use only small letters, numbers and _ (2 to 41 characters), for example vistaar_agent.',
  })
  key!: string;

  @ApiProperty({ example: { en: 'Vistaar Agent', hi: 'विस्तार एजेंट' } })
  @IsObject()
  declare label: Record<string, string>;
}
