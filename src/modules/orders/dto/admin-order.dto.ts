import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

import type { OrderStage } from '../orders.domain';
import type { OrderView } from './order-view.dto';
import { OrdersQueryDto } from './order-request.dto';

/** `orders_v2.payment_mode` as Stockship writes it. */
export const PAYMENT_MODES = ['cod', 'prepaid', 'partial', 'credit'] as const;

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

  @ApiPropertyOptional({ enum: PAYMENT_MODES })
  @IsOptional()
  @IsIn(PAYMENT_MODES)
  payment_mode?: (typeof PAYMENT_MODES)[number];

  @ApiPropertyOptional({
    example: 'MADHYA PRADESH',
    description: 'Shipping state (any case)',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(60)
  state?: string;

  @ApiPropertyOptional({
    example: 'KSK-341382',
    description:
      'An order id (exact), or 4+ digits of the buyer’s phone (its end)',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(40)
  q?: string;
}

/** `GET /admin/orders/breakdown`: sales panels, cancelled and returned left out. */
export interface AdminOrderBreakdown {
  /** The window it covers: IST days, `to` included. */
  from: string;
  to: string;
  by_day: { day: string; orders: number; value: number }[];
  by_partner: {
    agent_id: string;
    name: string | null;
    orders: number;
    value: number;
  }[];
  by_state: { state: string; orders: number; value: number }[];
  by_city: { city: string; orders: number; value: number }[];
  /** Top 10 packs by value of the lines (what buyers paid for them). */
  by_product: {
    sku: string;
    name: string;
    image: string | null;
    qty: number;
    value: number;
  }[];
  /** Every category, largest first; `Other` = packs with no category. */
  by_category: { name: string; value: number; pct: number }[];
  /** Buyers with two or more orders in the window. */
  repeat_buyers: number;
}

/** `GET /admin/orders/summary`: the same filters as the list. */
export interface AdminOrderSummary {
  orders: number;
  /** Σ what buyers pay, cancelled and returned orders left out. */
  value: number;
  partners: number;
  customers: number;
  by_stage: { stage: OrderStage; count: number; value: number }[];
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
