import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  CurrentPartner,
  type PartnerRef,
} from '@common/auth/current-partner.decorator';

import { ActivityQueryDto, PerformanceQueryDto } from '../dto/performance.dto';
import {
  PerformanceService,
  type ActivityView,
  type PerformanceView,
  type Standing,
} from '../services/performance.service';

@ApiTags('app · performance')
@ApiBearerAuth()
@Controller('performance')
export class PerformanceController {
  constructor(private readonly performance: PerformanceService) {}

  @Get()
  @ApiOperation({
    summary:
      'My Performance for a period: sales vs target, orders, customers, conversion, commission, months, categories, top products, tier, health',
  })
  get(
    @CurrentPartner() partner: PartnerRef,
    @Query() query: PerformanceQueryDto,
  ): Promise<PerformanceView> {
    return this.performance.performance(partner.agent_id, query.period);
  }

  @Get('activity')
  @ApiOperation({
    summary:
      'My Activity for a day / week / month / quarter / FY: leads, customers, orders, attendance, visits, meetings, gigs, coins',
  })
  activity(
    @CurrentPartner() partner: PartnerRef,
    @Query() query: ActivityQueryDto,
  ): Promise<ActivityView> {
    return this.performance.activity(
      partner.agent_id,
      query.period,
      query.date,
    );
  }

  @Get('standing')
  @ApiOperation({
    summary:
      'Home / Profile: cohort, tier, lifecycle stage, health score, monthly target (≤ 5 min old)',
  })
  standing(@CurrentPartner() partner: PartnerRef): Promise<Standing> {
    return this.performance.standing(partner.agent_id);
  }
}
