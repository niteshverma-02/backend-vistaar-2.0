import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  Matches,
  Max,
  Min,
} from 'class-validator';

import { PageQueryDto } from '@common/dto/page-query.dto';

import {
  POOL_LAYERS,
  RADAR_LAYERS,
  type PoolLayer,
  type RadarLayer,
} from '../radar.domain';

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

  @ApiPropertyOptional({
    example: 'mine,kkd_leads,org_customers,stores',
    description: `Comma-separated, any of ${RADAR_LAYERS.join(' · ')}. Left out = all`,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean)
      : value,
  )
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(RADAR_LAYERS, { each: true })
  layers?: RadarLayer[];
}

export class RadarPincodeParamDto {
  @ApiProperty({ example: '462022' })
  @Matches(/^\d{6}$/, { message: 'pincode must be six digits' })
  pincode!: string;
}

/** One pincode's people in one layer — the list behind a pincode marker. */
export class RadarPincodeQueryDto extends PageQueryDto {
  @ApiProperty({ enum: POOL_LAYERS })
  @IsIn(POOL_LAYERS)
  layer!: PoolLayer;
}
