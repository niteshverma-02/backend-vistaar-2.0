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
  CreateEarningRuleDto,
  EarningRuleParamDto,
  EarningRulesQueryDto,
  ReorderEarningRulesDto,
  UpdateEarningRuleDto,
} from '../dto/earning-rule.dto';
import {
  EarningRulesService,
  type EarningCatalog,
  type EarningRuleView,
} from '../services/earning-rules.service';

/** Coin / gig rules per earning cohort, built from the code catalog. */
@ApiTags('admin · earning')
@Controller('admin/earning-rules')
export class AdminEarningRulesController {
  constructor(private readonly rules: EarningRulesService) {}

  @Get('catalog')
  @Can('earning.read')
  @ApiOperation({
    summary:
      'Triggers, their fields (type, operators, values) and reward kinds — the rule form is built from this',
  })
  catalog(): EarningCatalog {
    return this.rules.catalog();
  }

  @Get()
  @Can('earning.read')
  @ApiOperation({
    summary: 'Rules by cohort, then HO order; by cohort_id and trigger',
  })
  list(
    @Query() query: EarningRulesQueryDto,
  ): Promise<PageResult<EarningRuleView>> {
    return this.rules.list(query);
  }

  @Put('order')
  @Can('earning.write')
  @ApiOperation({
    summary:
      'Set one cohort’s rule order: every active rule id once, first looked at first',
  })
  @ApiConflictResponse({
    description: '`EARNING_ORDER_CHANGED`: the list changed — reload',
  })
  reorder(
    @Body() dto: ReorderEarningRulesDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<{ cohort_id: string; ids: string[] }> {
    return this.rules.reorder(dto, admin.email);
  }

  @Get(':id')
  @Can('earning.read')
  @ApiOperation({ summary: 'One rule' })
  get(@Param() { id }: EarningRuleParamDto): Promise<EarningRuleView> {
    return this.rules.get(id);
  }

  @Post()
  @Can('earning.write')
  @ApiOperation({
    summary:
      'Add a rule to an active cohort (conditions checked against the catalog; goes last)',
  })
  @ApiConflictResponse({ description: '`EARNING_ARCHIVED`: cohort archived' })
  create(
    @Body() dto: CreateEarningRuleDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<EarningRuleView> {
    return this.rules.create(dto, admin.email);
  }

  @Patch(':id')
  @Can('earning.write')
  @ApiOperation({ summary: 'Edit name, conditions or reward' })
  @ApiConflictResponse({
    description: '`VERSION_CONFLICT` (stale version) / `EARNING_ARCHIVED`',
  })
  update(
    @Param() { id }: EarningRuleParamDto,
    @Body() dto: UpdateEarningRuleDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<EarningRuleView> {
    return this.rules.update(id, dto, admin.email);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @Can('earning.write')
  @ApiOperation({
    summary: 'Archive (the delete): it stops paying; rewards it gave stay',
  })
  @ApiConflictResponse({ description: '`EARNING_ARCHIVED`: already archived' })
  archive(
    @Param() { id }: EarningRuleParamDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<EarningRuleView> {
    return this.rules.archive(id, admin.email);
  }
}
