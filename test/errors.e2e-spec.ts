import multipart from '@fastify/multipart';
import { Body, Controller, Get, HttpStatus, Post, Req } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { FastifyRequest } from 'fastify';

import { apiError } from '@common/errors/api-error';
import { AllExceptionsFilter } from '@core/filters/all-exceptions.filter';
import { allowEmptyJsonBody } from '@core/http/empty-json-body';

/**
 * Errors thrown outside `apiError()` — Fastify's parsers, multipart, Nest's
 * router, a plain `Error` — must still leave as the v2 envelope with a code
 * from the closed set, never as a bare 500.
 */
@Controller('probe')
class ProbeController {
  @Post('json')
  json(@Body() body: unknown): unknown {
    return body;
  }

  /** The route pattern: `truncated` checked, so the message names the limit. */
  @Post('file')
  async file(@Req() req: FastifyRequest): Promise<{ size: number }> {
    const file = await req.file({
      limits: { fileSize: 10, files: 1 },
      throwFileSizeLimit: false,
    });
    const buffer = await file!.toBuffer();
    if (file!.file.truncated) {
      throw apiError(
        HttpStatus.PAYLOAD_TOO_LARGE,
        'FILE_TOO_LARGE',
        'The file is larger than 10 bytes.',
      );
    }
    return { size: buffer.length };
  }

  /** A route that forgot `throwFileSizeLimit: false` — the filter's net. */
  @Post('file-throws')
  async fileThrows(@Req() req: FastifyRequest): Promise<{ size: number }> {
    const file = await req.file({ limits: { fileSize: 10, files: 1 } });
    return { size: (await file!.toBuffer()).length };
  }

  @Get('boom')
  boom(): never {
    throw new Error('driver said: secret detail');
  }
}

const BOUNDARY = 'X';
const multipartBody = (size: number): string =>
  `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\n` +
  `Content-Type: image/png\r\n\r\n${'x'.repeat(size)}\r\n--${BOUNDARY}--\r\n`;

describe('error envelope (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
      providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ bodyLimit: 1024 }),
      { logger: false },
    );
    await app.register(multipart, { limits: { files: 1 } });
    await app.init();
    allowEmptyJsonBody(app.getHttpAdapter().getInstance());
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(() => app.close());

  async function errorOf(
    opts: Parameters<NestFastifyApplication['inject']>[0],
  ): Promise<{ status: number; error: Record<string, unknown> }> {
    const res = await app.inject(opts);
    const body = res.json<{
      success: boolean;
      error: Record<string, unknown>;
    }>();
    expect(body.success).toBe(false);
    return { status: res.statusCode, error: body.error };
  }

  const json = { 'content-type': 'application/json' };
  const form = { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` };

  it('malformed JSON is a 400 VALIDATION_FAILED', async () => {
    const { status, error } = await errorOf({
      method: 'POST',
      url: '/probe/json',
      headers: json,
      payload: '{bad',
    });
    expect(status).toBe(400);
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.message).toBe(
      'Your request could not be read. Please try again.',
    );
  });

  it('a body over the limit is a 413 PAYLOAD_TOO_LARGE', async () => {
    const { status, error } = await errorOf({
      method: 'POST',
      url: '/probe/json',
      headers: json,
      payload: JSON.stringify({ a: 'x'.repeat(2000) }),
    });
    expect(status).toBe(413);
    expect(error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('an unknown route is a 404 NOT_FOUND without noise in details', async () => {
    const { status, error } = await errorOf({ method: 'GET', url: '/nope' });
    expect(status).toBe(404);
    expect(error.code).toBe('NOT_FOUND');
    expect(error.details).toBeUndefined();
    expect(error.message).toBe(
      'This page or action is not available. Please update the app.',
    );
  });

  it('an unexpected error is a generic 500 that leaks nothing', async () => {
    const { status, error } = await errorOf({
      method: 'GET',
      url: '/probe/boom',
    });
    expect(status).toBe(500);
    expect(error).toEqual({
      code: 'INTERNAL_ERROR',
      message:
        'Something went wrong on our side. Please try again in a little while.',
    });
  });

  it('a file over the route limit names the limit (413 FILE_TOO_LARGE)', async () => {
    const { status, error } = await errorOf({
      method: 'POST',
      url: '/probe/file',
      headers: form,
      payload: multipartBody(100),
    });
    expect(status).toBe(413);
    expect(error).toEqual({
      code: 'FILE_TOO_LARGE',
      message: 'The file is larger than 10 bytes.',
    });
  });

  it('a file within the limit goes through', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/probe/file',
      headers: form,
      payload: multipartBody(5),
    });
    expect(res.statusCode).toBe(201);
  });

  it("multipart's own file-size error is a 413, not a 500", async () => {
    const { status, error } = await errorOf({
      method: 'POST',
      url: '/probe/file-throws',
      headers: form,
      payload: multipartBody(100),
    });
    expect(status).toBe(413);
    expect(error).toEqual({
      code: 'FILE_TOO_LARGE',
      message: 'The file is too large.',
    });
  });
});
