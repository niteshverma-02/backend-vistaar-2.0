import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AccessModule } from '@modules/access/access.module';
import { AgentsModule } from '@modules/agents/agents.module';
import { CountersModule } from '@modules/counters/counters.module';
import { OnboardingModule } from '@modules/onboarding/onboarding.module';
import { SettingsModule } from '@modules/settings/settings.module';
import { SpineModule } from '@modules/spine/spine.module';
import { UploadsModule } from '@modules/uploads/uploads.module';

import { AdminCommissionPlansController } from './controllers/admin-commission-plans.controller';
import { AdminPayoutsController } from './controllers/admin-payouts.controller';
import { CommissionController } from './controllers/commission.controller';
import { WalletController } from './controllers/wallet.controller';
import { CommissionOrderRepository } from './repositories/commission-order.repository';
import { CommissionPlanRepository } from './repositories/commission-plan.repository';
import { TdsCertificateRepository } from './repositories/tds-certificate.repository';
import { WithdrawalRepository } from './repositories/withdrawal.repository';
import {
  CommissionPlan,
  CommissionPlanSchema,
} from './schemas/commission-plan.schema';
import {
  TdsCertificate,
  TdsCertificateSchema,
} from './schemas/tds-certificate.schema';
import { Withdrawal, WithdrawalSchema } from './schemas/withdrawal.schema';
import { CommissionPlansService } from './services/commission-plans.service';
import { CommissionService } from './services/commission.service';
import { WalletService } from './services/wallet.service';

/**
 * Commission (worked out from `orders_v2`, never stored per order), the
 * plans it is worked out on, and the wallet partners are paid from. Reads
 * `orders_v2` itself rather than through the orders module, which shows each
 * order's commission and so depends on this one.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CommissionPlan.name, schema: CommissionPlanSchema },
      { name: Withdrawal.name, schema: WithdrawalSchema },
      { name: TdsCertificate.name, schema: TdsCertificateSchema },
    ]),
    AccessModule,
    AgentsModule,
    CountersModule,
    OnboardingModule,
    SettingsModule,
    SpineModule,
    UploadsModule,
  ],
  controllers: [
    CommissionController,
    WalletController,
    AdminCommissionPlansController,
    AdminPayoutsController,
  ],
  providers: [
    CommissionOrderRepository,
    CommissionPlanRepository,
    WithdrawalRepository,
    TdsCertificateRepository,
    CommissionPlansService,
    CommissionService,
    WalletService,
  ],
  exports: [CommissionService],
})
export class CommissionModule {}
