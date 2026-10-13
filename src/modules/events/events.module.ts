import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AccessModule } from '@modules/access/access.module';
import { AgentsModule } from '@modules/agents/agents.module';
import { OnboardingModule } from '@modules/onboarding/onboarding.module';

import { AdminEventsController } from './controllers/admin-events.controller';
import { EventsController } from './controllers/events.controller';
import { EventRegistrationRepository } from './repositories/event-registration.repository';
import { EventRepository } from './repositories/event.repository';
import {
  EventRegistration,
  EventRegistrationSchema,
} from './schemas/event-registration.schema';
import { FarmerEvent, FarmerEventSchema } from './schemas/event.schema';
import { AdminEventsService } from './services/admin-events.service';
import { EventsService } from './services/events.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FarmerEvent.name, schema: FarmerEventSchema },
      { name: EventRegistration.name, schema: EventRegistrationSchema },
    ]),
    AccessModule,
    AgentsModule,
    OnboardingModule,
  ],
  controllers: [EventsController, AdminEventsController],
  providers: [
    EventRepository,
    EventRegistrationRepository,
    EventsService,
    AdminEventsService,
  ],
  exports: [EventsService],
})
export class EventsModule {}
