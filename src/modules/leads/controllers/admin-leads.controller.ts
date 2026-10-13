import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentAdmin } from '@common/decorators/current-principal.decorator';
import type { PageResult } from '@common/http/page-result';
import type { AdminPrincipal } from '@common/interfaces/principal.interface';
import { Can } from '@modules/access/guards/capability.guard';

import {
  AdminLeadQueryDto,
  PiiParamDto,
  TransferLeadDto,
} from '../dto/lead.dto';
import {
  LeadsService,
  type AdminLeadDetail,
  type PartnerLeadView,
} from '../services/leads.service';

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
    summary:
      'One farmer with stage history, activity, the partner and the partners before',
  })
  get(@Param() params: PiiParamDto): Promise<AdminLeadDetail> {
    return this.leads.get(params.piiId);
  }

  @Post(':piiId/transfer')
  @HttpCode(HttpStatus.OK)
  @Can('leads.transfer')
  @ApiOperation({
    summary:
      'Move a farmer to another approved partner (PRD AD8); they start over at Prospect, a customer stays won',
  })
  transfer(
    @Param() params: PiiParamDto,
    @Body() dto: TransferLeadDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminLeadDetail> {
    return this.leads.transfer(params.piiId, dto, admin.email);
  }
}
