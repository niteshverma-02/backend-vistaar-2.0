import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, Matches } from 'class-validator';

import { PageQueryDto } from '@common/dto/page-query.dto';
import { DATE_PATTERN } from '@modules/attendance/attendance.domain';

import { ORDER_STAGES, type OrderStage } from '../orders.domain';

/**
 * `orders_v2.order_id` as the channels issue it: `KSK-341382`, or
 * `ORD/K0-150/41350` (the app sends that one URL-encoded, `%2F`).
 */
const ORDER_ID_PATTERN = /^[A-Z0-9][A-Z0-9_/-]{1,39}$/;

export class OrderParamDto {
  @ApiProperty({ example: 'KSK-341382' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(ORDER_ID_PATTERN, { message: 'This order number is not valid.' })
  id!: string;
}

/** Orders are always newest first; `sort` is accepted and ignored. */
export class OrdersQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    enum: ORDER_STAGES,
    description: 'Only orders in this stage. Omit for all.',
  })
  @IsOptional()
  @IsIn(ORDER_STAGES)
  status?: OrderStage;

  @ApiPropertyOptional({
    example: 'PII-1620690',
    description: "One farmer's orders (a customer's Orders tab)",
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^PII-[A-Z0-9-]{1,20}$/, { message: 'This customer is not valid.' })
  customer?: string;

  @ApiPropertyOptional({
    example: '2026-09-01',
    description: 'First IST day placed, included',
  })
  @IsOptional()
  @Matches(DATE_PATTERN, {
    message: 'Please choose a valid start date, for example 2026-09-01.',
  })
  from?: string;

  @ApiPropertyOptional({
    example: '2026-09-30',
    description: 'Last IST day placed, included',
  })
  @IsOptional()
  @Matches(DATE_PATTERN, {
    message: 'Please choose a valid end date, for example 2026-09-30.',
  })
  to?: string;
}
