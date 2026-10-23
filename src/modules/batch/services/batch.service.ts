import { Injectable } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { FastifyInstance, InjectOptions } from 'fastify';

import type { ApiErrorCode } from '@common/errors/api-error';
import { JSON_ETAG_PREFIX } from '@core/http/json-etag';

import type { BatchItemResult, BatchResult } from '../dto/batch.dto';

/** Past this one slow read stops holding up the rest of Home. */
export const BATCH_ITEM_TIMEOUT_MS = 25_000;

/**
 * Only what the replayed route needs to know who is asking. Never
 * `if-none-match` (a 304 has no body to hand back), `accept-encoding` (the
 * body is parsed here, not sent on) or the caller's `x-forwarded-for`.
 */
const FORWARDED_HEADERS = [
  'authorization',
  'accept-language',
  'user-agent',
] as const;

export interface BatchCaller {
  headers: Record<string, string | string[] | undefined>;
  /** Already resolved through `trustProxy`, so throttling and logs see the real client. */
  ip: string;
}

type Inject = (
  options: InjectOptions,
) => Promise<{ statusCode: number; body: string }>;

/**
 * **Replays a batch of GETs in-process** through Fastify's `inject`, so each
 * one runs the full pipeline — auth, `@Can`, throttle, envelope, error filter —
 * exactly as if the caller had sent it. A read the caller may not make comes
 * back as that route's own 401 / 403 inside the batch.
 */
@Injectable()
export class BatchService {
  constructor(private readonly adapterHost: HttpAdapterHost) {}

  run(caller: BatchCaller, paths: string[]): Promise<BatchResult> {
    const fastify = this.adapterHost.httpAdapter.getInstance<FastifyInstance>();

    return replay((options) => fastify.inject(options), caller, paths);
  }
}

export async function replay(
  inject: Inject,
  caller: BatchCaller,
  paths: string[],
  timeoutMs = BATCH_ITEM_TIMEOUT_MS,
): Promise<BatchResult> {
  const headers: Record<string, string> = {};

  for (const name of FORWARDED_HEADERS) {
    const value = caller.headers[name];

    if (typeof value === 'string') headers[name] = value;
  }

  const responses = await Promise.all(
    paths.map((path) =>
      withTimeout(
        inject({
          method: 'GET',
          url: `${JSON_ETAG_PREFIX}${path}`,
          headers,
          remoteAddress: caller.ip,
        }).then((res): BatchItemResult => ({
          status: res.statusCode,
          body: parse(res.body),
        })),
        timeoutMs,
      ),
    ),
  );

  return { responses };
}

const TIMED_OUT: BatchItemResult = {
  status: 504,
  body: {
    success: false,
    error: {
      code: 'BATCH_TIMEOUT' satisfies ApiErrorCode,
      message: 'This read took too long.',
    },
  },
};

async function withTimeout(
  work: Promise<BatchItemResult>,
  ms: number,
): Promise<BatchItemResult> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<BatchItemResult>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });

  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

function parse(body: string): unknown {
  if (!body) return null;

  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}
