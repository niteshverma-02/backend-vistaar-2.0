import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AccessModule } from '@modules/access/access.module';
import { OnboardingModule } from '@modules/onboarding/onboarding.module';

import { AboutCompanyController } from './controllers/about-company.controller';
import { AboutProgramController } from './controllers/about-program.controller';
import { AdminAboutCompanyController } from './controllers/admin-about-company.controller';
import { AdminAboutProgramController } from './controllers/admin-about-program.controller';
import { AdminContactUsController } from './controllers/admin-contact-us.controller';
import { ContactUsController } from './controllers/contact-us.controller';
import { InfoPageRepository } from './repositories/info-page.repository';
import { InfoPage, InfoPageSchema } from './schemas/info-page.schema';
import { InfoPagesService } from './services/info-pages.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: InfoPage.name, schema: InfoPageSchema },
    ]),
    AccessModule,
    OnboardingModule,
  ],
  controllers: [
    AboutProgramController,
    AboutCompanyController,
    ContactUsController,
    AdminAboutProgramController,
    AdminAboutCompanyController,
    AdminContactUsController,
  ],
  providers: [InfoPageRepository, InfoPagesService],
  exports: [InfoPagesService],
})
export class InfoPagesModule {}
