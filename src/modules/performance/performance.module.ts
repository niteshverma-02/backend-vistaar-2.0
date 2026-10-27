import { Module } from '@nestjs/common';

import { AccessModule } from '@modules/access/access.module';
import { AgentsModule } from '@modules/agents/agents.module';
import { AttendanceModule } from '@modules/attendance/attendance.module';
import { CommissionModule } from '@modules/commission/commission.module';
import { GigsModule } from '@modules/gigs/gigs.module';
import { LeadsModule } from '@modules/leads/leads.module';
import { MeetingsModule } from '@modules/meetings/meetings.module';
import { RewardsModule } from '@modules/rewards/rewards.module';
import { SpineModule } from '@modules/spine/spine.module';

import { AdminPerformanceController } from './controllers/admin-performance.controller';
import { PerformanceController } from './controllers/performance.controller';
import { PerformanceService } from './services/performance.service';

/** My Performance and the partner's standing — read-only, worked out on each ask. */
@Module({
  imports: [
    AccessModule,
    AgentsModule,
    AttendanceModule,
    CommissionModule,
    GigsModule,
    LeadsModule,
    MeetingsModule,
    RewardsModule,
    SpineModule,
  ],
  controllers: [PerformanceController, AdminPerformanceController],
  providers: [PerformanceService],
})
export class PerformanceModule {}
