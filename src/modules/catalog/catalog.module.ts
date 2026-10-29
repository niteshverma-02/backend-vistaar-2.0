import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { RecentSearchController } from './controllers/recent-search.controller';
import { B2bCatalogClient } from './providers/b2b-catalog.client';
import { RecentSearchRepository } from './repositories/recent-search.repository';
import {
  RecentSearch,
  RecentSearchSchema,
} from './schemas/recent-search.schema';
import { CatalogService } from './services/catalog.service';
import { RecentSearchService } from './services/recent-search.service';

/** The B2B marketplace catalogue. The app lists products from B2B directly; this module only remembers recent search terms. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: RecentSearch.name, schema: RecentSearchSchema },
    ]),
  ],
  controllers: [RecentSearchController],
  providers: [
    B2bCatalogClient,
    CatalogService,
    RecentSearchRepository,
    RecentSearchService,
  ],
  exports: [CatalogService],
})
export class CatalogModule {}
