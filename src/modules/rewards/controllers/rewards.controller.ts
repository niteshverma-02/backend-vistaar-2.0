import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentPartnerId } from '@common/auth/current-partner.decorator';
import type { PageResult } from '@common/http/page-result';

import { RewardsQueryDto, SpendCoinsDto } from '../dto/reward.dto';
import {
  RewardsService,
  type CoinSpend,
  type RewardView,
  type RewardsSummary,
} from '../services/rewards.service';

/**
 * The partner's own coin and gig rewards. Rewards are made by events (a lead
 * added, a follow-up done) and decided by HO; the partner only spends approved
 * coins on an order.
 */
@ApiTags('app · rewards')
@ApiBearerAuth()
@Controller('rewards')
export class RewardsController {
  constructor(private readonly rewards: RewardsService) {}

  @Get('summary')
  @ApiOperation({
    summary:
      'Coins approved / pending; gig ₹ approved / pending, and whether gig pay reaches the wallet yet',
  })
  summary(@CurrentPartnerId() agentId: string): Promise<RewardsSummary> {
    return this.rewards.summaryMine(agentId);
  }

  @Get()
  @ApiOperation({
    summary: 'My rewards, newest first; by kind (coin, gig) and status',
  })
  list(
    @CurrentPartnerId() agentId: string,
    @Query() query: RewardsQueryDto,
  ): Promise<PageResult<RewardView>> {
    return this.rewards.mine(agentId, query);
  }

  @Put('coins/:requestId')
  @ApiOperation({
    summary:
      'Spend approved coins (₹1 off each) on the order of this checkout attempt (its x-request-id); the same attempt again never spends twice',
  })
  spendCoins(
    @CurrentPartnerId() agentId: string,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() body: SpendCoinsDto,
  ): Promise<CoinSpend> {
    return this.rewards.spendCoins(
      agentId,
      requestId,
      body.coins,
      body.subtotal,
    );
  }

  @Delete('coins/:requestId')
  @ApiOperation({
    summary:
      'The order was not placed: the coins of this checkout attempt go back',
  })
  releaseCoins(
    @CurrentPartnerId() agentId: string,
    @Param('requestId', ParseUUIDPipe) requestId: string,
  ): Promise<{ request_id: string; released: boolean }> {
    return this.rewards.releaseCoins(agentId, requestId);
  }
}
