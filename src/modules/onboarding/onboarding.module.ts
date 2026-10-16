import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AccessModule } from '@modules/access/access.module';
import { AgentsModule } from '@modules/agents/agents.module';
import { SpineModule } from '@modules/spine/spine.module';
import { UploadsModule } from '@modules/uploads/uploads.module';

import { AdminBankChangeController } from './controllers/admin-bank-change.controller';
import { AdminCohortsController } from './controllers/admin-cohorts.controller';
import { AdminConfigsController } from './controllers/admin-configs.controller';
import { BankChangeController } from './controllers/bank-change.controller';
import { MeController } from './controllers/me.controller';
import { OnboardingController } from './controllers/onboarding.controller';
import { CohortRepository } from './repositories/cohort.repository';
import { ConfigRepository } from './repositories/config.repository';
import { OnboardingRepository } from './repositories/onboarding.repository';
import { Cohort, CohortSchema } from './schemas/cohort.schema';
import {
  OnboardingConfig,
  OnboardingConfigSchema,
} from './schemas/onboarding-config.schema';
import {
  OnboardingData,
  OnboardingDataSchema,
} from './schemas/onboarding-data.schema';
import { BankChangeService } from './services/bank-change.service';
import { CohortsService } from './services/cohorts.service';
import { ConfigsService } from './services/configs.service';
import { MeService } from './services/me.service';
import { OnboardingService } from './services/onboarding.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Cohort.name, schema: CohortSchema },
      { name: OnboardingConfig.name, schema: OnboardingConfigSchema },
      { name: OnboardingData.name, schema: OnboardingDataSchema },
    ]),
    AccessModule,
    AgentsModule,
    SpineModule,
    UploadsModule,
  ],
  controllers: [
    OnboardingController,
    MeController,
    AdminCohortsController,
    AdminConfigsController,
    BankChangeController,
    AdminBankChangeController,
  ],
  providers: [
    CohortRepository,
    ConfigRepository,
    OnboardingRepository,
    CohortsService,
    ConfigsService,
    OnboardingService,
    MeService,
    BankChangeService,
  ],
  exports: [OnboardingService, CohortsService],
})
export class OnboardingModule {}
