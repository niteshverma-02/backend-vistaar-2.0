import compress from '@fastify/compress';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { corsOptions } from '@core/http/cors-options';
import { allowEmptyJsonBody } from '@core/http/empty-json-body';
import { registerJsonEtag } from '@core/http/json-etag';
import {
  SWAGGER_CUSTOM_CSS,
  SWAGGER_DARK_MODE_JS,
} from '@core/swagger/swagger-theme';
import { validationExceptionFactory } from '@common/errors/validation.factory';
import { resolveCorsOrigin, type Env } from '@config/env.schema';

/** Below this a response goes out as is; gzip would cost more than it saves. */
const JSON_COMPRESS_THRESHOLD_BYTES = 1024;

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: true, bodyLimit: 2 * 1024 * 1024 }),
    { bufferLogs: true },
  );

  app.useLogger(app.get(Logger));
  app.flushLogs();

  const config = app.get(ConfigService<Env, true>);
  const nodeEnv = config.get('NODE_ENV', { infer: true });

  await app.register(helmet);

  // An unchanged GET comes back as an empty 304 (`json-etag.ts`) — the
  // onboarding config the app fetches on every launch is the main beneficiary.
  // The ETag hook is a root `onSend`, so it hashes the JSON before compress.
  registerJsonEtag(app.getHttpAdapter().getInstance());
  await app.register(compress, { threshold: JSON_COMPRESS_THRESHOLD_BYTES });
  // KYC photos and PDFs — one file per request, 10 MB, enforced again per route.
  await app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 5 },
  });

  // Empty CORS_ORIGINS means no browser origin is allowed, `*` means any. The
  // mobile app is unaffected either way — native clients send no Origin header.
  const corsOrigin = resolveCorsOrigin(
    config.get('CORS_ORIGINS', { infer: true }),
  );
  app.enableCors(corsOptions(corsOrigin));

  if (corsOrigin === true && nodeEnv === 'production') {
    app
      .get(Logger)
      .warn('CORS_ORIGINS is `*` — every browser origin may call this API.');
  }

  app.setGlobalPrefix('api');
  // One version, everywhere: `/api/v2/*`, matching the `vistaar_v2_*`
  // collections. A controller that names no version gets this one.
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '2' });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      exceptionFactory: validationExceptionFactory,
    }),
  );

  if (config.get('SWAGGER_ENABLED', { infer: true })) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Vistaar API')
        .setDescription(
          'Backend for the Vistaar 2.0 app and its HO portal screens.',
        )
        .setVersion('2.0')
        .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
        .addApiKey(
          { type: 'apiKey', in: 'header', name: 'x-b2b-token' },
          'b2b-token',
        )
        .build(),
    );
    SwaggerModule.setup('docs', app, document, {
      customSiteTitle: 'Vistaar API — docs',
      customCss: SWAGGER_CUSTOM_CSS,
      customJsStr: SWAGGER_DARK_MODE_JS,
      swaggerOptions: {
        persistAuthorization: true,
        docExpansion: 'list',
        defaultModelsExpandDepth: 1,
        tagsSorter: 'alpha',
        operationsSorter: 'alpha',
        tryItOutEnabled: true,
      },
    });
  }

  app.enableShutdownHooks();

  // `init()` is where the adapter registers its body parsers; calling it here
  // is what lets `allowEmptyJsonBody` replace the JSON one before `listen()`.
  await app.init();
  allowEmptyJsonBody(app.getHttpAdapter().getInstance());

  const port = config.get('PORT', { infer: true });
  const host = config.get('HOST', { infer: true });
  await app.listen(port, host);

  app.get(Logger).log(`Vistaar API listening on ${host}:${port} [${nodeEnv}]`);
}

void bootstrap();
