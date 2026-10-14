import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { PageResult } from '@common/http/page-result';
import { Can } from '@modules/access/guards/capability.guard';

import type { AdminCartView } from '../dto/admin-cart.dto';
import { AdminCartsQueryDto } from '../dto/admin-cart.dto';
import { AdminCartService } from '../services/admin-cart.service';

/** Head office watches partners' open carts; only the partner fills or orders one. */
@ApiTags('admin · carts')
@Controller('admin/carts')
export class AdminCartController {
  constructor(private readonly carts: AdminCartService) {}

  @Get()
  @Can('orders.read')
  @ApiOperation({
    summary:
      "Partners' carts that hold a product and are not ordered yet, last touched first",
  })
  list(@Query() query: AdminCartsQueryDto): Promise<PageResult<AdminCartView>> {
    return this.carts.list(query);
  }
}
