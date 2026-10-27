import { z } from 'zod';

/**
 * Every environment variable this service reads, declared in one place.
 *
 * The only file that touches `process.env`. An unknown variable is dead weight
 * you can see, and a missing required one fails the boot with its own name.
 * Adding a variable means adding it here, to `.env.example`, and a case to
 * `env.schema.spec.ts` if it has a default or a coercion.
 *
 * Auth (OTP, app tokens, SSO for the HO portal) and the ko-sales lead intake
 * add their variables with the login module.
 *
 * `B2B_API_URL` is required, not defaulted: the cart is priced from that
 * catalogue. There is no B2B token here — B2B tokens belong to signed-in
 * agents and expire, so each request brings its own.
 */

/** `"true"`/`"false"` strings only — z.coerce.boolean() treats "false" as true. */
const booleanFromString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().min(1).default('0.0.0.0'),

  /** `CRM-Database`, shared with ko-sales and every other portal. */
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  MONGODB_DB_NAME: z.string().min(1).default('CRM-Database'),
  /** Connections per process. Many processes × this must stay under the server's limit. */
  MONGODB_MAX_POOL_SIZE: z.coerce.number().int().min(1).max(500).default(50),
  MONGODB_MIN_POOL_SIZE: z.coerce.number().int().min(0).max(100).default(5),
  /**
   * Comma-separated Mongo host names the test-data seeds (`seed-test-*`,
   * `seed-feedback`, `seed-banners`) may write to. Set only in beta / local
   * `.env`; unset, every test seed refuses (`scripts/test-db-guard.ts`).
   */
  SEED_ALLOW_HOSTS: z.string().optional(),

  /** `pnpm start:cluster`: worker processes; 0 = one per CPU core. */
  WEB_CONCURRENCY: z.coerce.number().int().min(0).max(64).default(0),

  /** Comma-separated. Empty = no browser origin allowed (the mobile app still
   *  works — native clients send no Origin header). `*` = any. */
  CORS_ORIGINS: z.string().default(''),

  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),

  /** Swagger UI at `/docs` is off unless explicitly switched on. */
  SWAGGER_ENABLED: booleanFromString,

  /** B2B Sales API — the marketplace catalogue every cart line is priced from. */
  B2B_API_URL: z.url('B2B_API_URL must be a URL'),
  B2B_MARKETPLACE_CODE: z.string().min(1).default('MKTP-1'),

  /** How long a fetched catalogue counts as fresh before a background refresh. */
  CATALOG_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(60),

  // ── Partner sessions (the Vistaar app) ─────────────────────────────────
  /**
   * HS256 key for the partner access token. Partners are not SSO users (they
   * sign in with a phone and an OTP), so this service issues their token
   * itself. Never shared with another service: a partner token must not open
   * anything outside Vistaar, and an SSO token must not open a partner route.
   */
  VISTAAR_JWT_SECRET: z
    .string()
    .min(32, 'VISTAAR_JWT_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(300)
    .max(7 * 24 * 3600)
    .default(12 * 3600),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(180).default(30),

  // ── OTP (utilities service, MSG91 behind it) ───────────────────────────
  OTP_API_URL: z.url().default('https://utils.ko-tech.in'),
  OTP_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  /**
   * Comma-separated 10-digit numbers that skip the SMS and accept
   * `OTP_TEST_CODE`, so the app developer can sign in without a phone.
   * Refused outright in production (see the refinement below).
   */
  OTP_TEST_NUMBERS: z.string().default(''),
  OTP_TEST_CODE: z
    .string()
    .regex(/^\d{4,6}$/)
    .optional(),

  // ── ko-sales Customer Session (Phase 2) ───────────────────────────────
  /**
   * The Vistaar platform key from sales-operations → Customer Session →
   * Generate key (`kp.vistaar.…`, shown once). With it this server asks
   * ko-sales (`B2B_API_URL`) for a partner's customer pass after our own OTP
   * (`POST /auth/customer-session`). Never sent to the app, never logged.
   * Empty = that route answers 503 CUSTOMER_SESSION_OFF.
   */
  KATYAYANI_PLATFORM_KEY: z
    .string()
    .trim()
    .regex(
      /^(kp\.[a-z0-9-]+\.[A-Za-z0-9_-]{20,})?$/,
      'KATYAYANI_PLATFORM_KEY must look like kp.<platform>.<secret>',
    )
    .default(''),

  // ── Order events (server to server) ────────────────────────────────────
  /**
   * Shared secret the order service sends (`x-webhook-secret`) when Stockship
   * confirms a Vistaar order — that makes the farmer a customer. Unset = the
   * route answers 503 ORDER_EVENTS_NOT_CONFIGURED.
   */
  ORDER_EVENTS_SECRET: z
    .string()
    .min(24, 'ORDER_EVENTS_SECRET must be at least 24 characters')
    .optional(),

  // ── Radar ──────────────────────────────────────────────────────────────
  /**
   * Kill switch for the radar's pincode pools (KKD leads, org customers):
   * each process reads both org collections once an hour into memory
   * (~2–4 s of aggregation on the database). `false` = the radar shows the
   * partner's own farmers and the stores only.
   */
  RADAR_POOLS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  // ── Online payment ─────────────────────────────────────────────────────
  /**
   * Kill switch: off, `GET /payment-options` is empty whatever HO has switched
   * on, so ops can stop online payment without a deploy. Off by default — no
   * environment takes money until someone turns it on on purpose.
   */
  PAYMENTS_ONLINE_ENABLED: booleanFromString,
  /**
   * AES-256 key (32 random bytes, base64) that seals the merchant keys HO
   * enters. Lives only here — never in Mongo. Unset = keys cannot be
   * submitted (503 CREDENTIALS_NOT_CONFIGURED). Losing it means every stored
   * set must be submitted again. `openssl rand -base64 32`.
   */
  PAYMENTS_CREDENTIALS_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, {
      message: 'PAYMENTS_CREDENTIALS_KEY must be 32 bytes, base64',
    })
    .optional(),
  /** Stored with every sealed value, so the key can be rotated later. */
  PAYMENTS_CREDENTIALS_KEY_ID: z
    .string()
    .regex(/^[a-z0-9-]{1,16}$/)
    .default('k1'),
  /** Slack incoming webhook told of every key submit, approve, reject and revoke. */
  PAYMENTS_ALERT_WEBHOOK_URL: z.url().optional(),

  // ── HO portal (SSO) ────────────────────────────────────────────────────
  /** HO staff use the company SSO token; only its signature is checked here. */
  SSO_JWKS_URL: z.url().default('https://sso.ko-tech.in/.well-known/jwks.json'),
  SSO_ISSUER: z.string().min(1).optional(),
  SSO_AUDIENCE: z.string().min(1).optional(),

  // ── KYC uploads (Firebase Storage, private objects) ────────────────────
  /**
   * Optional so a fresh environment still boots; without all four,
   * `POST /uploads` answers 503 `UPLOADS_NOT_CONFIGURED`. The private key is
   * the service-account JSON's `private_key`, newlines written as `\n`.
   */
  FIREBASE_PROJECT_ID: z.string().min(1).optional(),
  FIREBASE_CLIENT_EMAIL: z.string().min(1).optional(),
  FIREBASE_PRIVATE_KEY: z.string().min(1).optional(),
  FIREBASE_STORAGE_BUCKET: z.string().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Test numbers are a back door by design, so they may exist only where no
 * real partner signs in.
 */
