import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import type { PageResult } from '@common/http/page-result';
import { Can } from '@modules/access/guards/capability.guard';

import { AdminCustomerQueryDto } from '../dto/customer.dto';
import { PiiParamDto } from '../dto/lead.dto';
import {
  CustomersService,
  type AdminCustomerDetail,
  type AdminCustomerView,
} from '../services/customers.service';

/**
 * Every partner's customers (won leads) with their business, for HO's
 * Customers screen. Read-only: a customer is made by a confirmed order and
 * moved with the lead transfer (`/admin/leads/:piiId/transfer`).
 */
@ApiTags('admin · customers')
@Controller('admin/customers')
export class AdminCustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @Can('leads.read')
  @ApiOperation({
    summary:
      'Customers with orders, spend and last order — filter as /admin/leads; latest order first',
  })
  list(
    @Query() query: AdminCustomerQueryDto,
  ): Promise<PageResult<AdminCustomerView>> {
    return this.customers.adminList(query);
  }

  @Get('summary')
  @Can('leads.read')
  @ApiOperation({
    summary:
      'Customers, ordered in the last 30 days, won this month, top states',
  })
  summary() {
    return this.customers.adminSummary();
  }

  @Get(':piiId')
  @Can('leads.read')
  @ApiOperation({
    summary:
      'One customer: the lead detail with partner, history and business (orders: /admin/orders?customer=)',
  })
  get(@Param() params: PiiParamDto): Promise<AdminCustomerDetail> {
    return this.customers.adminGet(params.piiId);
  }
}
