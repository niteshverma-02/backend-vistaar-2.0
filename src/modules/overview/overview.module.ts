import { Module } from '@nestjs/common';

import { AccessModule } from '@modules/access/access.module';
import { AgentsModule } from '@modules/agents/agents.module';
import { AttendanceModule } from '@modules/attendance/attendance.module';
import { CommissionModule } from '@modules/commission/commission.module';
import { FeedbackModule } from '@modules/feedback/feedback.module';
import { GigsModule } from '@modules/gigs/gigs.module';
import { LeadsModule } from '@modules/leads/leads.module';
import { OrdersModule } from '@modules/orders/orders.module';
import { RewardsModule } from '@modules/rewards/rewards.module';

import { AdminOverviewController } from './controllers/admin-overview.controller';
import { OverviewQueryService } from './services/overview.query-service';

/** HO Home's Vistaar cards (`GET /admin/overview`) — read from the modules they are about; owns no collection. */
@Module({
  imports: [
    AccessModule,
    AgentsModule,
    AttendanceModule,
    CommissionModule,
    FeedbackModule,
    GigsModule,
    LeadsModule,
    OrdersModule,
    RewardsModule,
  ],
  controllers: [AdminOverviewController],
  providers: [OverviewQueryService],
})
export class OverviewModule {}
