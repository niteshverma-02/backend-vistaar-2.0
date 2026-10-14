import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { CartModule } from '@modules/cart/cart.module';
import { CatalogModule } from '@modules/catalog/catalog.module';

import { DraftOrderController } from './controllers/draft-order.controller';
import { CustomerLookupRepository } from './repositories/customer-lookup.repository';
import { DraftOrderRepository } from './repositories/draft-order.repository';
import { DraftOrder, DraftOrderSchema } from './schemas/draft-order.schema';
import { DraftOrderService } from './services/draft-order.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DraftOrder.name, schema: DraftOrderSchema },
    ]),
    CartModule,
    CatalogModule,
  ],
  controllers: [DraftOrderController],
  providers: [
    DraftOrderRepository,
    CustomerLookupRepository,
    DraftOrderService,
  ],
  exports: [DraftOrderService],
})
export class DraftOrderModule {}
