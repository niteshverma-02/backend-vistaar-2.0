import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class ConsentTextDto {
  @ApiProperty({ example: 'Farmer agreed to be contacted by Katyayani …' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(600)
  en!: string;

  @ApiPropertyOptional({ example: 'किसान ने …' })
  @IsOptional()
  @IsString()
  @MaxLength(600)
  hi?: string;
}

/** An emptied field in the portal clears the owner, as `null` does. */
const blankToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? null : value;

export class UpdateSettingsDto {
  @ApiPropertyOptional({
    example: 'A0-2691',
    nullable: true,
    description:
      '`agents_v2.agent_id` of an active HO user; `null` or `""` clears it',
  })
  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @Matches(/^A0-\d+$/, {
    message: "Please enter the default owner's staff ID, for example A0-1234.",
  })
  default_owner_agent_id?: string | null;

  @ApiPropertyOptional({
    example: 'A0-1234',
    nullable: true,
    description:
      'Override owner of farmer leads (`lead_owner`); `null` or `""` clears it — then the Offline Head (USR-1037) owns them',
  })
  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @Matches(/^A0-\d+$/, {
    message:
      "Please enter the farmer-lead owner's staff ID, for example A0-1234.",
  })
  lead_owner_agent_id?: string | null;

  @ApiPropertyOptional({
    type: ConsentTextDto,
    description:
      'The farmer-consent wording partners tick when adding a farmer; a change makes a new version',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ConsentTextDto)
  farmer_consent_text?: ConsentTextDto;

  @ApiPropertyOptional({
    example: 15,
    minimum: 1,
    maximum: 365,
    description:
      'Days without work (stage, follow-up, activity…) before another partner can take a lead',
  })
  @IsOptional()
  @IsInt({ message: 'Lead release must be a whole number of days.' })
  @Min(1, { message: 'Lead release must be at least 1 day.' })
  @Max(365, { message: 'Lead release can be at most 365 days.' })
  lead_release_days?: number;

  @ApiPropertyOptional({
    example: 45,
    minimum: 1,
    maximum: 365,
    description:
      'Days without an order before another partner can take a customer',
  })
  @IsOptional()
  @IsInt({ message: 'Customer release must be a whole number of days.' })
  @Min(1, { message: 'Customer release must be at least 1 day.' })
  @Max(365, { message: 'Customer release can be at most 365 days.' })
  customer_release_days?: number;

  @ApiPropertyOptional({
    type: ConsentTextDto,
    description:
      'The wording a farmer agrees to before a partner sends their testimonial; a change makes a new version',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ConsentTextDto)
  testimonial_consent_text?: ConsentTextDto;

  @ApiPropertyOptional({
    example: 7,
    minimum: 0,
    maximum: 30,
    description: 'Commission confirms this many days after delivery',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(30)
  return_window_days?: number;

  @ApiPropertyOptional({
    example: 500,
    minimum: 1,
    maximum: 100000,
    description: 'Smallest withdrawal, ₹',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  min_withdrawal?: number;

  @ApiPropertyOptional({
    example: 2,
    minimum: 0,
    maximum: 30,
    description: 'TDS % on a withdrawal with a verified PAN',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(30)
  tds_rate_with_pan?: number;

  @ApiPropertyOptional({
    example: 20,
    minimum: 0,
    maximum: 40,
    description: 'TDS % without a verified PAN',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(40)
  tds_rate_without_pan?: number;

  @ApiPropertyOptional({
    example: 100000,
    minimum: 1,
    maximum: 100000000,
    description: 'Default monthly sales target, ₹',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000000)
  monthly_target?: number;

  @ApiPropertyOptional({
    example: 250,
    minimum: 0,
    maximum: 100000,
    description: 'Default pay for a new meeting gig, ₹',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  gig_payout?: number;

  @ApiPropertyOptional({
    example: 15,
    minimum: 1,
    maximum: 300,
    description: 'Default farmers present for a gig to be submitted',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(300)
  gig_min_farmers?: number;

  @ApiPropertyOptional({
    example: 3,
    minimum: 0,
    maximum: 6,
    description: 'Default photos for a gig to be submitted',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  gig_photos_required?: number;

  @ApiPropertyOptional({
    example: 500,
    minimum: 50,
    maximum: 20000,
    description:
      'Check-in farther than this from a pinned venue is flagged (m)',
  })
  @IsOptional()
  @IsInt()
  @Min(50)
  @Max(20000)
  gig_checkin_radius_m?: number;

  @ApiPropertyOptional({
    example: false,
    description:
      'Approved gigs reach the wallet. Keep off until finance confirms the TDS section for gig pay.',
  })
  @IsOptional()
  @IsBoolean()
  gig_pay_enabled?: boolean;

  @ApiPropertyOptional({ example: 5, minimum: 0.5, maximum: 50 })
  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(50)
  conflict_radius_km?: number;
}
