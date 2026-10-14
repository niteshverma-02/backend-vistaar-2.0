import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

import { PERIODS, type Period } from '../performance.domain';

export class PerformanceQueryDto {
  @ApiPropertyOptional({
    enum: PERIODS,
    default: 'month',
    description: 'This month · the last 3 months with this one · April to now',
  })
  @IsOptional()
  @IsIn(PERIODS, { message: 'Please choose month, 3m or fy.' })
  period: Period = 'month';
}

export class PerformanceAgentParamDto {
  @ApiProperty({ example: 'VST-000006' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^VST-\d{1,12}$/, { message: 'This partner id is not valid.' })
  agentId!: string;
}

export class SetTargetDto {
  @ApiProperty({
    example: 150000,
    nullable: true,
    type: Number,
    description:
      '₹ of delivered sales a month; `null` = back to the settings default',
  })
  @ValidateIf((_o, v) => v !== null)
  @IsInt({ message: 'Please enter the target in whole rupees.' })
  @Min(1)
  @Max(100_000_000)
  monthly_target!: number | null;
}