const refinedEnvSchema = envSchema
  .refine(
    (env) =>
      env.NODE_ENV !== 'production' || env.OTP_TEST_NUMBERS.trim() === '',
    {
      message: 'OTP_TEST_NUMBERS must be empty in production',
      path: ['OTP_TEST_NUMBERS'],
    },
  )
  .refine(
    (env) =>
      !env.PAYMENTS_ONLINE_ENABLED ||
      env.PAYMENTS_CREDENTIALS_KEY !== undefined,
    {
      message:
        'PAYMENTS_CREDENTIALS_KEY is required when PAYMENTS_ONLINE_ENABLED is true',
      path: ['PAYMENTS_CREDENTIALS_KEY'],
    },
  )
  .refine((env) => env.MONGODB_MIN_POOL_SIZE <= env.MONGODB_MAX_POOL_SIZE, {
    message: 'MONGODB_MIN_POOL_SIZE must not exceed MONGODB_MAX_POOL_SIZE',
    path: ['MONGODB_MIN_POOL_SIZE'],
  });

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = refinedEnvSchema.safeParse(raw);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  • ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}\n`);
  }

  return parsed.data;
}

/** Parsed comma-separated CORS origins, empties stripped. */
export function parseCorsOrigins(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * `CORS_ORIGINS` as the CORS layer wants it.
 *
 *  - `*`      → `true`, which **reflects** the caller's own Origin. Not the
 *               literal `*` header: that is illegal next to
 *               `credentials: true`, so a browser would reject every
 *               authenticated call while the preflight looked fine.
 *  - a list   → those exact origins.
 *  - empty    → `false`, no browser origin at all.
 */
export function resolveCorsOrigin(raw: string): true | string[] | false {
  const origins = parseCorsOrigins(raw);

  if (origins.includes('*')) return true;

  return origins.length > 0 ? origins : false;
}

/**
 * `pnpm start:cluster` decides its worker count before Nest (and its
 * ConfigModule) exists, so it reads this one variable here. Set it in the
 * process environment; `.env` is loaded by each worker, not the primary.
 */
export function clusterWorkerCount(cpus: number): number {
  const parsed = envSchema.shape.WEB_CONCURRENCY.safeParse(
    process.env.WEB_CONCURRENCY,
  );
  const wanted = parsed.success ? parsed.data : 0;
  return wanted > 0 ? wanted : Math.max(1, cpus);
}
