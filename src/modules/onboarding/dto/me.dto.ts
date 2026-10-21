import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** The app's Edit Profile form. Only the keys sent change. */
export class UpdateMeDto {
  @ApiPropertyOptional({
    example: 'Ramesh Patel',
    description: 'Waits for HO approval (`pending_name`); not applied at once',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(3, 100)
  name?: string;

  @ApiPropertyOptional({ example: 'ramesh@example.com' })
  @IsOptional()
  @Transform(trim)
  @IsEmail({}, { message: 'Please enter a valid email address.' })
  @MaxLength(254)
  email?: string;

  @ApiPropertyOptional({
    example: 'hi',
    description: "A language code, as the onboarding form's options use",
  })
  @IsOptional()
  @Transform(trim)
  @Matches(/^[a-z]{2,3}$/, { message: 'Please choose a language.' })
  language_pref?: string;

  @ApiPropertyOptional({ example: 'Rampur' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  village?: string;

  @ApiPropertyOptional({
    example: 'Sehore',
    description:
      "Replaced by the pincode's district when a known pincode is sent",
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  district?: string;

  @ApiPropertyOptional({
    example: 'MADHYA PRADESH',
    description: "Replaced by the pincode's state when a known pincode is sent",
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  state?: string;

  @ApiPropertyOptional({ example: '466001' })
  @IsOptional()
  @Transform(trim)
  @Matches(/^\d{6}$/, { message: 'Please enter a 6-digit pincode.' })
  pincode?: string;

  @ApiPropertyOptional({
    example: 'KO-documents/PII-1203/profile_photo/1760000000000-3f1c2a9b.jpg',
    description:
      '`path` from POST /uploads (an image in the partner’s own folder)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  photo?: string;
}
