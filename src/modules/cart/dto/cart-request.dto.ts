import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import { LocationDto } from '@common/dto/location.dto';

import { MAX_QUANTITY } from '../cart.domain';

/** B2B skus look like `K-350`; anything else never matches a pack. */
const SKU_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

export class AddCartItemDto {
  @ApiProperty({
    example: 'K-350',
    description: 'Pack sku (a variant, not the bulk sku).',
  })
  @Matches(SKU_PATTERN, { message: 'This product pack is not valid.' })
  sku!: string;

  @ApiPropertyOptional({
    type: Number,
    minimum: 1,
    maximum: MAX_QUANTITY,
    default: 1,
    description:
      'Added to the quantity already in the cart, then capped at stock.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_QUANTITY)
  quantity = 1;
}

export class UpdateCartItemDto {
  @ApiProperty({
    type: Number,
    minimum: 0,
    maximum: MAX_QUANTITY,
    description: 'The new quantity, capped at stock. 0 removes the line.',
  })
  @IsInt()
  @Min(0)
  @Max(MAX_QUANTITY)
  quantity!: number;
}

export class SkuParamDto {
  @ApiProperty({ example: 'K-350' })
  @Matches(SKU_PATTERN, { message: 'This product pack is not valid.' })
  sku!: string;
}

/** ko-sales person ids: `PII-1620388`. */
const PII_ID_PATTERN = /^PII-\d{1,15}$/;

export class SetCartCustomerDto {
  @ApiProperty({
    type: String,
    nullable: true,
    example: 'PII-1620388',
    description:
      "The customer's `pii_id` the cart is for; `null` for the partner's own shop stock.",
  })
  @ValidateIf((o: SetCartCustomerDto) => o.pii_id !== null)
  @Matches(PII_ID_PATTERN, {
    message: 'This customer is not valid. Please choose the customer again.',
  })
  pii_id!: string | null;

  @ApiPropertyOptional({
    type: LocationDto,
    description:
      'The phone GPS now — kept as a rough place for the farmer (never over one from a visit or an add)',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocationDto)
  location?: LocationDto;
}
