import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';

import { AppAuthGuard } from '@core/auth/app-auth.guard';
import { AuthCoreModule } from '@core/auth/auth-core.module';
import { AllExceptionsFilter } from '@core/filters/all-exceptions.filter';
import { EnvelopeInterceptor } from '@core/interceptors/envelope.interceptor';
import { THROTTLE_OPTIONS } from '@core/throttle/throttle.config';
import { validateEnv, type Env } from '@config/env.schema';
import { DatabaseModule } from '@database/database.module';
import { AccessModule } from '@modules/access/access.module';
import { AgentsModule } from '@modules/agents/agents.module';
import { AuthModule } from '@modules/auth/auth.module';
import { CartModule } from '@modules/cart/cart.module';
import { DraftOrderModule } from '@modules/draft-order/draft-order.module';
import { HealthModule } from '@modules/health/health.module';
import { LeadsModule } from '@modules/leads/leads.module';
import { OnboardingModule } from '@modules/onboarding/onboarding.module';
import { PartnerDeskModule } from '@modules/partner-desk/partner-desk.module';
import { SettingsModule } from '@modules/settings/settings.module';
import { UploadsModule } from '@modules/uploads/uploads.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),

    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL', { infer: true }),
          transport:
            config.get('NODE_ENV', { infer: true }) === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
          // Tokens and OTPs never reach a log line.
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers["x-b2b-token"]',
              'req.headers.cookie',
              'req.body.otp',
              'req.body.refresh_token',
              'req.body.data',
            ],
            remove: true,
          },
        },
      }),
    }),

    ThrottlerModule.forRoot(THROTTLE_OPTIONS),

    DatabaseModule,
    AuthCoreModule,

    // ── Feature modules ──────────────────────────────────────────────
    // One folder per module under src/modules/, each with the four layers:
    //   controller → service → repository → schema
    AccessModule,
    SettingsModule,
    AgentsModule,
    AuthModule,
    UploadsModule,
    OnboardingModule,
    // HO portal's pipeline screens, composed from the modules above.
    PartnerDeskModule,
    HealthModule,
    CartModule,
    DraftOrderModule,
    LeadsModule,
  ],
  providers: [
    // Auth is global and opted out of with @Public(). Ahead of the throttler,
    // and the order is load-bearing: the throttler keys on the verified
    // `request.user`, which only exists once this guard has run.
    { provide: APP_GUARD, useExisting: AppAuthGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
