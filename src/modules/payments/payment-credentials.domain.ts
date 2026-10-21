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
  /** May be left empty. */
  optional?: boolean;
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
    // The Key ID is all Razorpay needs here: KO Utils registers the order with
    // its own secret (as for My Mali, RAZORPAY_ORDER_SOURCE=ko_utils) and the
    // app opens the sheet with the Key ID alone. User's decision, 2026-10-16.
  ],
  // No fields: KO Utils holds Cashfree's App ID and secret, and keys for it are
  // refused on submit (`KEYLESS_PROVIDERS`). User's decision, 2026-10-21.
  cashfree: [],
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
    if (field.optional && (value === undefined || value === '')) continue;
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
  return errors.length ? { errors } : { ok: out };
}

/**
 * Both modes are accepted on every server — HO picks test or live on the form
 * (user's decision, 2026-10-16). The server's own mode is only the form's
 * default, and the mode is never read from the key: a rzp_live_ key may be
 * filed under test, and the other way round.
 */
export const defaultMode = (production: boolean): CredentialMode =>
  production ? 'live' : 'test';

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
