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
import { ReviewRepository } from './repositories/review.repository';
import { SubmissionRepository } from './repositories/submission.repository';
import { TestimonialRepository } from './repositories/testimonial.repository';
import {
  TestimonialConsent,
  TestimonialConsentSchema,
} from './schemas/testimonial-consent.schema';
import {
  TestimonialSubmission,
  TestimonialSubmissionSchema,
} from './schemas/testimonial-submission.schema';
import { SubmissionsService } from './services/submissions.service';
import { TestimonialsService } from './services/testimonials.service';

/**
 * Vistaar's testimonials. Partners send them from the app
 * (`vistaar_v2_testimonials` + `vistaar_v2_testimonial_consents`); on HO's
 * approval they are written to Stockship's shared `product_reviews` and
 * `product_testimonials` as `source: 'vistaar'`, where product pages show them.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TestimonialSubmission.name, schema: TestimonialSubmissionSchema },
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
    ReviewRepository,
    SubmissionRepository,
    ConsentRepository,
    TestimonialsService,
    SubmissionsService,
  ],
  exports: [TestimonialsService],
})
export class TestimonialsModule {}
