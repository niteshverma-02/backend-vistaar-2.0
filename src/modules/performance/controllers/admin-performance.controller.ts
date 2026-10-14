import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentAdmin } from '@common/decorators/current-principal.decorator';
import type { AdminPrincipal } from '@common/interfaces/principal.interface';
import { Can } from '@modules/access/guards/capability.guard';

import {
  PerformanceAgentParamDto,
  PerformanceQueryDto,
  SetTargetDto,
} from '../dto/performance.dto';
import {
  PerformanceService,
  type PerformanceView,
} from '../services/performance.service';

/** HO reads a partner's performance as the app shows it, and sets their monthly target. */
@ApiTags('admin · performance')
@Controller('admin/performance')
export class AdminPerformanceController {
  constructor(private readonly performance: PerformanceService) {}

  @Get(':agentId')
  @Can('commission.read')
  @ApiOperation({ summary: "A partner's My Performance for a period" })
  get(
    @Param() { agentId }: PerformanceAgentParamDto,
    @Query() query: PerformanceQueryDto,
  ): Promise<PerformanceView> {
    return this.performance.performance(agentId, query.period);
  }

  @Put(':agentId/target')
  @Can('agents.edit')
  @ApiOperation({
    summary:
      "Set a partner's own monthly target, or `null` to put them back on the settings default",
  })
  setTarget(
    @Param() { agentId }: PerformanceAgentParamDto,
    @Body() dto: SetTargetDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<{ agent_id: string; own_target: number | null }> {
    return this.performance.setTarget(agentId, dto.monthly_target, admin.email);
  }
}
