import { ApiProperty } from '@nestjs/swagger';

export class DraftOrderLineView {
  @ApiProperty({ example: 'K-350' })
  sku!: string;

  @ApiProperty()
  product_name!: string;

  @ApiProperty({ type: String, nullable: true })
  product_image!: string | null;

  @ApiProperty({ example: '1 L' })
  size_label!: string;

  @ApiProperty({ description: 'Dealer price per pack when saved.' })
  price!: number;

  @ApiProperty()
  mrp!: number;

  @ApiProperty()
  quantity!: number;

  @ApiProperty({ description: 'price × quantity when saved.' })
  line_total!: number;
}

export class DraftOrderView {
  @ApiProperty({ example: 'DFT-96', description: '`draft_order_id`.' })
  id!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'PII-1620690',
    description:
      "The farmer — the id the cart, leads and customers use; `null` = the partner's own stock.",
  })
  pii_id!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'C0-201985',
    description: "The customer's CRM contact, when they have one.",
  })
  contact_id!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "`null` = the partner's own stock.",
  })
  customer_name!: string | null;

  @ApiProperty({ type: String, nullable: true })
  contact_number!: string | null;

  @ApiProperty({ type: [DraftOrderLineView] })
  items!: DraftOrderLineView[];

  @ApiProperty({ description: 'Σ quantity.' })
  item_count!: number;

  @ApiProperty({ description: 'Σ line_total when saved (`grand_total`).' })
  subtotal!: number;

  @ApiProperty()
  reminder_sent!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  updated_at!: Date;
}
