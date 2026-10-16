import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentPartnerId } from '@common/auth/current-partner.decorator';
import type { PageResult } from '@common/http/page-result';

import { RewardsQueryDto } from '../dto/reward.dto';
import {
  RewardsService,
  type RewardView,
  type RewardsSummary,
} from '../services/rewards.service';

/**
 * The partner's own coin and gig rewards. Read-only: rewards are made by
 * events (a lead added, a follow-up done) and decided by HO.
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
}
