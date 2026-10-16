import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentAdmin } from '@common/decorators/current-principal.decorator';
import type { PageResult } from '@common/http/page-result';
import type { AdminPrincipal } from '@common/interfaces/principal.interface';
import { istMonthKey } from '@common/utils/ist-day.util';
import { Can } from '@modules/access/guards/capability.guard';

import {
  CreatePlanDto,
  PlanInEffectQueryDto,
  PlanListQueryDto,
  PlanParamDto,
  UpdatePlanDto,
} from '../dto/commission-plan.dto';
import {
  CommissionPlansService,
  type PlanInEffectRow,
  type PlanView,
} from '../services/commission-plans.service';

/**
 * Commission slabs per cohort, from a month on — an earning cohort (`ec_…`)
 * or a partner type (orders before the partner's first earning cohort).
 * Past months are locked: they have been paid on.
 */
@ApiTags('admin · commission plans')
@Controller('admin/commission-plans')
export class AdminCommissionPlansController {
  constructor(private readonly plans: CommissionPlansService) {}

  @Get()
  @Can('commission.read')
  @ApiOperation({
    summary:
      'Every saved plan, by cohort, latest month first (an earning cohort without one earns the default cohort’s; a partner type, the PRD’s draft rates)',
  })
  list(@Query() query: PlanListQueryDto): Promise<PageResult<PlanView>> {
    return this.plans.list(query);
  }

  @Get('in-effect')
  @Can('commission.read')
  @ApiOperation({
    summary:
      'Each active partner type’s — or with scope=earning, earning cohort’s — slabs in a month (default this month), the plan they come from, and whose rates an earning cohort without a plan inherits',
  })
  inEffect(@Query() query: PlanInEffectQueryDto): Promise<PlanInEffectRow[]> {
    return this.plans.inEffect(
      query.month ?? istMonthKey(new Date()),
      query.scope,
    );
  }

  @Get(':id')
  @Can('commission.read')
  @ApiOperation({ summary: 'One plan, with its change history' })
  get(@Param() { id }: PlanParamDto): Promise<PlanView> {
    return this.plans.get(id);
  }

  @Post()
  @Can('commission.plans')
  @ApiOperation({
    summary:
      'Add a cohort’s plan (fixed % or slabs, optional minimum order value) from a month (this month or later); 409 PLAN_EXISTS for the same cohort and month',
  })
  create(
    @Body() dto: CreatePlanDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<PlanView> {
    return this.plans.create(dto, admin.email);
  }

  @Patch(':id')
  @Can('commission.plans')
  @ApiOperation({
    summary:
      'Change kind, slabs / rate, minimum order value or notes (this month or later, else 409 PLAN_LOCKED); `draft` alone signs off any plan',
  })
  update(
    @Param() { id }: PlanParamDto,
    @Body() dto: UpdatePlanDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<PlanView> {
    return this.plans.update(id, dto, admin.email);
  }

  @Delete(':id')
  @Can('commission.plans')
  @ApiOperation({
    summary:
      'Delete a plan for this month or later; the cohort goes back to its earlier plan',
  })
  remove(@Param() { id }: PlanParamDto): Promise<{ deleted: true }> {
    return this.plans.remove(id);
  }
}
