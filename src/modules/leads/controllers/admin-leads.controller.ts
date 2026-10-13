import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import type { PageResult } from '@common/http/page-result';
import { Can } from '@modules/access/guards/capability.guard';

import { AdminLeadQueryDto, PiiParamDto } from '../dto/lead.dto';
import { LeadsService, type PartnerLeadView } from '../services/leads.service';

@ApiTags('admin · leads')
@Controller('admin/leads')
export class AdminLeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Get()
  @Can('leads.read')
  @ApiOperation({
    summary:
      "Farmers partners hold, newest first — everyone's, or one partner's (`agent_id`)",
  })
  list(
    @Query() query: AdminLeadQueryDto,
  ): Promise<PageResult<PartnerLeadView>> {
    return this.leads.list(query);
  }

  @Get('summary')
  @Can('leads.read')
  @ApiOperation({
    summary:
      'Totals, today, last 7 days, partners adding, by stage, top partners',
  })
  summary() {
    return this.leads.summary();
  }

  @Get(':piiId')
  @Can('leads.read')
  @ApiOperation({
    summary: 'One farmer with stage history, activity and the partner',
  })
  get(@Param() params: PiiParamDto) {
    return this.leads.get(params.piiId);
  }
}
