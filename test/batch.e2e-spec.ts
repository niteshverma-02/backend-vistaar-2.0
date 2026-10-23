import {
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Injectable,
  UnauthorizedException,
  ValidationPipe,
  VersioningType,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';

import { validationExceptionFactory } from '@common/errors/validation.factory';
import { AllExceptionsFilter } from '@core/filters/all-exceptions.filter';
import { EnvelopeInterceptor } from '@core/interceptors/envelope.interceptor';
import { BatchModule } from '@modules/batch/batch.module';

/** Stands in for `AppAuthGuard`: the batch and each replay must carry the caller's token. */
@Injectable()
class TokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { headers } = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, unknown> }>();
    if (headers.authorization !== 'Bearer ok') {
      throw new UnauthorizedException('Please log in to continue.');
    }
    return true;
  }
}

@Controller('probe')
class ProbeController {
  @Get('echo')
  echo(@Headers('authorization') authorization: string): unknown {
    return { authorization };
  }

  @Get('forbidden')
  forbidden(): never {
    throw new ForbiddenException('Your role does not allow this action.');
  }
}

describe('POST /api/v2/batch (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [BatchModule],
      controllers: [ProbeController],
      providers: [
        { provide: APP_GUARD, useClass: TokenGuard },
        { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
      { logger: false },
    );
    // The same prefix, versioning and pipe as `main.ts`.
    app.setGlobalPrefix('api');
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
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(() => app.close());

  const batch = (payload: unknown, token = 'ok') =>
    app.inject({
      method: 'POST',
      url: '/api/v2/batch',
      headers: { authorization: `Bearer ${token}` },
      payload: payload as Record<string, unknown>,
    });

  it('answers every read in order, a refused one inside a 200', async () => {
    const res = await batch({
      requests: [
        { path: '/probe/forbidden' },
        { path: '/probe/echo?x=1' },
        { path: '/nope' },
      ],
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const { success, data } = res.json<{
      success: boolean;
      data: { responses: { status: number; body: unknown }[] };
    }>();
    expect(success).toBe(true);
    expect(data.responses.map((r) => r.status)).toEqual([403, 200, 404]);
    expect(data.responses[0].body).toMatchObject({
      success: false,
      error: { code: 'FORBIDDEN' },
    });
    // The item keeps its own envelope; the forwarded token reached the route.
    expect(data.responses[1].body).toEqual({
      success: true,
      data: { authorization: 'Bearer ok' },
    });
  });

  it('refuses a caller with no valid token before replaying anything', async () => {
    const res = await batch({ requests: [{ path: '/probe/echo' }] }, 'bad');
    expect(res.statusCode).toBe(401);
  });

  it.each([
    ['no requests', {}],
    ['empty', { requests: [] }],
    ['a nested batch', { requests: [{ path: '/batch' }] }],
    ['a full link', { requests: [{ path: 'https://x.example/a' }] }],
    ['an unknown field', { requests: [{ path: '/a', method: 'DELETE' }] }],
  ])('400 VALIDATION_FAILED for %s', async (_, payload) => {
    const res = await batch(payload);
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      'VALIDATION_FAILED',
    );
  });
});
