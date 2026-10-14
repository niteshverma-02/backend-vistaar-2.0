import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

import { PageQueryDto } from '@common/dto/page-query.dto';

import {
  HINT_MAX,
  LABEL_MAX,
  PAYMENT_PROVIDERS,
  type PaymentProvider,
} from '../payments.domain';

const COHORT_KEY = /^[a-z][a-z0-9_]{1,40}$/;

export class UpdatePaymentOptionDto {
  @ApiProperty({
    example: 3,
    description:
      'The `version` HO read (0 for an option never saved). A stale one is 409 VERSION_CONFLICT.',
  })
  @IsInt()
  @Min(0)
  version!: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @ApiPropertyOptional({ example: 'Razorpay', maxLength: LABEL_MAX })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(LABEL_MAX)
  label?: string;

  @ApiPropertyOptional({
    example: 'UPI, cards, net banking',
    maxLength: HINT_MAX,
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(HINT_MAX)
  hint?: string | null;

  @ApiPropertyOptional({
    example: ['vistaar_agent'],
    description: 'Cohort keys that see it; empty = every partner',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @Matches(COHORT_KEY, { each: true })
  cohorts?: string[];
}

export class ReorderPaymentOptionsDto {
  @ApiProperty({
    example: ['phonepe', 'razorpay', 'cashfree'],
    description: 'Every option id once, first shown first',
  })
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(PAYMENT_PROVIDERS.length)
  @IsIn(PAYMENT_PROVIDERS, { each: true })
  ids!: PaymentProvider[];
}

export class PaymentAuditQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: PAYMENT_PROVIDERS })
  @IsOptional()
  @IsIn(PAYMENT_PROVIDERS)
  option_id?: PaymentProvider;
}
