import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Error as MongooseError, mongo } from 'mongoose';

import type {
  ApiErrorCode,
  FrameworkErrorCode,
} from '@common/errors/api-error';

export interface ApiErrorEnvelope {
  success: false;
  /** Give this value to support; it joins the browser response to server logs. */
  requestId: string;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  path: string;
  timestamp: string;
}

/**
 * Turns every thrown value into the error twin of {@link ApiEnvelope}.
 *
 * Mongo driver errors are translated here rather than in services, so a
 * duplicate key surfaces as a 409 instead of a bare 500.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<FastifyRequest>();
    const reply = ctx.getResponse<FastifyReply>();

    const { status, code, message, details } = describe(exception);
    const requestId = request.id;

    // Only our own faults reach the log at error level; 4xx is the caller's.
    if (status >= 500) {
      this.logger.error(
        `[${requestId}] ${request.method} ${request.url} -> ${status} ${code}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ApiErrorEnvelope = {
      success: false,
      requestId,
      error: { code, message, ...(details === undefined ? {} : { details }) },
      path: request.url,
      timestamp: new Date().toISOString(),
    };

    void reply.header('x-request-id', requestId).status(status).send(body);
  }
}

interface Described {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

function describe(exception: unknown): Described {
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const response = exception.getResponse();

    if (typeof response === 'string') {
      return { status, code: codeFor(status), message: plain(response) };
    }

    const {
      message,
      error,
      details: explicitDetails,
      // Nest's own exceptions echo the status in the body; the HTTP status
      // already says it, and it is not a detail anyone can act on.
      statusCode: _statusCode,
      ...rest
    } = response as {
      message?: unknown;
      error?: unknown;
      details?: unknown;
      [key: string]: unknown;
    };

    return {
      status,
      code: typeof error === 'string' ? v2Code(slug(error)) : codeFor(status),
      message: Array.isArray(message)
        ? 'Some details are missing or not correct. Please check and try again.'
        : plain(typeof message === 'string' ? message : exception.message),
      // `details` passed deliberately (the v2 `apiError()` helpers) surfaces
      // as-is; class-validator instead puts its per-field errors on `message`
      // as an array. Without the explicit branch the helper's array would
      // arrive nested one level deeper, as `details: { details: [...] }`.
      details:
        explicitDetails !== undefined
          ? explicitDetails
          : Array.isArray(message)
            ? message
            : Object.keys(rest).length > 0
              ? rest
              : undefined,
    };
  }

  // Fastify plugins (multipart above all) reject with their own errors, not
  // an HttpException. Their status is right but would have fallen through to
  // a 500 here — a file over the limit read "unexpected error" and was logged
  // as our fault.
  if (isFastifyClientError(exception)) {
    const { statusCode: status, code } = exception;
    return {
      status,
      code:
        FASTIFY_CODES[code] ??
        (status === Number(HttpStatus.PAYLOAD_TOO_LARGE)
          ? ('PAYLOAD_TOO_LARGE' satisfies FrameworkErrorCode)
          : ('VALIDATION_FAILED' satisfies ApiErrorCode)),
      message: FASTIFY_MESSAGES[code] ?? exception.message,
    };
  }

  if (exception instanceof mongo.MongoServerError && exception.code === 11000) {
    return {
      status: HttpStatus.CONFLICT,
      code: 'DUPLICATE_KEY' satisfies FrameworkErrorCode,
      // `keyValue` stays off the wire: it can be a phone number or a name.
      message: 'This already exists. Please use a different value.',
    };
  }

  // A bad Mongo credential/role must not masquerade as an application bug
  // (500), otherwise the client retries an OTP login even though the
  // configuration needs attention.
  if (isDatabaseUnreachable(exception)) {
    return {
      status: HttpStatus.SERVICE_UNAVAILABLE,
      code: 'DATABASE_UNAVAILABLE' satisfies FrameworkErrorCode,
      message:
        'We cannot reach our servers right now. Please try again in a few minutes.',
    };
  }

  if (exception instanceof MongooseError.CastError) {
    return {
      status: HttpStatus.BAD_REQUEST,
      code: 'INVALID_ID' satisfies FrameworkErrorCode,
      message: 'This link is not valid. Please go back and try again.',
    };
  }

  if (exception instanceof MongooseError.ValidationError) {
    return {
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      code: 'SCHEMA_VALIDATION_FAILED' satisfies FrameworkErrorCode,
      message:
        'This could not be saved. Please check the details and try again.',
      details: Object.keys(exception.errors),
    };
  }

  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    code: 'INTERNAL_ERROR' satisfies FrameworkErrorCode,
    // Deliberately generic — stack traces and driver messages go to the log,
    // never to a partner's phone.
    message:
      'Something went wrong on our side. Please try again in a little while.',
  };
}

/**
 * Server codes that mean "the credential or its grants are wrong", not "the
 * caller sent something wrong": 13 `Unauthorized`, 18 `AuthenticationFailed`,
 * 8000 `AtlasError` (auth failures arrive under this one on Atlas).
 */
