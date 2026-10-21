import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiConflictResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentAdmin } from '@common/decorators/current-principal.decorator';
import type { PageResult } from '@common/http/page-result';
import type { AdminPrincipal } from '@common/interfaces/principal.interface';
import { Can } from '@modules/access/guards/capability.guard';

import {
  CreateEarningCohortDto,
  EarningCohortParamDto,
  EarningCohortsQueryDto,
  PartnerParamDto,
  ReorderEarningCohortsDto,
  UpdateEarningCohortDto,
} from '../dto/earning-cohort.dto';
import {
  EarningCohortsService,
  type EarningCohortCatalog,
  type EarningCohortView,
  type PartnerEarningView,
} from '../services/earning-cohorts.service';

/**
 * HO's earning cohorts (not the onboarding cohorts at `/admin/cohorts`).
 * Every change that can move partners recomputes them all after answering.
 */
@ApiTags('admin · earning')
@Controller('admin/earning-cohorts')
export class AdminEarningCohortsController {
  constructor(private readonly cohorts: EarningCohortsService) {}

  @Get()
  @Can('earning.read')
  @ApiOperation({
    summary:
      'Earning cohorts in priority order (default last, then archived if asked), each with partners_count',
  })
  list(
    @Query() query: EarningCohortsQueryDto,
  ): Promise<PageResult<EarningCohortView>> {
    return this.cohorts.adminList(query);
  }

  @Get('catalog')
  @Can('earning.read')
  @ApiOperation({
    summary:
      'The partner fields and operators a cohort condition can use — build the form from this',
  })
  catalog(): EarningCohortCatalog {
    return this.cohorts.catalog();
  }

  @Put('order')
  @Can('earning.write')
  @ApiOperation({
    summary:
      'Set the priority order: every active cohort but ec_default, once, first looked at first',
  })
  @ApiConflictResponse({
    description: '`EARNING_ORDER_CHANGED`: the list changed — reload',
  })
  reorder(
    @Body() dto: ReorderEarningCohortsDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<{ ids: string[] }> {
    return this.cohorts.reorder(dto.ids, admin.email);
  }

  @Post('recompute')
  @HttpCode(HttpStatus.OK)
  @Can('earning.write')
  @ApiOperation({
    summary:
      'Work every approved partner’s cohort out now (once after deploy; otherwise automatic)',
  })
  recompute(): Promise<{ partners: number; changed: number }> {
    return this.cohorts.recomputeNow();
  }

  @Get(':id')
  @Can('earning.read')
  @ApiOperation({ summary: 'One earning cohort with partners_count' })
  get(@Param() { id }: EarningCohortParamDto): Promise<EarningCohortView> {
    return this.cohorts.adminGet(id);
  }

  @Post()
  @Can('earning.write')
  @ApiOperation({
    summary:
      'Add a cohort (at least one filter); it goes just above the default',
  })
  @ApiConflictResponse({ description: '`COHORT_EXISTS`: the key is taken' })
  create(
    @Body() dto: CreateEarningCohortDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<EarningCohortView> {
    return this.cohorts.create(dto, admin.email);
  }

  @Patch(':id')
  @Can('earning.write')
  @ApiOperation({
    summary:
      'Edit name, description, filters (not on ec_default) or meeting-gig payout',
  })
  @ApiConflictResponse({
    description: '`VERSION_CONFLICT` (stale version) / `EARNING_ARCHIVED`',
  })
  update(
    @Param() { id }: EarningCohortParamDto,
    @Body() dto: UpdateEarningCohortDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<EarningCohortView> {
    return this.cohorts.update(id, dto, admin.email);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @Can('earning.write')
  @ApiOperation({
    summary:
      'Archive (the delete): its partners move to the next cohort that takes them; history stays',
  })
  @ApiConflictResponse({ description: '`EARNING_ARCHIVED`: already archived' })
  archive(
    @Param() { id }: EarningCohortParamDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<EarningCohortView> {
    return this.cohorts.archive(id, admin.email);
  }
}

/** A partner's earning cohort, beside the partner desk's own routes. */
@ApiTags('admin · earning')
@Controller('admin/agents')
export class AdminPartnerEarningController {
  constructor(private readonly cohorts: EarningCohortsService) {}

  @Get(':agentId/earning-cohort')
  @Can('earning.read')
  @ApiOperation({
    summary:
      'A partner’s earning cohort now, the facts it was matched on, and every cohort before',
  })
  get(@Param() { agentId }: PartnerParamDto): Promise<PartnerEarningView> {
    return this.cohorts.partnerView(agentId);
  }
}
