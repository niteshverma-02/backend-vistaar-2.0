import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
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

import { IssueOrderIdDto, OrderIdView } from '../dto/order-id.dto';
import { OrderParamDto, OrdersQueryDto } from '../dto/order-request.dto';
import { OrderView } from '../dto/order-view.dto';
import { OrderIdService } from '../services/order-id.service';
import { OrderService } from '../services/order.service';

/** A checkout asks once, with a retry or two; more is a loop burning numbers. */
const ORDER_ID_LIMIT = { default: { limit: 10, ttl: 60_000 } };

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
  constructor(
    private readonly orders: OrderService,
    private readonly orderIds: OrderIdService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'My orders, newest first; filter by stage' })
  list(
    @CurrentPartner() partner: PartnerRef,
    @Query() query: OrdersQueryDto,
  ): Promise<PageResult<OrderView>> {
    return this.orders.list(partner, query);
  }

  @Post('id')
  @HttpCode(HttpStatus.OK)
  @Throttle(ORDER_ID_LIMIT)
  @ApiOperation({
    summary: 'An order number (KSV-n) for one checkout attempt',
    description:
      'The same request_id always returns the same number, so retries are safe. 403 PARTNER_NOT_APPROVED / ACCOUNT_BLOCKED; 429 after 10 a minute; 503 ORDER_ID_UNAVAILABLE: retry later with the same request_id.',
  })
  @ApiOkResponse({ type: OrderIdView })
  issueId(
    @CurrentPartner() partner: PartnerRef,
    @Body() body: IssueOrderIdDto,
  ): Promise<OrderIdView> {
    return this.orderIds.issueForPartner(partner.agent_id, body.request_id);
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
