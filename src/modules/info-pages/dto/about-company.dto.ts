import { ApiProperty, IntersectionType, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsObject,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { LONG, MAX_LIST, SHORT, VersionedDto } from './common.dto';

const HTTPS = { protocols: ['https'], require_protocol: true };

class StatDto {
  @ApiProperty({ example: 'Farmers served' })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  label!: string;

  @ApiProperty({ example: '10 lakh+' })
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  value!: string;
}

class TileDto {
  @ApiProperty({ example: 'Bio stimulants' })
  @IsString()
  @MinLength(1)
  @MaxLength(SHORT)
  title!: string;

  @ApiProperty({ example: 'Humic & fulvic acid, seaweed extract, amino acids' })
  @IsString()
  @MinLength(1)
  @MaxLength(400)
  text!: string;

  @ApiProperty({ example: '🌱' })
  @IsString()
  @MinLength(1)
  @MaxLength(16)
  emoji!: string;
}

class CompanyContactDto {
  @ApiProperty({
    example: '1800-000-0000',
    description: 'Printed as is; dialled with non-digits dropped',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(30)
  helpline!: string;

  @ApiProperty({ example: 'vistaar@katyayaniorganics.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'https://katyayaniorganics.com' })
  @IsUrl(HTTPS)
  website!: string;
}

class SocialDto {
  @ApiProperty({ example: 'YouTube' })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  label!: string;

  @ApiProperty({ example: 'https://www.youtube.com/@katyayaniorganics' })
  @IsUrl(HTTPS)
  url!: string;
}

/** About Katyayani (`/about-company`). */
export class AboutCompanyContentDto {
  @ApiProperty({ example: 'Katyayani Organics' })
  @IsString()
  @MinLength(1)
  @MaxLength(SHORT)
  name!: string;

  @ApiProperty({
    example: 'Better inputs, better harvests — for every Indian farmer',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(SHORT)
  tagline!: string;

  @ApiProperty({
    description: '"Our story" paragraphs, in order',
    example: ['Katyayani Organics makes …'],
  })
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(LONG, { each: true })
  story!: string[];

  @ApiProperty({ example: 'Help farmers grow more with less …' })
  @IsString()
  @MinLength(1)
  @MaxLength(LONG)
  mission!: string;

  @ApiProperty({ type: [StatDto] })
  @IsArray()
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => StatDto)
  stats!: StatDto[];

  @ApiProperty({ type: [TileDto] })
  @IsArray()
  @ArrayMaxSize(MAX_LIST)
  @ValidateNested({ each: true })
  @Type(() => TileDto)
  what_we_make!: TileDto[];

  @ApiProperty({ example: ['In-house manufacturing and batch testing'] })
  @IsArray()
  @ArrayMaxSize(MAX_LIST)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(400, { each: true })
  quality_points!: string[];

  @ApiProperty({ type: [TileDto] })
  @IsArray()
  @ArrayMaxSize(MAX_LIST)
  @ValidateNested({ each: true })
  @Type(() => TileDto)
  ecosystem!: TileDto[];

  @ApiProperty({ type: CompanyContactDto })
  @IsObject()
  @ValidateNested()
  @Type(() => CompanyContactDto)
  contact!: CompanyContactDto;

  @ApiProperty({ type: [SocialDto] })
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => SocialDto)
  social!: SocialDto[];
}

/** PATCH: any of the page's fields, each replaced whole, plus the version it was made from. */
export class UpdateAboutCompanyDto extends IntersectionType(
  PartialType(AboutCompanyContentDto),
  VersionedDto,
) {}
