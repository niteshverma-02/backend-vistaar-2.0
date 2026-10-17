import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AccessModule } from '@modules/access/access.module';
import { AgentsModule } from '@modules/agents/agents.module';
import { LeadsModule } from '@modules/leads/leads.module';
import { RewardsModule } from '@modules/rewards/rewards.module';

import { AdminMeetingsController } from './controllers/admin-meetings.controller';
import { MeetingsController } from './controllers/meetings.controller';
import { MeetingRepository } from './repositories/meeting.repository';
import { Meeting, MeetingSchema } from './schemas/meeting.schema';
import { MeetingNotifier } from './services/meeting-notifier.service';
import { MeetingsService } from './services/meetings.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Meeting.name, schema: MeetingSchema }]),
    AccessModule,
    AgentsModule,
    LeadsModule,
    RewardsModule,
  ],
  controllers: [MeetingsController, AdminMeetingsController],
  providers: [MeetingRepository, MeetingsService, MeetingNotifier],
  exports: [MeetingsService],
})
export class MeetingsModule {}
