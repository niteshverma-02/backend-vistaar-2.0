import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { PageResult } from '@common/http/page-result';
import { Can } from '@modules/access/guards/capability.guard';

import type { AdminOrderView } from '../dto/admin-order.dto';
import { AdminOrdersQueryDto } from '../dto/admin-order.dto';
import { OrderParamDto } from '../dto/order-request.dto';
import { AdminOrderService } from '../services/admin-order.service';

/** Head office reads every partner's orders; orders are placed and moved elsewhere (app, Stockship). */
@ApiTags('admin · orders')
@Controller('admin/orders')
export class AdminOrderController {
  constructor(private readonly orders: AdminOrderService) {}

  @Get()
  @Can('orders.read')
  @ApiOperation({
    summary:
      "Every partner's orders, newest first; filter by stage, partner and IST dates",
  })
  list(
    @Query() query: AdminOrdersQueryDto,
  ): Promise<PageResult<AdminOrderView>> {
    return this.orders.list(query);
  }

  @Get(':id')
  @Can('orders.read')
  @ApiOperation({ summary: 'One order, with its partner and tracking steps' })
  get(@Param() { id }: OrderParamDto): Promise<AdminOrderView> {
    return this.orders.get(id);
  }
}
