import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  CurrentPartner,
  type PartnerRef,
} from '@common/auth/current-partner.decorator';
import type { PageResult } from '@common/http/page-result';

import {
  CreateWithdrawalDto,
  WithdrawalParamDto,
  WithdrawalQueryDto,
} from '../dto/commission.dto';
import {
  WalletService,
  type WalletView,
  type WithdrawalView,
} from '../services/wallet.service';

/**
 * The partner's wallet. A withdrawal is asked for, read and cancelled here;
 * it is not edited (cancel and ask again) and never deleted — HO approves
 * and pays it (`/admin/withdrawals`), and it stays as the payment record.
 */
@ApiTags('app · wallet')
@ApiBearerAuth()
@Controller('wallet')
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get()
  @ApiOperation({
    summary:
      'Withdrawable balance, what is on hold, TDS rate, bank account, and whether I can withdraw now (and why not)',
  })
  get(@CurrentPartner() partner: PartnerRef): Promise<WalletView> {
    return this.wallet.wallet(partner.agent_id);
  }

  @Post('withdrawals')
  @ApiOperation({
    summary:
      'Ask to be paid (whole ₹, ≥ the minimum, ≤ withdrawable); one open request at a time',
  })
  request(
    @CurrentPartner() partner: PartnerRef,
    @Body() dto: CreateWithdrawalDto,
  ): Promise<WithdrawalView> {
    return this.wallet.request(partner.agent_id, dto);
  }

  @Get('withdrawals')
  @ApiOperation({ summary: 'My withdrawals, newest first' })
  list(
    @CurrentPartner() partner: PartnerRef,
    @Query() query: WithdrawalQueryDto,
  ): Promise<PageResult<WithdrawalView>> {
    return this.wallet.mine(partner.agent_id, query);
  }

  @Get('withdrawals/:id')
  @ApiOperation({ summary: 'One withdrawal' })
  getOne(
    @CurrentPartner() partner: PartnerRef,
    @Param() { id }: WithdrawalParamDto,
  ): Promise<WithdrawalView> {
    return this.wallet.mineOne(partner.agent_id, id);
  }

  @Delete('withdrawals/:id')
  @ApiOperation({
    summary:
      'Cancel a withdrawal HO has not approved yet (kept as cancelled, not erased)',
  })
  cancel(
    @CurrentPartner() partner: PartnerRef,
    @Param() { id }: WithdrawalParamDto,
  ): Promise<WithdrawalView> {
    return this.wallet.cancel(partner.agent_id, id);
  }
}
