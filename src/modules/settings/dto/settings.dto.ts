import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class UpdateSettingsDto {
  @ApiPropertyOptional({
    example: 'A0-2691',
    description: '`agents_v2.agent_id` of an active HO user',
  })
  @IsOptional()
  @IsString()
  @Matches(/^A0-\d+$/, {
    message: "Please enter the default owner's staff ID, for example A0-1234.",
  })
  default_owner_agent_id?: string;

  @ApiPropertyOptional({ example: 5, minimum: 0.5, maximum: 50 })
  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(50)
  conflict_radius_km?: number;
}
