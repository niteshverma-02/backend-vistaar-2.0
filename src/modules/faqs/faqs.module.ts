import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AccessModule } from '@modules/access/access.module';

import { AdminFaqSectionsController } from './controllers/admin-faq-sections.controller';
import { AdminFaqsController } from './controllers/admin-faqs.controller';
import { FaqsController } from './controllers/faqs.controller';
import { FaqSectionRepository } from './repositories/faq-section.repository';
import { FaqRepository } from './repositories/faq.repository';
import { FaqSection, FaqSectionSchema } from './schemas/faq-section.schema';
import { Faq, FaqSchema } from './schemas/faq.schema';
import { FaqSectionsService } from './services/faq-sections.service';
import { FaqsService } from './services/faqs.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Faq.name, schema: FaqSchema },
      { name: FaqSection.name, schema: FaqSectionSchema },
    ]),
    AccessModule,
  ],
  controllers: [
    FaqsController,
    AdminFaqsController,
    AdminFaqSectionsController,
  ],
  providers: [
    FaqRepository,
    FaqSectionRepository,
    FaqsService,
    FaqSectionsService,
  ],
  exports: [FaqsService],
})
export class FaqsModule {}
