import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AccessModule } from '@modules/access/access.module';
import { AgentsModule } from '@modules/agents/agents.module';
import { LeadsModule } from '@modules/leads/leads.module';
import { SettingsModule } from '@modules/settings/settings.module';
import { UploadsModule } from '@modules/uploads/uploads.module';

import { AdminTestimonialSubmissionsController } from './controllers/admin-testimonial-submissions.controller';
import { AdminTestimonialsController } from './controllers/admin-testimonials.controller';
import { TestimonialsController } from './controllers/testimonials.controller';
import { ConsentRepository } from './repositories/consent.repository';
import { SubmissionRepository } from './repositories/submission.repository';
import { TestimonialRepository } from './repositories/testimonial.repository';
import {
  TestimonialConsent,
  TestimonialConsentSchema,
} from './schemas/testimonial-consent.schema';
import { SubmissionsService } from './services/submissions.service';
import { TestimonialsService } from './services/testimonials.service';

/**
 * Vistaar's testimonials. Partners send them from the app straight onto
 * Stockship's shared `product_reviews` (`source: 'vistaar'`, hidden until HO
 * approves), with the farmer's consent in `vistaar_v2_testimonial_consents`;
 * on approval a video or photo also gets its `product_testimonials` row,
 * where product pages show it.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TestimonialConsent.name, schema: TestimonialConsentSchema },
    ]),
    AccessModule,
    AgentsModule,
    LeadsModule,
    SettingsModule,
    UploadsModule,
  ],
  controllers: [
    TestimonialsController,
    AdminTestimonialsController,
    AdminTestimonialSubmissionsController,
  ],
  providers: [
    TestimonialRepository,
    SubmissionRepository,
    ConsentRepository,
    TestimonialsService,
    SubmissionsService,
  ],
  exports: [TestimonialsService],
})
export class TestimonialsModule {}
