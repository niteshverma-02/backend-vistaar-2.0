import { Module } from '@nestjs/common';

import { AccessModule } from '@modules/access/access.module';

import { AdminTestimonialsController } from './controllers/admin-testimonials.controller';
import { TestimonialRepository } from './repositories/testimonial.repository';
import { TestimonialsService } from './services/testimonials.service';

@Module({
  imports: [AccessModule],
  controllers: [AdminTestimonialsController],
  providers: [TestimonialRepository, TestimonialsService],
  exports: [TestimonialsService],
})
export class TestimonialsModule {}
