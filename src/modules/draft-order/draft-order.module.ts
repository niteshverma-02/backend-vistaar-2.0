import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AccessModule } from '@modules/access/access.module';
import { AgentsModule } from '@modules/agents/agents.module';
import { CartModule } from '@modules/cart/cart.module';
import { CatalogModule } from '@modules/catalog/catalog.module';

import { AdminDraftOrderController } from './controllers/admin-draft-order.controller';
import { DraftOrderController } from './controllers/draft-order.controller';
import { CustomerLookupRepository } from './repositories/customer-lookup.repository';
import { DraftOrderRepository } from './repositories/draft-order.repository';
import { DraftOrder, DraftOrderSchema } from './schemas/draft-order.schema';
import { AdminDraftOrderService } from './services/admin-draft-order.service';
import { DraftOrderService } from './services/draft-order.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DraftOrder.name, schema: DraftOrderSchema },
    ]),
    AccessModule,
    AgentsModule,
    CartModule,
    CatalogModule,
  ],
  controllers: [DraftOrderController, AdminDraftOrderController],
  providers: [
    DraftOrderRepository,
    CustomerLookupRepository,
    DraftOrderService,
    AdminDraftOrderService,
  ],
  exports: [DraftOrderService],
})
export class DraftOrderModule {}
