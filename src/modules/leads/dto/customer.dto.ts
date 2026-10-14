import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

import { PageQueryDto } from '@common/dto/page-query.dto';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * `sort`: `-last_order_at` (latest order first — the default), `-spend`
 * (highest first) or `name` (A–Z), as the app's Farmers screen sorts.
 */
export class CustomerQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    description: 'Name, village, district, crop, or digits of the mobile',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  q?: string;

  @ApiPropertyOptional({ example: 'Wheat', description: 'One crop (a chip)' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  crop?: string;
}

/** The order service's call when Stockship confirms an order. */
export class OrderEventDto {
  @ApiProperty({ example: 'KSK-341382', description: '`orders_v2.order_id`' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z0-9][A-Z0-9_/-]{1,39}$/, {
    message: 'This order number is not valid.',
  })
  order_id!: string;
}
