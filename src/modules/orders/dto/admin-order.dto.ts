import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, Matches } from 'class-validator';

import type { OrderView } from './order-view.dto';
import { OrdersQueryDto } from './order-request.dto';

/** A Vistaar partner id as the app issues it. */
const PARTNER_ID_PATTERN = /^VST-[A-Z0-9-]{1,30}$/;

/** `GET /admin/orders`: the whole Vistaar book, newest first. */
export class AdminOrdersQueryDto extends OrdersQueryDto {
  @ApiPropertyOptional({
    example: 'VST-1001',
    description: "Only this partner's orders",
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(PARTNER_ID_PATTERN, { message: 'This partner id is not valid.' })
  agent_id?: string;
}

/** The partner an order belongs to, as HO lists them. */
export interface OrderPartner {
  agent_id: string;
  name: string | null;
  phone: string | null;
  cohort: string | null;
  district: string | null;
  state: string | null;
}

/** The app's `OrderView`, plus whose order it is and where it ships to. */
export interface AdminOrderView extends OrderView {
  /** `null` only for a row whose `agent` is empty (should not happen on source vistaar). */
  partner: OrderPartner | null;
  ship_to: {
    city: string | null;
    state: string | null;
    pincode: string | null;
  };
}
