import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { PageResult } from '@common/http/page-result';
import { Can } from '@modules/access/guards/capability.guard';

import type {
  AdminOrderBreakdown,
  AdminOrderSummary,
  AdminOrderView,
} from '../dto/admin-order.dto';
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
      "Every partner's orders, newest first; filter by stage, partner, buyer, IST dates, payment mode, state, order id or phone",
  })
  list(
    @Query() query: AdminOrdersQueryDto,
  ): Promise<PageResult<AdminOrderView>> {
    return this.orders.list(query);
  }

  @Get('summary')
  @Can('orders.read')
  @ApiOperation({
    summary:
      'Cards for the same filters as the list: orders, value, partners, buyers, per stage',
  })
  summary(@Query() query: AdminOrdersQueryDto): Promise<AdminOrderSummary> {
    return this.orders.summary(query);
  }

  @Get('breakdown')
  @Can('orders.read')
  @ApiOperation({
    summary:
      'Sales panels for the same filters and window as /summary: per day, partner, state, city, best packs, category split, repeat buyers (cancelled + returned left out)',
  })
  breakdown(@Query() query: AdminOrdersQueryDto): Promise<AdminOrderBreakdown> {
    return this.orders.breakdown(query);
  }

  @Get(':id')
  @Can('orders.read')
  @ApiOperation({ summary: 'One order, with its partner and tracking steps' })
  get(@Param() { id }: OrderParamDto): Promise<AdminOrderView> {
    return this.orders.get(id);
  }
}
