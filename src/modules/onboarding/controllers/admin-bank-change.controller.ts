import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentAdmin } from '@common/decorators/current-principal.decorator';
import type { AdminPrincipal } from '@common/interfaces/principal.interface';
import { Can } from '@modules/access/guards/capability.guard';

import { ReasonDto } from '../dto/onboarding.dto';
import {
  BankChangeService,
  type AdminBankChangeView,
} from '../services/bank-change.service';

/** `:agentId` is the partner's `VST-…` id. */
@ApiTags('admin · partners')
@Controller('admin/agents')
export class AdminBankChangeController {
  constructor(private readonly bankChange: BankChangeService) {}

  @Get(':agentId/bank-change')
  @Can('kyc.review')
  @ApiOperation({
    summary:
      "The partner's pending or last bank account change — full number, signed proof, and the account paid into now; null when none",
  })
  get(@Param('agentId') agentId: string): Promise<AdminBankChangeView | null> {
    return this.bankChange.forDesk(agentId);
  }

  @Post(':agentId/bank-change/approve')
  @HttpCode(200)
  @Can('kyc.review')
  @ApiOperation({
    summary:
      'Approve the pending change: the new account and proof go into the form, the proof verified (copied to the org record like any verified KYC document)',
  })
  approve(
    @Param('agentId') agentId: string,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminBankChangeView> {
    return this.bankChange.approve(agentId, admin.email);
  }

  @Post(':agentId/bank-change/reject')
  @HttpCode(200)
  @Can('kyc.review')
  @ApiOperation({
    summary:
      'Reject the pending change with a reason the partner sees; the current account stays',
  })
  reject(
    @Param('agentId') agentId: string,
    @Body() dto: ReasonDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminBankChangeView> {
    return this.bankChange.reject(agentId, dto.reason, admin.email);
  }
}
