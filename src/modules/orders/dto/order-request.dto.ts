import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, Matches } from 'class-validator';

import { PageQueryDto } from '@common/dto/page-query.dto';

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
}
