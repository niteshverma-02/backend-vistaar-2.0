import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { CALL_OUTCOMES, type CallOutcome } from '../agents.domain';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class VerificationCallDto {
  @ApiProperty({ enum: CALL_OUTCOMES, example: 'verified' })
  @IsIn(CALL_OUTCOMES, {
    message: 'Please choose reached, not reached or verified.',
  })
  outcome!: CallOutcome;

  @ApiPropertyOptional({ example: 'Confirmed the shop address on the call' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class NameChangeRejectDto {
  @ApiProperty({
    example: 'The new name does not match the Aadhaar card',
    description: 'The partner sees it',
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Please give a reason.' })
  @MaxLength(300)
  reason!: string;
}
