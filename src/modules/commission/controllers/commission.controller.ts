import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  CurrentPartner,
  type PartnerRef,
} from '@common/auth/current-partner.decorator';

import {
  LedgerQueryDto,
  StatementQueryDto,
  TdsQueryDto,
} from '../dto/commission.dto';
import {
  CommissionService,
  type CommissionStatement,
  type CommissionSummary,
  type LedgerPage,
  type MyPlans,
  type TdsReport,
} from '../services/commission.service';

/**
 * The partner's commission, worked out from their own orders. Read-only:
 * commission is never entered — it follows the orders.
 */
@ApiTags('app · commission')
@ApiBearerAuth()
@Controller()
export class CommissionController {
  constructor(private readonly commission: CommissionService) {}

  @Get('commission/summary')
  @ApiOperation({
    summary:
      'Every "earn" number: this month’s delivered sales, slab rate and next slab, totals by status, withdrawable',
  })
  summary(@CurrentPartner() partner: PartnerRef): Promise<CommissionSummary> {
    return this.commission.summary(partner.agent_id);
  }

  @Get('commission/ledger')
  @ApiOperation({
    summary:
      'Commission per order, newest first; filter by status. `totals` cover the whole ledger',
  })
  ledger(
    @CurrentPartner() partner: PartnerRef,
    @Query() query: LedgerQueryDto,
  ): Promise<LedgerPage> {
    return this.commission.ledger(partner.agent_id, query);
  }

  @Get('commission/plans')
  @ApiOperation({
    summary:
      'Every cohort’s slabs this month (mine marked), TDS rates, minimum withdrawal, return window',
  })
  plans(@CurrentPartner() partner: PartnerRef): Promise<MyPlans> {
    return this.commission.plansFor(partner.agent_id);
  }

  @Get('reports/commission-statement')
  @ApiOperation({
    summary:
      'Orders placed in a month with their commission, and the month’s TDS at my rate (the app builds the CSV)',
  })
  statement(
    @CurrentPartner() partner: PartnerRef,
    @Query() query: StatementQueryDto,
  ): Promise<CommissionStatement> {
    return this.commission.statement(partner.agent_id, query.month);
  }

  @Get('reports/tds')
  @ApiOperation({
    summary:
      'TDS deducted at payout in a quarter, month by month, with the Form 16A once HO uploads it',
  })
  tds(
    @CurrentPartner() partner: PartnerRef,
    @Query() query: TdsQueryDto,
  ): Promise<TdsReport> {
    return this.commission.tds(partner.agent_id, query.quarter);
  }
}
