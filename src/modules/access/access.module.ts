import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AdminMeController } from './controllers/admin-me.controller';
import { CapabilityGuard } from './guards/capability.guard';
import { OfflineCrmSettingsRepository } from './repositories/offline-crm-settings.repository';
import { StaffAccountRepository } from './repositories/staff-account.repository';
import {
  StaffAccount,
  StaffAccountSchema,
} from './schemas/staff-account.schema';
import { AccessService } from './services/access.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: StaffAccount.name, schema: StaffAccountSchema },
    ]),
  ],
  controllers: [AdminMeController],
  providers: [
    StaffAccountRepository,
    OfflineCrmSettingsRepository,
    AccessService,
    CapabilityGuard,
  ],
  exports: [AccessService, CapabilityGuard],
})
export class AccessModule {}
