import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  CurrentPartner,
  type PartnerRef,
} from '@common/auth/current-partner.decorator';
import type { PageResult } from '@common/http/page-result';
import type { FarmerConsent } from '@modules/settings/services/settings.service';

import {
  AddActivityDto,
  AddFarmerDto,
  CheckPhoneQueryDto,
  FarmerLeadQueryDto,
  PiiParamDto,
  UpdateLeadDto,
} from '../dto/lead.dto';
import {
  LeadsService,
  type CheckStatus,
  type LeadDetail,
  type LeadView,
  type SavedLead,
} from '../services/leads.service';

/** The partner's own farmers. Whose they are comes from the token only. */
@ApiTags('app · leads')
@ApiBearerAuth()
@Controller('leads')
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Get('check')
  @ApiOperation({
    summary:
      'Before saving: new · yours · other_partner · katyayani (can add) · not_farmer · self',
  })
  check(
    @CurrentPartner() partner: PartnerRef,
    @Query() query: CheckPhoneQueryDto,
  ): Promise<{ status: CheckStatus; pii_id: string | null }> {
    return this.leads.check(partner, query.phone);
  }

  @Get('consent')
  @ApiOperation({
    summary: 'The consent wording to show beside the tick, and its version',
  })
  consent(): Promise<FarmerConsent> {
    return this.leads.consent();
  }

  @Get('summary')
  @ApiOperation({
    summary:
      'Cards: open pipeline ₹, conversion, due today (incl. overdue); counts by stage',
  })
  summary(@CurrentPartner() partner: PartnerRef) {
    return this.leads.summaryMine(partner);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Add a farmer, or update one you hold (same mobile) — safe to retry',
  })
  upsert(
    @CurrentPartner() partner: PartnerRef,
    @Body() dto: AddFarmerDto,
  ): Promise<SavedLead> {
    return this.leads.upsert(partner, dto);
  }

  @Get()
  @ApiOperation({
    summary:
      'My leads, most urgent first; `stage`, `due`, `q` (name, village, crop, mobile)',
  })
  list(
    @CurrentPartner() partner: PartnerRef,
    @Query() query: FarmerLeadQueryDto,
  ): Promise<PageResult<LeadView>> {
    return this.leads.listMine(partner, query);
  }

  @Get(':piiId')
  @ApiOperation({ summary: 'One lead with its stage history and activity' })
  get(
    @CurrentPartner() partner: PartnerRef,
    @Param() params: PiiParamDto,
  ): Promise<LeadDetail> {
    return this.leads.getMine(partner, params.piiId);
  }

  @Patch(':piiId')
  @ApiOperation({
    summary:
      'Stage (not won), lost reason, follow-up, expected value — only what is sent',
  })
  update(
    @CurrentPartner() partner: PartnerRef,
    @Param() params: PiiParamDto,
    @Body() dto: UpdateLeadDto,
  ): Promise<LeadDetail> {
    return this.leads.update(partner, params.piiId, dto);
  }

  @Post(':piiId/activities')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Log a call, visit, WhatsApp or note' })
  addActivity(
    @CurrentPartner() partner: PartnerRef,
    @Param() params: PiiParamDto,
    @Body() dto: AddActivityDto,
  ): Promise<LeadDetail> {
    return this.leads.addActivity(partner, params.piiId, dto);
  }
}
