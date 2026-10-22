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
  // Aadhaar / PAN already on another partner's form.
  'ID_IN_USE',
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
  // orders: no `app_counters` row for `KSV-` numbers, or no free one (503).
  'ORDER_ID_UNAVAILABLE',
  // banners. HO is told the size to use, not just that the file failed.
  'IMAGE_SIZE_NOT_ALLOWED',
  'IMAGE_NOT_FOUND',
  // a reorder named a different set of banners than the book now holds (409)
  'BANNERS_CHANGED',
  // testimonials: the bulk / family is not in Stockship's catalogue.
  'PRODUCT_NOT_FOUND',
  // the attached video / photo was never uploaded, or is not this kind (400).
  'MEDIA_NOT_FOUND',
  // HO: the submission's status no longer allows that action (409).
  'TESTIMONIAL_NOT_ALLOWED',
  // HO: the farmer withdrew consent — it can never be shown again (409).
  'CONSENT_WITHDRAWN',
  // HO: a partner's testimonial is decided on the submissions desk, not here (409).
  'TESTIMONIAL_FROM_PARTNER',
  // attendance. All 409: the day's stored state, not the request, is what refused it.
  'ALREADY_PUNCHED_IN',
  'NOT_PUNCHED_IN',
  'PUNCH_LIMIT_REACHED',
  'ATTENDANCE_CHANGED',
  // stories: HO content keys are unique (409).
  'FESTIVAL_EXISTS',
  'SAMPLE_EXISTS',
  'DESIGN_EXISTS',
  'TEMPLATE_EXISTS',
  'FAQ_EXISTS',
  'FAQ_SECTION_EXISTS',
  'FAQ_SECTION_IN_USE',
  // events. All 409: the event's stored state refused it.
  'EVENT_FULL',
  'EVENT_CLOSED',
  'EVENT_SEATS_TAKEN',
  // meetings (409): no longer scheduled / cancelled; a meeting id another partner holds.
  'MEETING_CLOSED',
  'MEETING_EXISTS',
  // gigs (409): someone else took it first / its state no longer allows that.
  'GIG_TAKEN',
  'GIG_CLOSED',
  // terms and conditions: the active T&C cannot be deleted (409); no free TOC-n (503).
  'TERMS_IN_USE',
  'TERMS_ID_UNAVAILABLE',
  // a version's document was not written in the portal's editor (409).
  'TERMS_NOT_EDITABLE',
  // info pages: one row per page, so a second create is a 409.
  'INFO_PAGE_EXISTS',
  // Farmer leads. A partner adds farmers only, and each farmer once.
  'PARTNER_NOT_APPROVED',
  'SELF_LEAD',
  'FARMER_TAKEN',
  'NOT_A_FARMER',
  'CONSENT_OUTDATED',
  'LEADS_NOT_CONFIGURED',
  'LEADS_UNAVAILABLE',
  // The order service's confirmed-order call is off on this server (no secret).
  'ORDER_EVENTS_NOT_CONFIGURED',
  // feedback: a partner's answers or product suggestions for the IST day are used up (429).
  'FEEDBACK_LIMIT',
  // payments: an option cannot be switched on without live keys (400); a keyless
  // one (Cashfree — KO Utils holds its keys) takes none (400).
  'CREDENTIALS_MISSING',
  'CREDENTIALS_NOT_USED',
  // payment keys. No encryption key on the server (503); a set already waiting,
  // or this one no longer waiting / past its day / not checked yet (409).
  'CREDENTIALS_NOT_CONFIGURED',
  'CREDENTIALS_UNREADABLE',
  'CREDENTIALS_PENDING',
  'CREDENTIALS_NOT_PENDING',
  'CREDENTIALS_EXPIRED',
  'CREDENTIALS_NOT_TESTED',
  // the two-person rule: the submitter cannot approve their own keys (403).
  'APPROVER_IS_SUBMITTER',
  // Commission plans: one per cohort and month (409); past months are paid out, so locked (409).
  'PLAN_EXISTS',
  'PLAN_LOCKED',
  // Wallet. 400 for the amount; 409 when the stored state refused it.
  'BELOW_MIN_WITHDRAWAL',
  'NOT_ENOUGH_BALANCE',
  'WITHDRAWAL_OPEN',
  'BANK_NOT_VERIFIED',
  'WITHDRAWAL_CHANGED',
  // Earning cohorts and rules. The built-in default cannot be archived or
  // filtered (400); an archived cohort / rule cannot change (409); a reorder
  // named a different set than now stands (409).
  'EARNING_COHORT_LOCKED',
  'EARNING_ARCHIVED',
  'EARNING_ORDER_CHANGED',
  // A gig (HO) named an earning cohort that does not exist or is archived (400).
  'EARNING_COHORT_NOT_FOUND',
  // Farmer OTP on lead add (400): no token sent, or one that is not this
  // partner's, not this phone's, or past its 15 minutes.
  'LEAD_OTP_REQUIRED',
  'LEAD_OTP_INVALID',
  // Rewards: HO approves or rejects a pending reward only (409).
  'REWARD_NOT_PENDING',
  // Profile: HO decided a name change that is no longer waiting (409).
  'NAME_CHANGE_NOT_PENDING',
  // Bank account change: one waiting at a time, no new withdrawal meanwhile;
  // HO / the partner acted on one that is no longer waiting (409).
  'BANK_CHANGE_PENDING',
  'BANK_CHANGE_NOT_PENDING',
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
