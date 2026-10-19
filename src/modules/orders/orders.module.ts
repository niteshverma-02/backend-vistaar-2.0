import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AccessModule } from '@modules/access/access.module';
import { AgentsModule } from '@modules/agents/agents.module';
import { CommissionModule } from '@modules/commission/commission.module';
import { SpineModule } from '@modules/spine/spine.module';

import { AdminOrderController } from './controllers/admin-order.controller';
import { OrderController } from './controllers/order.controller';
import { OrderIdRepository } from './repositories/order-id.repository';
import { OrderRepository } from './repositories/order.repository';
import { ProductLookupRepository } from './repositories/product-lookup.repository';
import { OrderId, OrderIdSchema } from './schemas/order-id.schema';
import { Order, OrderSchema } from './schemas/order.schema';
import { AdminOrderService } from './services/admin-order.service';
import { OrderIdService } from './services/order-id.service';
import { OrderService } from './services/order.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Order.name, schema: OrderSchema },
      { name: OrderId.name, schema: OrderIdSchema },
    ]),
    AccessModule,
    AgentsModule,
    CommissionModule,
    SpineModule,
  ],
  controllers: [OrderController, AdminOrderController],
  providers: [
    OrderRepository,
    OrderIdRepository,
    ProductLookupRepository,
    OrderService,
    OrderIdService,
    AdminOrderService,
  ],
  exports: [OrderService, OrderIdService],
})
export class OrdersModule {}
