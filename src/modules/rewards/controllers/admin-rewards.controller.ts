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
import { ApiConflictResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentAdmin } from '@common/decorators/current-principal.decorator';
import type { PageResult } from '@common/http/page-result';
import type { AdminPrincipal } from '@common/interfaces/principal.interface';
import { Can } from '@modules/access/guards/capability.guard';

import {
  AdminRewardsQueryDto,
  AdminRewardsSummaryQueryDto,
  BulkRejectRewardsDto,
  BulkRewardsDto,
  RejectRewardDto,
  RewardParamDto,
} from '../dto/reward.dto';
import {
  RewardsService,
  type AdminRewardView,
  type AdminRewardsSummary,
  type BulkResult,
} from '../services/rewards.service';

/**
 * HO's rewards desk: every coin / gig reward partners earned, approved or
 * rejected here. No create (events make them) and no delete (an approved gig
 * is money in a wallet; a rejected one is the partner's answer).
 */
@ApiTags('admin · rewards')
@Controller('admin/rewards')
export class AdminRewardsController {
  constructor(private readonly rewards: RewardsService) {}

  @Get()
  @Can('rewards.read')
  @ApiOperation({
    summary:
      'Rewards, newest first; by status, kind, trigger, agent_id and IST days from / to',
  })
  list(
    @Query() query: AdminRewardsQueryDto,
  ): Promise<PageResult<AdminRewardView>> {
    return this.rewards.list(query);
  }

  @Get('summary')
  @Can('rewards.read')
  @ApiOperation({
    summary:
      'Count and Σ amount by kind and status (IST days from / to), and the pending count',
  })
  summary(
    @Query() query: AdminRewardsSummaryQueryDto,
  ): Promise<AdminRewardsSummary> {
    return this.rewards.summary(query);
  }

  @Post('approve')
  @HttpCode(HttpStatus.OK)
  @Can('rewards.review')
  @ApiOperation({
    summary:
      'Approve up to 200 at once; only pending ones change — the rest come back in `skipped`',
  })
  approveMany(
    @Body() dto: BulkRewardsDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<BulkResult> {
    return this.rewards.approveMany(dto.ids, admin.email);
  }

  @Post('reject')
  @HttpCode(HttpStatus.OK)
  @Can('rewards.review')
  @ApiOperation({
    summary:
      'Reject up to 200 at once with one reason; only pending ones change',
  })
  rejectMany(
    @Body() dto: BulkRejectRewardsDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<BulkResult> {
    return this.rewards.rejectMany(dto.ids, dto.reason, admin.email);
  }

  @Get(':id')
  @Can('rewards.read')
  @ApiOperation({ summary: 'One reward' })
  get(@Param() { id }: RewardParamDto): Promise<AdminRewardView> {
    return this.rewards.get(id);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @Can('rewards.review')
  @ApiOperation({
    summary: 'Approve a pending reward — a gig’s ₹ is earned from now',
  })
  @ApiConflictResponse({
    description: '`REWARD_NOT_PENDING`: already approved or rejected',
  })
  approve(
    @Param() { id }: RewardParamDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminRewardView> {
    return this.rewards.approve(id, admin.email);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @Can('rewards.review')
  @ApiOperation({
    summary: 'Reject a pending reward; the partner sees the reason',
  })
  @ApiConflictResponse({
    description: '`REWARD_NOT_PENDING`: already approved or rejected',
  })
  reject(
    @Param() { id }: RewardParamDto,
    @Body() dto: RejectRewardDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminRewardView> {
    return this.rewards.reject(id, dto.reason, admin.email);
  }
}
