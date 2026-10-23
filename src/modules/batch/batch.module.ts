import { Module } from '@nestjs/common';

import { BatchController } from './controllers/batch.controller';
import { BatchService } from './services/batch.service';

/** `POST /batch` — replays the portal's GETs in-process; owns no collection. */
@Module({
  controllers: [BatchController],
  providers: [BatchService],
})
export class BatchModule {}
