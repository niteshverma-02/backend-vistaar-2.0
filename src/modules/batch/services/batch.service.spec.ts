import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { InjectOptions } from 'fastify';

import { BatchDto } from '../dto/batch.dto';
import { replay } from './batch.service';

const caller = {
  headers: {
    authorization: 'Bearer t',
    'accept-language': 'hi',
    'user-agent': 'portal',
    cookie: 'secret',
    'if-none-match': '"x"',
    'x-forwarded-for': '6.6.6.6',
  },
  ip: '203.0.113.9',
};

describe('replay', () => {
  it('replays each path as a GET under /api/v2, in request order', async () => {
    const seen: InjectOptions[] = [];
    // The slower first read must still come back first.
    const inject = (options: InjectOptions) => {
      seen.push(options);
      const slow = options.url === '/api/v2/a';
      return new Promise<{ statusCode: number; body: string }>((resolve) =>
        setTimeout(
          () =>
            resolve({
              statusCode: slow ? 200 : 403,
              body: JSON.stringify({ url: options.url }),
            }),
          slow ? 20 : 1,
        ),
      );
    };

    const result = await replay(inject, caller, ['/a', '/b?x=1']);

    expect(result.responses).toEqual([
      { status: 200, body: { url: '/api/v2/a' } },
      { status: 403, body: { url: '/api/v2/b?x=1' } },
    ]);
    expect(seen[0]).toMatchObject({ method: 'GET', remoteAddress: caller.ip });
  });

  it('forwards only who is asking, nothing that changes the answer', async () => {
    let headers: unknown;
    await replay(
      (options) => {
        headers = options.headers;
        return Promise.resolve({ statusCode: 200, body: '' });
      },
      caller,
      ['/a'],
    );
    expect(headers).toEqual({
      authorization: 'Bearer t',
      'accept-language': 'hi',
      'user-agent': 'portal',
    });
  });

  it('gives an empty or non-JSON body as null', async () => {
    const bodies = ['', 'not json'];
    const result = await replay(
      () => Promise.resolve({ statusCode: 200, body: bodies.shift()! }),
      caller,
      ['/a', '/b'],
    );
    expect(result.responses.map((r) => r.body)).toEqual([null, null]);
  });

  it('turns a read past the timeout into its own 504, the rest still answer', async () => {
    const result = await replay(
      (options) =>
        options.url === '/api/v2/slow'
          ? new Promise(() => undefined)
          : Promise.resolve({ statusCode: 200, body: '{"ok":1}' }),
      caller,
      ['/slow', '/fast'],
      10,
    );
    expect(result.responses).toEqual([
      {
        status: 504,
        body: {
          success: false,
          error: { code: 'BATCH_TIMEOUT', message: 'This read took too long.' },
        },
      },
      { status: 200, body: { ok: 1 } },
    ]);
  });
});

describe('BatchDto', () => {
  const errorsOf = (requests: unknown) =>
    validate(plainToInstance(BatchDto, { requests }));

  it('takes 1–25 plain read paths', async () => {
    expect(
      await errorsOf([
        { path: '/admin/orders/summary?from=2026-10-01&to=2026-10-23' },
        { path: '/admin/batches' },
      ]),
    ).toEqual([]);
    expect(
      await errorsOf(Array.from({ length: 25 }, () => ({ path: '/a' }))),
    ).toEqual([]);
  });

  it.each([
    ['missing', undefined],
    ['not an array', { path: '/a' }],
    ['empty', []],
    ['over 25', Array.from({ length: 26 }, () => ({ path: '/a' }))],
  ])('refuses requests %s', async (_, requests) => {
    expect(await errorsOf(requests)).not.toEqual([]);
  });

  it.each([
    'admin/orders',
    'https://evil.example/x',
    '/a?next=http://x',
    '/admin/../health',
    '/admin\\x',
    '/admin#x',
    `/${'a'.repeat(2048)}`,
    '/batch',
    '/batch?x=1',
    '/batch/x',
    '/a\nb',
  ])('refuses path %j', async (path) => {
    expect(await errorsOf([{ path: '/ok' }, { path }])).not.toEqual([]);
  });
});
