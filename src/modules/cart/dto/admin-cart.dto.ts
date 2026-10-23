import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, Matches } from 'class-validator';

import { PageQueryDto } from '@common/dto/page-query.dto';
import type { FarmerCard } from '@modules/leads/services/leads.service';
import type { OrderPartner } from '@modules/orders/dto/admin-order.dto';

/** A Vistaar partner id as the app issues it. */
const PARTNER_ID_PATTERN = /^VST-[A-Z0-9-]{1,30}$/;

/** `GET /admin/carts` and `GET /admin/draft-orders`. */
export class AdminCartsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    example: 'VST-1001',
    description: "Only this partner's carts",
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(PARTNER_ID_PATTERN, { message: 'This partner id is not valid.' })
  agent_id?: string;
}

/** One line as the partner last wrote it: prices are the stored ones, not live. */
export interface AdminCartLine {
  sku: string;
  product_name: string;
  product_image: string | null;
  size_label: string;
  price: number;
  quantity: number;
  line_total: number;
}

/** `GET /admin/carts/summary`: the cards for the same carts as the list. */
export interface AdminCartsSummary {
  /** Carts holding a product, not ordered yet. */
  carts: number;
  /** Partners with such a cart: one cart per partner, so always `carts`. */
  partners: number;
  /** Σ subtotal as stored (the prices each partner last saw), whole ₹. */
  value: number;
  /** Σ quantity over every line, as the list's `item_count`. */
  items: number;
  /** Carts nobody touched for 7 IST days or more (`updated_at`). */
  stale_7d: number;
}

/** A partner's open cart, as HO watches it. Read-only: only the partner orders. */
export interface AdminCartView {
  partner: OrderPartner;
  /** `null` = the partner's own shop stock. */
  pii_id: string | null;
  /** The farmer, when the partner holds them in Leads. */
  customer: FarmerCard | null;
  items: AdminCartLine[];
  item_count: number;
  subtotal: number;
  updated_at: Date | null;
}
