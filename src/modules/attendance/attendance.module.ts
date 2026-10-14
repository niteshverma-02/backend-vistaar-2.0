import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AccessModule } from '@modules/access/access.module';
import { AgentsModule } from '@modules/agents/agents.module';

import { AdminAttendanceController } from './controllers/admin-attendance.controller';
import { AttendanceController } from './controllers/attendance.controller';
import { AttendanceRepository } from './repositories/attendance.repository';
import {
  AttendanceDay,
  AttendanceDaySchema,
} from './schemas/attendance-day.schema';
import { AdminAttendanceService } from './services/admin-attendance.service';
import { AttendanceService } from './services/attendance.service';

@Module({
  imports: [
    AccessModule,
    AgentsModule,
    MongooseModule.forFeature([
      { name: AttendanceDay.name, schema: AttendanceDaySchema },
    ]),
  ],
  controllers: [AttendanceController, AdminAttendanceController],
  providers: [AttendanceRepository, AttendanceService, AdminAttendanceService],
  exports: [AttendanceService],
})
export class AttendanceModule {}
