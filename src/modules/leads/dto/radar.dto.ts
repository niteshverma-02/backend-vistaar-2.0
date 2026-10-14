import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

/** The radar's ring sizes, km (Lovable chips 2 / 5 / 10 / 15); any 1–50. */
export const MAX_RADAR_KM = 50;

export class RadarQueryDto {
  @ApiPropertyOptional({
    example: 23.2599,
    description:
      "The phone's GPS now; with `lng`. Left out = where the partner signed up",
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @ApiPropertyOptional({ example: 77.4126 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  @ApiPropertyOptional({
    example: 10,
    default: 10,
    minimum: 1,
    maximum: MAX_RADAR_KM,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_RADAR_KM)
  km?: number;
}
