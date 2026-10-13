import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AccessModule } from '@modules/access/access.module';
import { UploadsModule } from '@modules/uploads/uploads.module';

import { AdminTermsController } from './controllers/admin-terms.controller';
import { TermsController } from './controllers/terms.controller';
import { TermsRepository } from './repositories/terms.repository';
import { TermsAndConditions, TermsSchema } from './schemas/terms.schema';
import { TermsService } from './services/terms.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TermsAndConditions.name, schema: TermsSchema },
    ]),
    AccessModule,
    UploadsModule,
  ],
  controllers: [TermsController, AdminTermsController],
  providers: [TermsRepository, TermsService],
  exports: [TermsService],
})
export class TermsModule {}
