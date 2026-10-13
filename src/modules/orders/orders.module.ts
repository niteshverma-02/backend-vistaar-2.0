import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AccessModule } from '@modules/access/access.module';
import { AgentsModule } from '@modules/agents/agents.module';

import { AdminOrderController } from './controllers/admin-order.controller';
import { OrderController } from './controllers/order.controller';
import { OrderRepository } from './repositories/order.repository';
import { ProductLookupRepository } from './repositories/product-lookup.repository';
import { Order, OrderSchema } from './schemas/order.schema';
import { AdminOrderService } from './services/admin-order.service';
import { OrderService } from './services/order.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Order.name, schema: OrderSchema }]),
    AccessModule,
    AgentsModule,
  ],
  controllers: [OrderController, AdminOrderController],
  providers: [
    OrderRepository,
    ProductLookupRepository,
    OrderService,
    AdminOrderService,
  ],
})
export class OrdersModule {}
