import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
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

export class UpdateSettingsDto {
  @ApiPropertyOptional({
    example: 'A0-2691',
    description: '`agents_v2.agent_id` of an active HO user',
  })
  @IsOptional()
  @IsString()
  @Matches(/^A0-\d+$/, {
    message: 'default_owner_agent_id must look like A0-1234.',
  })
  default_owner_agent_id?: string;

  @ApiPropertyOptional({
    example: 'A0-1234',
    description:
      'Override owner of farmer leads (`lead_owner`); unset = the Offline Head (USR-1037)',
  })
  @IsOptional()
  @IsString()
  @Matches(/^A0-\d+$/, {
    message: 'lead_owner_agent_id must look like A0-1234.',
  })
  lead_owner_agent_id?: string;

  @ApiPropertyOptional({
    type: ConsentTextDto,
    description:
      'The farmer-consent wording partners tick when adding a farmer; a change makes a new version',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ConsentTextDto)
  farmer_consent_text?: ConsentTextDto;

  @ApiPropertyOptional({ example: 5, minimum: 0.5, maximum: 50 })
  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(50)
  conflict_radius_km?: number;
}
