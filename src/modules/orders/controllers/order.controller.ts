import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import {
  CurrentPartner,
  type PartnerRef,
} from '@common/auth/current-partner.decorator';
import { PageResult } from '@common/http/page-result';

import { OrderParamDto, OrdersQueryDto } from '../dto/order-request.dto';
import { OrderView } from '../dto/order-view.dto';
import { OrderService } from '../services/order.service';

/**
 * The partner's placed orders, read from Stockship's `orders_v2`
 * (`source: 'vistaar'`, partner in `agent`). Nothing in a path or query says
 * whose they are.
 */
@ApiTags('orders')
@ApiBearerAuth()
@ApiExtraModels(PageResult, OrderView)
@Controller('orders')
export class OrderController {
  constructor(private readonly orders: OrderService) {}

  @Get()
  @ApiOperation({ summary: 'My orders, newest first; filter by stage' })
  list(
    @CurrentPartner() partner: PartnerRef,
    @Query() query: OrdersQueryDto,
  ): Promise<PageResult<OrderView>> {
    return this.orders.list(partner, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One order, with its tracking steps' })
  @ApiOkResponse({ type: OrderView })
  get(
    @CurrentPartner() partner: PartnerRef,
    @Param() { id }: OrderParamDto,
  ): Promise<OrderView> {
    return this.orders.get(partner, id);
  }
}
