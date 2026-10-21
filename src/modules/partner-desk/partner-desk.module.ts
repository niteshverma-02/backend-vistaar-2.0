import { Module } from '@nestjs/common';

import { AccessModule } from '@modules/access/access.module';
import { AgentsModule } from '@modules/agents/agents.module';
import { EarningModule } from '@modules/earning/earning.module';
import { OnboardingModule } from '@modules/onboarding/onboarding.module';
import { RewardsModule } from '@modules/rewards/rewards.module';
import { SettingsModule } from '@modules/settings/settings.module';

import { AdminAgentsController } from './controllers/admin-agents.controller';
import { NetworkRepository } from './repositories/network.repository';
import { DeskService } from './services/desk.service';

/** HO portal's partner pipeline. Owns no collection; reads other apps' maps read-only. */
@Module({
  imports: [
    AccessModule,
    AgentsModule,
    EarningModule,
    OnboardingModule,
    RewardsModule,
    SettingsModule,
  ],
  controllers: [AdminAgentsController],
  providers: [DeskService, NetworkRepository],
})
export class PartnerDeskModule {}
