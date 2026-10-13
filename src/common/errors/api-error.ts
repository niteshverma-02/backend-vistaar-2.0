import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * The `code` half of the error envelope, as a closed set.
 *
 * `AllExceptionsFilter` reads the `error` field off an HttpException's response
 * body and slugs it into `error.code`, so throwing through the helpers below is
 * the only way a route produces one of these. A free-form string would let the
 * same condition ship under two names, and the app and the HO portal branch on
 * this value for what they **show**.
 *
 * Retry-or-fail is **not** decided here: it is the HTTP status. A 4xx (except
 * 401, 408, 429) is final for the caller; a 5xx or no answer may be retried.
 *
 * Add a code here, in the module's section, when a feature needs one.
 */
export const API_ERROR_CODES = [
  'VALIDATION_FAILED',
  'NOT_FOUND',
  // Login. `OTP_LIMIT` is a 429: the app shows a wait, never a retry loop.
  'INVALID_PHONE',
  'OTP_NOT_REQUESTED',
  // Login vs Join Vistaar: the app offers the other door.
  'ACCOUNT_NOT_FOUND',
  'ACCOUNT_EXISTS',
  'OTP_INVALID',
  'OTP_LIMIT',
  'OTP_UNAVAILABLE',
  'IDENTITY_UNAVAILABLE',
  'ACCOUNT_BLOCKED',
  'SESSION_INVALID',
  // Stages. Every stage move is conditional on the stage it starts from.
  'STAGE_NOT_ALLOWED',
  'STAGE_CHANGED',
  // Onboarding.
  'COHORT_REQUIRED',
  'COHORT_NOT_FOUND',
  'CONFIG_NOT_PUBLISHED',
  'ONBOARDING_LOCKED',
  'UNKNOWN_FIELD',
  'FIELD_NOT_EDITABLE',
  'REQUIRED_FIELDS_MISSING',
  'VERSION_CONFLICT',
  // KYC review.
  'NOT_A_DOCUMENT',
  'DOCUMENT_MISSING',
  'DOCUMENTS_NOT_VERIFIED',
  // Config and cohorts (HO).
  'CONFIG_INVALID',
  'NO_DRAFT',
  'COHORT_EXISTS',
  'COHORT_IN_USE',
  // HO access.
  'NO_ADMIN_ACCESS',
  'ROLE_NOT_ALLOWED',
  'OWNER_NOT_FOUND',
  // Uploads.
  'UPLOADS_NOT_CONFIGURED',
  'FILE_REQUIRED',
  'FILE_TOO_LARGE',
  'FILE_TYPE_NOT_ALLOWED',
  // cart
  'OUT_OF_STOCK',
  'CART_LIMIT_REACHED',
  'CART_BUSY',
  // catalog
  'CATALOG_UNAVAILABLE',
  // draft orders
  'DRAFT_CART_EMPTY',
  'DRAFT_ID_UNAVAILABLE',
  // banners. HO is told the size to use, not just that the file failed.
  'IMAGE_SIZE_NOT_ALLOWED',
  'IMAGE_NOT_FOUND',
  // a reorder named a different set of banners than the book now holds (409)
  'BANNERS_CHANGED',
  // testimonials: the bulk / family is not in Stockship's catalogue.
  'PRODUCT_NOT_FOUND',
  // attendance. All 409: the day's stored state, not the request, is what refused it.
  'ALREADY_PUNCHED_IN',
  'NOT_PUNCHED_IN',
  'PUNCH_LIMIT_REACHED',
  'ATTENDANCE_CHANGED',
  // stories and crop calendar: HO content keys are unique (409).
  'FESTIVAL_EXISTS',
  'SAMPLE_EXISTS',
  'DESIGN_EXISTS',
  'TEMPLATE_EXISTS',
  'CROP_EXISTS',
  'FAQ_EXISTS',
  'FAQ_SECTION_EXISTS',
  'FAQ_SECTION_IN_USE',
  // events. All 409: the event's stored state refused it.
  'EVENT_FULL',
  'EVENT_CLOSED',
  'EVENT_SEATS_TAKEN',
  // terms and conditions: the active T&C cannot be deleted (409); no free TOC-n (503).
  'TERMS_IN_USE',
  'TERMS_ID_UNAVAILABLE',
  // a version's document was not written in the portal's editor (409).
  'TERMS_NOT_EDITABLE',
  // info pages: one row per page, so a second create is a 409.
  'INFO_PAGE_EXISTS',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/**
 * The codes that reach the wire **without** going through `apiError()` —
 * Nest's own exceptions, Fastify's body parser, the throttler, and the
 * database errors `AllExceptionsFilter` translates. Listed so the set the
 * clients are told about is actually closed.
 *
 * Not accepted by `apiError()` on purpose — a route that means one of these
 * throws the framework's exception, and a condition of its own gets a code of
 * its own above.
 */
export const FRAMEWORK_ERROR_CODES = [
  // Nest's HTTP exceptions, slugged from their `error` or their status.
  'UNAUTHORIZED',
  'FORBIDDEN',
  'SERVICE_UNAVAILABLE',
  'INTERNAL_SERVER_ERROR',
  // The throttler.
  'TOO_MANY_REQUESTS',
  // Fastify, before any pipe runs: a body over the limit, or not JSON at all.
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  // `AllExceptionsFilter`'s translations of what Mongo threw.
  'DUPLICATE_KEY',
  'INVALID_ID',
  'SCHEMA_VALIDATION_FAILED',
  'DATABASE_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;

export type FrameworkErrorCode = (typeof FRAMEWORK_ERROR_CODES)[number];

/** Every `error.code` a response can carry. */
export const WIRE_ERROR_CODES: readonly (ApiErrorCode | FrameworkErrorCode)[] =
  [...API_ERROR_CODES, ...FRAMEWORK_ERROR_CODES];

/**
 * `details` is an array of plain sentences, not an object — the app shows
 * `details[0]` verbatim, so the first line has to make sense on a phone screen
 * without a developer to read it.
 */
export function apiError(
  status: HttpStatus,
  code: ApiErrorCode,
  message: string,
  details?: string[],
): HttpException {
  return new HttpException(
    { error: code, message, ...(details ? { details } : {}) },
    status,
  );
}

export const badRequest = (
  code: ApiErrorCode,
  message: string,
  details?: string[],
): HttpException => apiError(HttpStatus.BAD_REQUEST, code, message, details);

export const forbidden = (
  code: ApiErrorCode,
  message: string,
  details?: string[],
): HttpException => apiError(HttpStatus.FORBIDDEN, code, message, details);

export const notFound = (message: string, details?: string[]): HttpException =>
  apiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', message, details);

export const unauthorized = (
  code: ApiErrorCode,
  message: string,
  details?: string[],
): HttpException => apiError(HttpStatus.UNAUTHORIZED, code, message, details);

export const tooMany = (
  code: ApiErrorCode,
  message: string,
  details?: string[],
): HttpException =>
  apiError(HttpStatus.TOO_MANY_REQUESTS, code, message, details);

export const unavailable = (
  code: ApiErrorCode,
  message: string,
  details?: string[],
): HttpException =>
  apiError(HttpStatus.SERVICE_UNAVAILABLE, code, message, details);

export const conflict = (
  code: ApiErrorCode,
  message: string,
  details?: string[],
): HttpException => apiError(HttpStatus.CONFLICT, code, message, details);

export const serviceUnavailable = (
  code: ApiErrorCode,
  message: string,
  details?: string[],
): HttpException =>
  apiError(HttpStatus.SERVICE_UNAVAILABLE, code, message, details);
