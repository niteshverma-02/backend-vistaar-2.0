import type { PaymentProvider } from './payments.domain';

/**
 * Merchant credentials HO enters in the portal, under four rules:
 *
 * 1. Encrypted at rest (AES-256-GCM, key only in the server's env), bound to
 *    their row and field so a database writer cannot swap them around.
 * 2. Write-only: no API ever returns a secret — only its last four characters.
 * 3. Two people: one admin submits, the gateway check must pass, and a
 *    *different* admin approves before they go live.
 * 4. A replaced or revoked set has its secrets wiped, not kept.
 */
export const CREDENTIAL_MODES = ['test', 'live'] as const;
export type CredentialMode = (typeof CREDENTIAL_MODES)[number];

export const CREDENTIAL_STATUSES = [
  'pending',
  'approved',
  'active',
  'superseded',
  'revoked',
  'rejected',
  'expired',
] as const;
export type CredentialStatus = (typeof CREDENTIAL_STATUSES)[number];

/** A pending set nobody approves in a day is dropped; the next submit replaces it. */
export const PENDING_TTL_MS = 24 * 3600 * 1000;
export const NOTE_MAX = 200;
export const REASON_MAX = 200;

export interface CredentialField {
  key: string;
  label: string;
  /** Secret: encrypted, never returned, masked to its last four. */
  secret: boolean;
  pattern: RegExp;
  /** What HO is told when it does not match. */
  hint: string;
}

/** No spaces or control characters — a pasted key with a stray newline fails here, not at payment time. */
const TOKEN = (min: number, max: number) =>
  new RegExp(`^[A-Za-z0-9_\\-]{${min},${max}}$`);

export const CREDENTIAL_FIELDS: Record<
  PaymentProvider,
  readonly CredentialField[]
> = {
  razorpay: [
    {
      key: 'key_id',
      label: 'Key ID',
      secret: false,
      pattern: /^rzp_(test|live)_[A-Za-z0-9]{8,32}$/,
      hint: 'starts with rzp_test_ or rzp_live_',
    },
    {
      key: 'key_secret',
      label: 'Key secret',
      secret: true,
      pattern: TOKEN(12, 64),
      hint: 'letters and digits, from Razorpay Dashboard → API Keys',
    },
    {
      key: 'webhook_secret',
      label: 'Webhook secret',
      secret: true,
      pattern: /^[\x21-\x7e]{8,64}$/,
      hint: '8–64 characters, no spaces — the one set on the Razorpay webhook',
    },
  ],
  cashfree: [
    {
      key: 'app_id',
      label: 'App ID',
      secret: false,
      pattern: TOKEN(8, 128),
      hint: 'from Cashfree Dashboard → Developers → API Keys',
    },
    {
      key: 'secret_key',
      label: 'Secret key',
      secret: true,
      pattern: TOKEN(16, 256),
      hint: 'from Cashfree Dashboard → Developers → API Keys',
    },
  ],
  phonepe: [
    {
      key: 'client_id',
      label: 'Client ID',
      secret: false,
      pattern: TOKEN(4, 128),
      hint: 'from PhonePe Business Dashboard → Developer Settings',
    },
    {
      key: 'client_version',
      label: 'Client version',
      secret: false,
      pattern: /^\d{1,4}$/,
      hint: 'a number, usually 1',
    },
    {
      key: 'client_secret',
      label: 'Client secret',
      secret: true,
      pattern: TOKEN(16, 256),
      hint: 'from PhonePe Business Dashboard → Developer Settings',
    },
  ],
};

export interface SplitFields {
  public_fields: Record<string, string>;
  secrets: Record<string, string>;
}

/**
 * The provider's fields, exactly: an unknown key is refused rather than
 * dropped, so a typo never leaves a required secret silently empty.
 */
export function splitFields(
  provider: PaymentProvider,
  mode: CredentialMode,
  raw: Record<string, unknown>,
): { ok: SplitFields } | { errors: string[] } {
  const spec = CREDENTIAL_FIELDS[provider];
  const errors: string[] = [];
  const known = new Set(spec.map((f) => f.key));
  for (const key of Object.keys(raw)) {
    if (!known.has(key)) errors.push(`"${key}" is not a ${provider} field.`);
  }
  const out: SplitFields = { public_fields: {}, secrets: {} };
  for (const field of spec) {
    const value = raw[field.key];
    if (typeof value !== 'string' || !value) {
      errors.push(`Please enter the ${field.label}.`);
      continue;
    }
    if (!field.pattern.test(value)) {
      errors.push(`The ${field.label} does not look right (${field.hint}).`);
      continue;
    }
    (field.secret ? out.secrets : out.public_fields)[field.key] = value;
  }
  const modeError = modeMismatch(provider, mode, out.public_fields);
  if (modeError) errors.push(modeError);
  return errors.length ? { errors } : { ok: out };
}

/** Razorpay says test or live in the key itself; a mismatch is a pasted wrong key. */
function modeMismatch(
  provider: PaymentProvider,
  mode: CredentialMode,
  fields: Record<string, string>,
): string | null {
  if (provider !== 'razorpay' || !fields.key_id) return null;
  const keyMode = fields.key_id.startsWith('rzp_live_') ? 'live' : 'test';
  return keyMode === mode
    ? null
    : `This is a ${keyMode} Key ID, but the mode chosen is ${mode}.`;
}

/**
 * Production takes real money only with live keys; every other server only
 * with test keys, so a beta bug can never charge a real farmer.
 */
export function modeAllowed(
  mode: CredentialMode,
  production: boolean,
): string | null {
  if (production && mode !== 'live')
    return 'This server takes live payments: please submit live keys.';
  if (!production && mode !== 'test')
    return 'This is a test server: please submit test keys, never live ones.';
  return null;
}

/** The only form a secret is ever shown in. */
export const mask = (value: string): string => `••••${value.slice(-4)}`;

export interface ApprovalCheck {
  status: CredentialStatus;
  submitted_by: string;
  expires_at: Date;
  test_ok: boolean | null;
}

export type ApprovalRefusal =
  'not_pending' | 'expired' | 'same_person' | 'not_tested';

/** Why `by` may not approve this set now, or `null` if they may. */
export function approvalRefusal(
  row: ApprovalCheck,
  by: string,
  now: Date,
): ApprovalRefusal | null {
  if (row.status !== 'pending') return 'not_pending';
  if (row.expires_at.getTime() <= now.getTime()) return 'expired';
  if (row.submitted_by.toLowerCase() === by.toLowerCase()) return 'same_person';
  if (row.test_ok !== true) return 'not_tested';
  return null;
}
