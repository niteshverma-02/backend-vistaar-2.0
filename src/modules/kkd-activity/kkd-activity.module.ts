import { Module } from '@nestjs/common';

import { AgentsModule } from '@modules/agents/agents.module';
import { LeadsModule } from '@modules/leads/leads.module';
import { SpineModule } from '@modules/spine/spine.module';

import { KkdActivityController } from './controllers/kkd-activity.controller';
import { FarmerOrdersRepository } from './repositories/farmer-orders.repository';
import { KkdEventsRepository } from './repositories/kkd-events.repository';
import { StoreActivityRepository } from './repositories/store-activity.repository';
import { StoreDirectoryRepository } from './repositories/store-directory.repository';
import { KkdActivityService } from './services/kkd-activity.service';

/**
 * KKD & App activity (PRD C8): read-only over StockShip's `orders_v2`, the
 * franchise backend's walk-ins / prescriptions / POS archive, the Katyayani
 * app's `kkd_events` and the store list. Owns no collection.
 */
@Module({
  imports: [LeadsModule, AgentsModule, SpineModule],
  controllers: [KkdActivityController],
  providers: [
    KkdActivityService,
    FarmerOrdersRepository,
    StoreActivityRepository,
    KkdEventsRepository,
    StoreDirectoryRepository,
  ],
})
export class KkdActivityModule {}
