import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsNumber, IsOptional, Max, Min } from 'class-validator';

/**
 * The phone's GPS fix at the moment of an action (adding a farmer, a farm
 * visit, ordering for them) — how the server learns where a farmer is.
 */
export class LocationDto {
  @ApiProperty({ example: 23.2599 })
  @IsNumber({}, { message: 'lat must be a number.' })
  @Min(-90)
  @Max(90)
  lat!: number;

  @ApiProperty({ example: 77.4126 })
  @IsNumber({}, { message: 'lng must be a number.' })
  @Min(-180)
  @Max(180)
  lng!: number;

  @ApiPropertyOptional({ example: 25, description: 'GPS accuracy, metres' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100_000)
  accuracy_m?: number;

  @ApiPropertyOptional({
    example: '2026-10-14T10:30:00+05:30',
    description:
      'When the phone took the fix (an offline save syncs later); now if left out',
  })
  @IsOptional()
  @IsDateString()
  at?: string;
}
