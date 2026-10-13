import { ApiProperty, IntersectionType, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsInt,
  IsObject,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { HHMM } from '../info-pages.domain';
import { MAX_LIST, SHORT, VersionedDto } from './common.dto';

const TEN_DIGITS = /^\d{10}$/;

class NumberDto {
  @ApiProperty({ example: '1800123456', description: '10 digits, no +91' })
  @Matches(TEN_DIGITS, {
    message: 'The number must be 10 digits, without +91 or spaces.',
  })
  number!: string;

  @ApiProperty({
    example: '1800-123-456',
    description: 'How the app prints it',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  label!: string;
}

class HoursDto {
  @ApiProperty({
    example: [1, 2, 3, 4, 5, 6],
    description: 'ISO weekdays: 1 = Monday … 7 = Sunday',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  days!: number[];

  @ApiProperty({ example: '10:00', description: 'IST, 24-hour HH:mm' })
  @Matches(HHMM, { message: 'Opening time must be HH:mm, for example 10:00.' })
  opens!: string;

  @ApiProperty({ example: '19:00', description: 'IST, 24-hour HH:mm' })
  @Matches(HHMM, { message: 'Closing time must be HH:mm, for example 19:00.' })
  closes!: string;

  @ApiProperty({ example: 'Mon – Sat, 10 AM – 7 PM · Sunday closed' })
  @IsString()
  @MinLength(1)
  @MaxLength(SHORT)
  label!: string;
}

/** Contact Us (`/contact-us`) and the Head Office numbers the Need Help, Privacy and Feedback screens share. */
export class ContactUsContentDto {
  @ApiProperty({ type: NumberDto })
  @IsObject()
  @ValidateNested()
  @Type(() => NumberDto)
  helpline!: NumberDto;

  @ApiProperty({ type: NumberDto })
  @IsObject()
  @ValidateNested()
  @Type(() => NumberDto)
  whatsapp!: NumberDto;

  @ApiProperty({ example: 'support@katyayaniorganics.com' })
  @IsEmail()
  support_email!: string;

  @ApiProperty({ example: 'privacy@katyayaniorganics.com' })
  @IsEmail()
  privacy_email!: string;

  @ApiProperty({ example: 'https://play.google.com/store/apps/details?id=…' })
  @IsUrl({ protocols: ['https'], require_protocol: true })
  play_store_url!: string;

  @ApiProperty({ type: HoursDto })
  @IsObject()
  @ValidateNested()
  @Type(() => HoursDto)
  hours!: HoursDto;

  @ApiProperty({
    example: ['Order or delivery', 'Commission or payout', 'Other'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_LIST)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(60, { each: true })
  ticket_categories!: string[];

  @ApiProperty({ example: 'Head Office replies within 1 working day' })
  @IsString()
  @MinLength(1)
  @MaxLength(SHORT)
  ticket_reply_note!: string;
}

/** PATCH: any of the page's fields, each replaced whole, plus the version it was made from. */
export class UpdateContactUsDto extends IntersectionType(
  PartialType(ContactUsContentDto),
  VersionedDto,
) {}
