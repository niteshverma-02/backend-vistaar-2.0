import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AccessModule } from '@modules/access/access.module';

import { AdminCropCalendarController } from './controllers/admin-crop-calendar.controller';
import { CropCalendarController } from './controllers/crop-calendar.controller';
import { CropCalendarRepository } from './repositories/crop-calendar.repository';
import {
  CropCalendarEntry,
  CropCalendarSchema,
} from './schemas/crop-calendar.schema';
import { CropCalendarService } from './services/crop-calendar.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CropCalendarEntry.name, schema: CropCalendarSchema },
    ]),
    AccessModule,
  ],
  controllers: [CropCalendarController, AdminCropCalendarController],
  providers: [CropCalendarRepository, CropCalendarService],
  exports: [CropCalendarService],
})
export class CropCalendarModule {}
