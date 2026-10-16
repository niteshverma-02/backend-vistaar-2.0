import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

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
  LeadOtpSendDto,
  LeadOtpVerifyDto,
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

/**
 * Per partner (the tracker keys on the token), as sign-in's OTP routes: far
 * above adding farmers by hand, low enough that no account becomes an SMS
 * cannon. The OTP service adds its per-number limit on top.
 */
const OTP_LIMIT = { default: { limit: 20, ttl: 60_000 } };

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

  @Post('otp/send')
  @HttpCode(HttpStatus.OK)
  @Throttle(OTP_LIMIT)
  @ApiOperation({
    summary:
      'Send the farmer an OTP before adding them (approved partners; 3 per mobile per 10 min, `resend` included)',
  })
  sendOtp(
    @CurrentPartner() partner: PartnerRef,
    @Body() dto: LeadOtpSendDto,
  ): Promise<{ sent: true; resend_after_seconds: number }> {
    return this.leads.sendFarmerOtp(partner, dto.phone, dto.resend ?? false);
  }

  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  @Throttle(OTP_LIMIT)
  @ApiOperation({
    summary:
      'Check the farmer’s OTP → `otp_token` for `POST /leads`, valid 15 minutes for this mobile and you only',
  })
  verifyOtp(
    @CurrentPartner() partner: PartnerRef,
    @Body() dto: LeadOtpVerifyDto,
  ): Promise<{ otp_token: string; expires_at: Date }> {
    return this.leads.verifyFarmerOtp(partner, dto.phone, dto.otp);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Add a farmer, or update one you hold (same mobile) — needs `otp_token`; safe to retry within its 15 minutes',
  })
  @ApiBadRequestResponse({
    description:
      '`LEAD_OTP_REQUIRED` (no otp_token) / `LEAD_OTP_INVALID` (not this mobile’s or yours, or expired — verify again)',
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
      'Stage (not won), lost reason, follow-up, expected value, or the farmer’s details (not the mobile) — only what is sent',
  })
  update(
    @CurrentPartner() partner: PartnerRef,
    @Param() params: PiiParamDto,
    @Body() dto: UpdateLeadDto,
  ): Promise<LeadDetail> {
    return this.leads.update(partner, params.piiId, dto);
  }

  @Delete(':piiId')
  @ApiOperation({
    summary:
      'Remove a lead added by mistake — the farmer is free again; not a customer',
  })
  remove(
    @CurrentPartner() partner: PartnerRef,
    @Param() params: PiiParamDto,
  ): Promise<{ removed: true }> {
    return this.leads.remove(partner, params.piiId);
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
