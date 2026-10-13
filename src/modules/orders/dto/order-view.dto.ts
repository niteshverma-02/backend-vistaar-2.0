import { ApiProperty } from '@nestjs/swagger';

import { ORDER_STAGES, type OrderStage } from '../orders.domain';

export class OrderLineView {
  @ApiProperty({ example: 'K-489' })
  sku!: string;

  @ApiProperty({ description: '`products_v2.name`; the sku when not found.' })
  product_name!: string;

  @ApiProperty({ type: String, nullable: true })
  product_image!: string | null;

  @ApiProperty({ example: '250 ML' })
  size_label!: string;

  @ApiProperty()
  quantity!: number;

  @ApiProperty({ description: 'Price per pack on the order.' })
  unit_price!: number;

  @ApiProperty({ description: 'unit_price × quantity on the order.' })
  line_total!: number;

  @ApiProperty()
  is_free!: boolean;
}

export class OrderTrackingStepView {
  @ApiProperty({ example: 'Shipped' })
  status!: string;

  @ApiProperty({ example: 'Handed to courier' })
  description!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  timestamp!: Date | null;

  @ApiProperty()
  completed!: boolean;
}

export class OrderView {
  @ApiProperty({ example: 'KSK-341382', description: '`order_id`.' })
  id!: string;

  @ApiProperty({ enum: ORDER_STAGES })
  status!: OrderStage;

  @ApiProperty({
    example: 'in_transit',
    description: "Stockship's raw `order_status`, for support.",
  })
  order_status!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'PII-273762',
    description: "The buyer's `pii_id`; `null` = the partner's own stock.",
  })
  customer_id!: string | null;

  @ApiProperty()
  customer_name!: string;

  @ApiProperty({ type: String, nullable: true })
  customer_phone!: string | null;

  @ApiProperty({ type: [OrderLineView] })
  items!: OrderLineView[];

  @ApiProperty({ description: 'Σ quantity.' })
  item_count!: number;

  @ApiProperty({ description: 'Before discounts (`original_total_amount`).' })
  subtotal!: number;

  @ApiProperty({ description: 'Σ `discounts[].discount_amount`.' })
  discount!: number;

  @ApiProperty({ description: '`coin`.' })
  coins_used!: number;

  @ApiProperty({ description: '`extra_charges.delivery_charge`.' })
  delivery_charge!: number;

  @ApiProperty({ description: 'What the buyer pays (`total_amount`).' })
  total!: number;

  @ApiProperty({
    example: 'cod',
    description: 'cod / prepaid / partial / credit.',
  })
  payment_mode!: string;

  @ApiProperty()
  cod_amount!: number;

  @ApiProperty()
  prepaid_amount!: number;

  @ApiProperty({ description: 'The shipping address on one line.' })
  delivery_address!: string;

  @ApiProperty({ type: String, nullable: true })
  awb!: string | null;

  @ApiProperty({ type: String, nullable: true })
  courier!: string | null;

  @ApiProperty({ type: [OrderTrackingStepView] })
  tracking_steps!: OrderTrackingStepView[];

  @ApiProperty({ type: String, format: 'date-time' })
  created_at!: Date;
}
