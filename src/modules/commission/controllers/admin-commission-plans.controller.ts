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
  type PlanInEffect,
  type PlanView,
} from '../services/commission-plans.service';

/** Commission slabs per cohort, from a month on. Past months are locked: they have been paid on. */
@ApiTags('admin · commission plans')
@Controller('admin/commission-plans')
export class AdminCommissionPlansController {
  constructor(private readonly plans: CommissionPlansService) {}

  @Get()
  @Can('commission.read')
  @ApiOperation({
    summary:
      'Every saved plan, by cohort, latest month first (cohorts without one earn at the PRD’s draft rates)',
  })
  list(@Query() query: PlanListQueryDto): Promise<PageResult<PlanView>> {
    return this.plans.list(query);
  }

  @Get('in-effect')
  @Can('commission.read')
  @ApiOperation({
    summary:
      'Each active cohort’s slabs in a month (default this month), and the plan they come from',
  })
  inEffect(
    @Query() query: PlanInEffectQueryDto,
  ): Promise<(PlanInEffect & { label: string })[]> {
    return this.plans.inEffect(query.month ?? istMonthKey(new Date()));
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
      'Add a cohort’s plan from a month (this month or later); 409 PLAN_EXISTS for the same cohort and month',
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
      'Change slabs or notes (this month or later, else 409 PLAN_LOCKED); `draft` alone signs off any plan',
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
