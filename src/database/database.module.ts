import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';

import type { Env } from '@config/env.schema';

import { IndexSyncService } from './index-sync.service';

@Module({
  imports: [
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        uri: config.get('MONGODB_URI', { infer: true }),
        dbName: config.get('MONGODB_DB_NAME', { infer: true }),
        retryAttempts: 3,

        // Off even locally: Mongoose builds these in the background and
        // swallows the result, so a failed build is invisible. `IndexSyncService`
        // does the same job at bootstrap and logs what happened.
        autoIndex: false,

        // Fail a query fast rather than hanging a partner's request for
        // the driver's 30s default while the phone is on a weak connection.
        serverSelectionTimeoutMS: 5_000,

        // Set, not left to the driver's 100: with one process per core, the
        // sum over processes is what the Mongo server has to hold.
        maxPoolSize: config.get('MONGODB_MAX_POOL_SIZE', { infer: true }),
        minPoolSize: config.get('MONGODB_MIN_POOL_SIZE', { infer: true }),
      }),
    }),
  ],
  providers: [IndexSyncService],
})
export class DatabaseModule {}
