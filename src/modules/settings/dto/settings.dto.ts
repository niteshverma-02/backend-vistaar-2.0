import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
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

  @ApiPropertyOptional({ example: 5, minimum: 0.5, maximum: 50 })
  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(50)
  conflict_radius_km?: number;
}
