import { Module } from '@nestjs/common';

import { DraftOrderModule } from '@modules/draft-order/draft-order.module';
import { EventsModule } from '@modules/events/events.module';
import { GigsModule } from '@modules/gigs/gigs.module';
import { LeadsModule } from '@modules/leads/leads.module';
import { MeetingsModule } from '@modules/meetings/meetings.module';
import { OrdersModule } from '@modules/orders/orders.module';

import { TodayController } from './controllers/today.controller';
import { TodayService } from './services/today.service';

/** Home's "Today's tasks" (PRD H5) — read from the modules it is about. */
@Module({
  imports: [
    LeadsModule,
    DraftOrderModule,
    EventsModule,
    MeetingsModule,
    GigsModule,
    OrdersModule,
  ],
  controllers: [TodayController],
  providers: [TodayService],
})
export class TodayModule {}
