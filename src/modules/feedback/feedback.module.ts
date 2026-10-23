import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AccessModule } from '@modules/access/access.module';
import { AgentsModule } from '@modules/agents/agents.module';
import { CountersModule } from '@modules/counters/counters.module';
import { SettingsModule } from '@modules/settings/settings.module';

import { AdminFeedbackController } from './controllers/admin-feedback.controller';
import { AdminProductSuggestionsController } from './controllers/admin-product-suggestions.controller';
import { FeedbackController } from './controllers/feedback.controller';
import { FeedbackRepository } from './repositories/feedback.repository';
import { ProductSuggestionRepository } from './repositories/product-suggestion.repository';
import { Feedback, FeedbackSchema } from './schemas/feedback.schema';
import {
  ProductSuggestion,
  ProductSuggestionSchema,
} from './schemas/product-suggestion.schema';
import { AdminFeedbackService } from './services/admin-feedback.service';
import { FeedbackService } from './services/feedback.service';

@Module({
  imports: [
    AccessModule,
    AgentsModule,
    CountersModule,
    SettingsModule,
    MongooseModule.forFeature([
      { name: Feedback.name, schema: FeedbackSchema },
      { name: ProductSuggestion.name, schema: ProductSuggestionSchema },
    ]),
  ],
  controllers: [
    FeedbackController,
    AdminFeedbackController,
    AdminProductSuggestionsController,
  ],
  providers: [
    FeedbackRepository,
    ProductSuggestionRepository,
    FeedbackService,
    AdminFeedbackService,
  ],
  exports: [AdminFeedbackService],
})
export class FeedbackModule {}
