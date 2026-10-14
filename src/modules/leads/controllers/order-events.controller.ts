import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '@common/decorators/public.decorator';

import { OrderEventDto } from '../dto/customer.dto';
import {
  ORDER_EVENTS_HEADER,
  OrderEventsGuard,
} from '../guards/order-events.guard';
import {
  CustomersService,
  type OrderEventResult,
} from '../services/customers.service';

/** Server to server: the order service, not the app or HO. */
@ApiTags('hooks · orders')
@Controller('hooks/orders')
export class OrderEventsController {
  constructor(private readonly customers: CustomersService) {}

  @Post('confirmed')
  @Public()
  @UseGuards(OrderEventsGuard)
  @HttpCode(HttpStatus.OK)
  @ApiHeader({ name: ORDER_EVENTS_HEADER, required: true })
  @ApiOperation({
    summary:
      'An order is confirmed (order service) — its farmer becomes the partner’s customer (lead won). Idempotent.',
  })
  confirmed(@Body() dto: OrderEventDto): Promise<OrderEventResult> {
    return this.customers.recordOrder(dto);
  }
}
