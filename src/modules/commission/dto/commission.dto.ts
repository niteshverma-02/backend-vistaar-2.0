import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { PageQueryDto } from '@common/dto/page-query.dto';
import { MONTH_PATTERN } from '@modules/attendance/attendance.domain';

import {
  COMMISSION_STATUSES,
  QUARTER_PATTERN,
  type CommissionStatus,
} from '../commission.domain';
import {
  WITHDRAWAL_STATUSES,
  type WithdrawalStatus,
} from '../schemas/withdrawal.schema';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

const PARTNER_ID_PATTERN = /^VST-\d{1,12}$/;
const WITHDRAWAL_ID_PATTERN = /^WD-\d{1,12}$/;

export class LedgerQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: COMMISSION_STATUSES })
  @IsOptional()
  @IsIn(COMMISSION_STATUSES)
  status?: CommissionStatus;
}

export class StatementQueryDto {
  @ApiProperty({
    example: '2026-09',
    description: 'IST month the orders were placed in',
  })
  @Transform(trim)
  @Matches(MONTH_PATTERN, {
    message: 'Please choose a valid month, for example 2026-09.',
  })
  month!: string;
}

export class TdsQueryDto {
  @ApiProperty({
    example: 'FY2026-Q2',
    description: 'Financial year it starts in; Q1 = Apr–Jun',
  })
  @Transform(upper)
  @Matches(QUARTER_PATTERN, {
    message: 'Please choose a valid quarter, for example FY2026-Q2.',
  })
  quarter!: string;
}

export class CreateWithdrawalDto {
  @ApiProperty({ example: 1500, description: 'Whole ₹, before TDS' })
  @IsInt({ message: 'Please enter the amount in whole rupees.' })
  @Min(1)
  amount!: number;
}

export class WithdrawalParamDto {
  @ApiProperty({ example: 'WD-000001' })
  @Transform(upper)
  @Matches(WITHDRAWAL_ID_PATTERN, { message: 'This withdrawal is not valid.' })
  id!: string;
}

export class WithdrawalQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: WITHDRAWAL_STATUSES })
  @IsOptional()
  @IsIn(WITHDRAWAL_STATUSES)
  status?: WithdrawalStatus;
}

// ── HO ──────────────────────────────────────────────────────────────────

export class AgentParamDto {
  @ApiProperty({ example: 'VST-000006' })
  @Transform(upper)
  @Matches(PARTNER_ID_PATTERN, { message: 'This partner id is not valid.' })
  agentId!: string;
}

export class AdminWithdrawalQueryDto extends WithdrawalQueryDto {
  @ApiPropertyOptional({ example: 'VST-000006' })
  @IsOptional()
  @Transform(upper)
  @Matches(PARTNER_ID_PATTERN, { message: 'This partner id is not valid.' })
  agent_id?: string;
}

export class RejectWithdrawalDto {
  @ApiProperty({ example: 'Bank account name does not match PAN.' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Please give the partner a reason.' })
  @MaxLength(300)
  reason!: string;
}

/** A UTR / bank reference: letters and digits, as banks print them. */
const UTR_PATTERN = /^[A-Z0-9]{6,30}$/;

export class PayWithdrawalDto {
  @ApiProperty({
    example: 'SBIN526287123456',
    description: "The bank's reference",
  })
  @Transform(upper)
  @Matches(UTR_PATTERN, {
    message:
      'Please enter the UTR as the bank gave it (6–30 letters and digits).',
  })
  utr!: string;

  @ApiPropertyOptional({
    example: '2026-10-14T11:00:00+05:30',
    description:
      'When the transfer went out; now when left out (not in the future)',
  })
  @IsOptional()
  @IsDateString()
  paid_at?: string;
}

export class PaidItemDto {
  @ApiProperty({ example: 'WD-000001' })
  @Transform(upper)
  @Matches(WITHDRAWAL_ID_PATTERN, { message: 'This withdrawal is not valid.' })
  id!: string;

  @ApiProperty({ example: 'SBIN526287123456' })
  @Transform(upper)
  @Matches(UTR_PATTERN, {
    message:
      'Please enter each UTR as the bank gave it (6–30 letters and digits).',
  })
  utr!: string;
}

export class PayBatchDto {
  @ApiProperty({
    type: [PaidItemDto],
    description: 'Up to 200, as the bank file came back',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PaidItemDto)
  items!: PaidItemDto[];

  @ApiPropertyOptional({ example: '2026-10-14T11:00:00+05:30' })
  @IsOptional()
  @IsDateString()
  paid_at?: string;
}

export class AdminTdsQueryDto extends PageQueryDto {
  @ApiProperty({ example: 'FY2026-Q2' })
  @Transform(upper)
  @Matches(QUARTER_PATTERN, {
    message: 'Please choose a valid quarter, for example FY2026-Q2.',
  })
  quarter!: string;

  @ApiPropertyOptional({ example: 'VST-000006' })
  @IsOptional()
  @Transform(upper)
  @Matches(PARTNER_ID_PATTERN, { message: 'This partner id is not valid.' })
  agent_id?: string;
}

export class CertificateParamDto extends AgentParamDto {
  @ApiProperty({ example: 'FY2026-Q2' })
  @Transform(upper)
  @Matches(QUARTER_PATTERN, {
    message: 'Please choose a valid quarter, for example FY2026-Q2.',
  })
  quarter!: string;
}
