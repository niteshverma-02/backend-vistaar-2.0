import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { PageResult } from '@common/http/page-result';
import { Can } from '@modules/access/guards/capability.guard';
import { AdminCartsQueryDto } from '@modules/cart/dto/admin-cart.dto';

import type { AdminDraftOrderView } from '../dto/draft-order-view.dto';
import { AdminDraftOrderService } from '../services/admin-draft-order.service';

/** Head office watches saved carts; only the partner restores, orders or deletes one. */
@ApiTags('admin · draft orders')
@Controller('admin/draft-orders')
export class AdminDraftOrderController {
  constructor(private readonly drafts: AdminDraftOrderService) {}

  @Get()
  @Can('orders.read')
  @ApiOperation({
    summary:
      "Partners' saved carts not ordered yet, last saved first, with the reminder flag",
  })
  list(
    @Query() query: AdminCartsQueryDto,
  ): Promise<PageResult<AdminDraftOrderView>> {
    return this.drafts.list(query);
  }
}
