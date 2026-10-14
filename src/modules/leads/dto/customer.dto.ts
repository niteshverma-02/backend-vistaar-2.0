import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

import { PageQueryDto } from '@common/dto/page-query.dto';
import { MONTH_PATTERN } from '@modules/attendance/attendance.domain';

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

  @ApiPropertyOptional({
    example: '2026-09',
    description:
      'Only customers ordered for in this IST month (Reports → customer list)',
  })
  @IsOptional()
  @Transform(trim)
  @Matches(MONTH_PATTERN, {
    message: 'Please choose a valid month, for example 2026-09.',
  })
  ordered_in?: string;
}

const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

/**
 * The order service's call when an order is confirmed (TL). Trusted as sent —
 * the order is not read again — so only the secret holder may call.
 */
export class OrderEventDto {
  @ApiProperty({ example: 'KSK-341382', description: '`orders_v2.order_id`' })
  @Transform(upper)
  @Matches(/^[A-Z0-9][A-Z0-9_/-]{1,39}$/, {
    message: 'This order number is not valid.',
  })
  order_id!: string;

  @ApiProperty({ example: 'PII-1620690', description: 'The farmer (buyer)' })
  @Transform(upper)
  @Matches(/^PII-[A-Z0-9-]{1,20}$/, { message: 'pii_id is not valid.' })
  pii_id!: string;

  @ApiProperty({
    example: 'VST-000006',
    description: 'The partner who placed it (`orders_v2.agent`)',
  })
  @Transform(upper)
  @Matches(/^VST-\d+$/, { message: 'agent_id must be a VST- id.' })
  agent_id!: string;

  @ApiPropertyOptional({
    example: '2026-10-14T10:30:00+05:30',
    description: 'When the order was placed; now when left out',
  })
  @IsOptional()
  @IsDateString()
  order_date?: string;
}
