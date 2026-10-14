import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  CurrentPartner,
  type PartnerRef,
} from '@common/auth/current-partner.decorator';
import type { PageResult } from '@common/http/page-result';

import { CustomerQueryDto } from '../dto/customer.dto';
import { PiiParamDto } from '../dto/lead.dto';
import {
  CustomersService,
  type CustomerDetail,
  type CustomerSummary,
  type CustomerView,
} from '../services/customers.service';

/** The partner's customers. Whose they are comes from the token only. */
@ApiTags('app · customers')
@ApiBearerAuth()
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @ApiOperation({
    summary:
      'My customers (leads won by a first confirmed order) — search, crop, sort',
  })
  list(
    @CurrentPartner() partner: PartnerRef,
    @Query() query: CustomerQueryDto,
  ): Promise<PageResult<CustomerView>> {
    return this.customers.list(partner, query);
  }

  @Get('summary')
  @ApiOperation({
    summary:
      'Customers screen tiles: total, active in 30 days, business, crops',
  })
  summary(@CurrentPartner() partner: PartnerRef): Promise<CustomerSummary> {
    return this.customers.summary(partner);
  }

  @Get(':piiId')
  @ApiOperation({
    summary:
      'One customer with business, stage history and activity; orders: GET /orders?customer=',
  })
  get(
    @CurrentPartner() partner: PartnerRef,
    @Param() params: PiiParamDto,
  ): Promise<CustomerDetail> {
    return this.customers.get(partner, params.piiId);
  }
}
