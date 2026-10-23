import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AccessModule } from '@modules/access/access.module';
import { AgentsModule } from '@modules/agents/agents.module';
import { EarningModule } from '@modules/earning/earning.module';
import { SettingsModule } from '@modules/settings/settings.module';

import { AdminRewardsController } from './controllers/admin-rewards.controller';
import { RewardsController } from './controllers/rewards.controller';
import { CoinAccountRepository } from './repositories/coin-account.repository';
import { RewardRepository } from './repositories/reward.repository';
import { CoinAccount, CoinAccountSchema } from './schemas/coin-account.schema';
import { Reward, RewardSchema } from './schemas/reward.schema';
import { RewardsService } from './services/rewards.service';

/**
 * Coin and gig rewards from the earning rules, and HO's approval of them.
 * A leaf like EarningModule — no leads, orders, commission or gigs import —
 * so leads (which fires the events) and commission (which pays approved
 * gigs into the wallet) can both import it.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Reward.name, schema: RewardSchema },
      { name: CoinAccount.name, schema: CoinAccountSchema },
    ]),
    AccessModule,
    AgentsModule,
    EarningModule,
    SettingsModule,
  ],
  controllers: [RewardsController, AdminRewardsController],
  providers: [RewardRepository, CoinAccountRepository, RewardsService],
  exports: [RewardsService],
})
export class RewardsModule {}
