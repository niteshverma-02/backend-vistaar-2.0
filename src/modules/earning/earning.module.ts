import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AccessModule } from '@modules/access/access.module';
import { AgentsModule } from '@modules/agents/agents.module';

import {
  AdminEarningCohortsController,
  AdminPartnerEarningController,
} from './controllers/admin-earning-cohorts.controller';
import { AdminEarningRulesController } from './controllers/admin-earning-rules.controller';
import { EarningAssignmentRepository } from './repositories/earning-assignment.repository';
import { EarningCohortRepository } from './repositories/earning-cohort.repository';
import { EarningRuleRepository } from './repositories/earning-rule.repository';
import {
  EarningAssignment,
  EarningAssignmentSchema,
} from './schemas/earning-assignment.schema';
import {
  EarningCohort,
  EarningCohortSchema,
} from './schemas/earning-cohort.schema';
import { EarningRule, EarningRuleSchema } from './schemas/earning-rule.schema';
import { EarningCohortsService } from './services/earning-cohorts.service';
import { EarningRulesService } from './services/earning-rules.service';

/**
 * Earning cohorts and their coin / gig rules. A leaf on purpose — it imports
 * no leads, orders, commission or gigs module — so all of those can import
 * it. Lead holdings come in through `EarningCohortsService.useHoldings`.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: EarningCohort.name, schema: EarningCohortSchema },
      { name: EarningRule.name, schema: EarningRuleSchema },
      { name: EarningAssignment.name, schema: EarningAssignmentSchema },
    ]),
    AccessModule,
    AgentsModule,
  ],
  controllers: [
    AdminEarningCohortsController,
    AdminPartnerEarningController,
    AdminEarningRulesController,
  ],
  providers: [
    EarningCohortRepository,
    EarningRuleRepository,
    EarningAssignmentRepository,
    EarningCohortsService,
    EarningRulesService,
  ],
  exports: [EarningCohortsService, EarningRulesService],
})
export class EarningModule {}