const ACCESS_ERROR_CODES = new Set([13, 18, 8000]);

/**
 * "The database did not answer" in all its forms — no grant, no credential, no
 * topology, no socket. Every one of them is ours to fix and none of them gets
 * better if the caller retries the same request differently, so they share one
 * 503 rather than being split between 503 and a bare 500.
 */
function isDatabaseUnreachable(exception: unknown): boolean {
  if (exception instanceof mongo.MongoServerError) {
    return ACCESS_ERROR_CODES.has(Number(exception.code));
  }

  return (
    // Mongoose wraps the driver's selection error before it leaves a query.
    exception instanceof MongooseError.MongooseServerSelectionError ||
    exception instanceof mongo.MongoServerSelectionError ||
    exception instanceof mongo.MongoNetworkError ||
    exception instanceof mongo.MongoNotConnectedError ||
    exception instanceof mongo.MongoTopologyClosedError
  );
}

interface FastifyClientError extends Error {
  code: string;
  statusCode: number;
}

function isFastifyClientError(
  exception: unknown,
): exception is FastifyClientError {
  if (!(exception instanceof Error)) return false;
  const { code, statusCode } = exception as Partial<FastifyClientError>;
  return (
    typeof code === 'string' &&
    code.startsWith('FST_') &&
    typeof statusCode === 'number' &&
    statusCode >= 400 &&
    statusCode < 500
  );
}

const FASTIFY_CODES: Record<string, ApiErrorCode> = {
  FST_REQ_FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  FST_INVALID_MULTIPART_CONTENT_TYPE: 'FILE_REQUIRED',
};

/** Fastify's own wording is for developers; the app shows `message` as is. */
const FASTIFY_MESSAGES: Record<string, string> = {
  FST_REQ_FILE_TOO_LARGE: 'The file is too large.',
  FST_FILES_LIMIT: 'Send one file per request.',
  FST_PARTS_LIMIT: 'The form has too many parts.',
  FST_FIELDS_LIMIT: 'The form has too many fields.',
  FST_INVALID_MULTIPART_CONTENT_TYPE:
    'Send the file as multipart/form-data, field `file`.',
};

/**
 * Messages Nest, Fastify and the throttler write for developers
 * (`Cannot GET /api/v2/x`, `ThrottlerException: Too Many Requests`), swapped
 * for ones a partner can act on. A message a route wrote itself passes as is.
 */
const FRAMEWORK_MESSAGES: [RegExp, string][] = [
  [
    /^Cannot (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) /,
    'This page or action is not available. Please update the app.',
  ],
  [
    /^ThrottlerException/,
    'Too many tries. Please wait a minute and try again.',
  ],
  [
    /^Body is not valid JSON|^Unsupported Media Type$/,
    'Your request could not be read. Please try again.',
  ],
  [
    /^Request body is too large$/,
    'This is too large to send. Please send less at a time.',
  ],
];

function plain(message: string): string {
  return (
    FRAMEWORK_MESSAGES.find(([pattern]) => pattern.test(message))?.[1] ??
    message
  );
}

function codeFor(status: number): string {
  return v2Code(slug(HttpStatus[status] ?? 'ERROR'));
}

/**
 * Framework-produced codes, mapped into the v2 closed set.
 *
 * `validationExceptionFactory` fixed this for class-validator, but it is not
 * the only thing that answers 400 without going through `apiError()`: Fastify's
 * body parser rejects a malformed payload **before** any pipe runs, and its
 * `BadRequestException` carries `error: 'Bad Request'`. That slugged to
 * `BAD_REQUEST` — a code neither `API_ERROR_CODES` nor
 * `FRAMEWORK_ERROR_CODES` lists, so one 400 arrived under a name the app's
 * error handling had never been told about.
 *
 * What produces it in the field is a truncated upload on a weak connection.
 * The queue already drops it — it decides by status, and a 400 is final — but
 * the screen branches on the code, and `VALIDATION_FAILED` is the one it knows
 * for "the payload was wrong": the caller sent something this server could not
 * read, and no retry of the same bytes changes that.
 */
const FRAMEWORK_CODES: Record<string, string> = {
  BAD_REQUEST: 'VALIDATION_FAILED',
  UNPROCESSABLE_ENTITY: 'VALIDATION_FAILED',
};

function v2Code(code: string): string {
  return FRAMEWORK_CODES[code] ?? code;
}

function slug(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}
