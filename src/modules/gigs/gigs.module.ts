import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AccessModule } from '@modules/access/access.module';
import { AgentsModule } from '@modules/agents/agents.module';
import { CountersModule } from '@modules/counters/counters.module';
import { SettingsModule } from '@modules/settings/settings.module';
import { UploadsModule } from '@modules/uploads/uploads.module';

import { AdminGigsController } from './controllers/admin-gigs.controller';
import { GigsController } from './controllers/gigs.controller';
import { GigRepository } from './repositories/gig.repository';
import { Gig, GigSchema } from './schemas/gig.schema';
import { AdminGigsService } from './services/admin-gigs.service';
import { GigReadsService } from './services/gig-reads.service';
import { GigsService } from './services/gigs.service';

/**
 * A leaf: it imports no leads, orders or commission module, so commission,
 * Today and My Story can import it (through `GigReadsService`) without a cycle.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Gig.name, schema: GigSchema }]),
    AccessModule,
    AgentsModule,
    CountersModule,
    SettingsModule,
    UploadsModule,
  ],
  controllers: [GigsController, AdminGigsController],
  providers: [GigRepository, GigsService, AdminGigsService, GigReadsService],
  exports: [GigReadsService],
})
export class GigsModule {}
