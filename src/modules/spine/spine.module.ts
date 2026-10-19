import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AddressRepository } from './repositories/address.repository';
import { OrgCounterRepository } from './repositories/org-counter.repository';
import { PiiRepository } from './repositories/pii.repository';
import { PincodeRepository } from './repositories/pincode.repository';
import { ProductFactsRepository } from './repositories/product-facts.repository';
import { Address, AddressSchema } from './schemas/address.schema';
import { AppCounter, AppCounterSchema } from './schemas/app-counter.schema';
import { Pii, PiiSchema } from './schemas/pii.schema';
import { Pincode, PincodeSchema } from './schemas/pincode.schema';
import { PiiService } from './services/pii.service';
import { PincodeService } from './services/pincode.service';
import { ProductFactsService } from './services/product-facts.service';

/**
 * The org's shared records Vistaar touches: `piis` (find, or insert a new
 * person; KYC documents), `addresses` (rows Vistaar filed), `app_counters`
 * (`piis`, `addresses`, `leads`, `contacts`, `vistaar_orders`), and `pincode_map_v2` and the
 * catalogue's `products_v2` / `bulk_v2` / `categories_v2` (read).
 * Nothing else in this service may hold a model for them.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Pii.name, schema: PiiSchema },
      { name: AppCounter.name, schema: AppCounterSchema },
      { name: Pincode.name, schema: PincodeSchema },
      { name: Address.name, schema: AddressSchema },
    ]),
  ],
  providers: [
    PiiRepository,
    AddressRepository,
    OrgCounterRepository,
    PincodeRepository,
    ProductFactsRepository,
    PiiService,
    PincodeService,
    ProductFactsService,
  ],
  exports: [PiiService, PincodeService, ProductFactsService],
})
export class SpineModule {}
