import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AccessModule } from '@modules/access/access.module';
import { AgentsModule } from '@modules/agents/agents.module';
import { CatalogModule } from '@modules/catalog/catalog.module';
import { LeadsModule } from '@modules/leads/leads.module';

import { AdminCartController } from './controllers/admin-cart.controller';
import { CartController } from './controllers/cart.controller';
import { CartRepository } from './repositories/cart.repository';
import { Cart, CartSchema } from './schemas/cart.schema';
import { AdminCartService } from './services/admin-cart.service';
import { CartService } from './services/cart.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Cart.name, schema: CartSchema }]),
    AccessModule,
    AgentsModule,
    CatalogModule,
    LeadsModule,
  ],
  controllers: [CartController, AdminCartController],
  providers: [CartRepository, CartService, AdminCartService],
  exports: [CartService],
})
export class CartModule {}
