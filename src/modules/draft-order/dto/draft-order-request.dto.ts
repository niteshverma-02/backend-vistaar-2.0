import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

import { PageQueryDto } from '@common/dto/page-query.dto';

/** `draft_order_id` as every writer hands it out: `DFT-96`. */
const DRAFT_ORDER_ID_PATTERN = /^DFT-\d{1,12}$/;

export class DraftOrderParamDto {
  @ApiProperty({ example: 'DFT-96' })
  @Matches(DRAFT_ORDER_ID_PATTERN, {
    message: 'This draft order number is not valid.',
  })
  id!: string;
}

/** Drafts are always newest first; `sort` is accepted and ignored. */
export class DraftOrdersQueryDto extends PageQueryDto {}
