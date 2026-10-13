import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AccessModule } from '@modules/access/access.module';
import { AgentsModule } from '@modules/agents/agents.module';
import { OnboardingModule } from '@modules/onboarding/onboarding.module';
import { UploadsModule } from '@modules/uploads/uploads.module';

import { AdminBannersController } from './controllers/admin-banners.controller';
import { BannersController } from './controllers/banners.controller';
import { BannerRepository } from './repositories/banner.repository';
import { Banner, BannerSchema } from './schemas/banner.schema';
import { BannersService } from './services/banners.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Banner.name, schema: BannerSchema }]),
    AccessModule,
    AgentsModule,
    OnboardingModule,
    UploadsModule,
  ],
  controllers: [BannersController, AdminBannersController],
  providers: [BannerRepository, BannersService],
})
export class BannersModule {}
