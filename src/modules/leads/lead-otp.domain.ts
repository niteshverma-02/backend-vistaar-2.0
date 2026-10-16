import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The farmer's OTP on lead add (TL, 2026-10-16): `POST /leads/otp/verify`
 * hands the app a short-lived token that says "this partner saw this farmer's
 * phone verified", and `POST /leads` takes it. Stateless — any server process
 * checks it with the key alone, and nothing is stored for a verify that is
 * never followed by a save.
 */

/** How long a verified phone may be saved as a lead. */
export const LEAD_OTP_TTL_MS = 15 * 60 * 1000;

/** A different key from the partner token's, though made from the same secret. */
const KEY_LABEL = 'vistaar-lead-otp-v1';

export interface LeadOtpClaims {
  agent_id: string;
  /** Ten digits, as `normalizeMobile` gives it. */
  phone: string;
  verified_at: Date;
}

interface Payload {
  v: 1;
  a: string;
  p: string;
  /** Verified at, ms. */
  iat: number;
  /** Expires at, ms. */
  exp: number;
}

/**
 * The signing key for lead OTP tokens, derived from the service secret so a
 * lead token can never pass as anything else signed with that secret.
 */
export const leadOtpKey = (secret: string): Buffer =>
  createHmac('sha256', secret).update(KEY_LABEL).digest();

const sign = (key: Buffer, body: string): string =>
  createHmac('sha256', key).update(body).digest('base64url');

export function signLeadOtp(
  key: Buffer,
  claims: LeadOtpClaims,
): { otp_token: string; expires_at: Date } {
  const iat = claims.verified_at.getTime();
  const payload: Payload = {
    v: 1,
    a: claims.agent_id.toUpperCase(),
    p: claims.phone,
    iat,
    exp: iat + LEAD_OTP_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return {
    otp_token: `${body}.${sign(key, body)}`,
    expires_at: new Date(payload.exp),
  };
}

export type LeadOtpVerdict =
  | { ok: true; verified_at: Date }
  | { ok: false; reason: 'malformed' | 'signature' | 'expired' | 'mismatch' };

/** Is `token` this partner's, for this phone, and still fresh at `now`? */
export function readLeadOtp(
  key: Buffer,
  token: string,
  expect: { agent_id: string; phone: string },
  now: Date,
): LeadOtpVerdict {
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1])
    return { ok: false, reason: 'malformed' };
  const [body, mac] = parts;
  const want = Buffer.from(sign(key, body));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got))
    return { ok: false, reason: 'signature' };

  let payload: Partial<Payload>;
  try {
    payload = JSON.parse(
      Buffer.from(body, 'base64url').toString('utf8'),
    ) as Partial<Payload>;
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (
    payload.v !== 1 ||
    typeof payload.a !== 'string' ||
    typeof payload.p !== 'string' ||
    typeof payload.iat !== 'number' ||
    typeof payload.exp !== 'number'
  )
    return { ok: false, reason: 'malformed' };
  if (payload.exp <= now.getTime()) return { ok: false, reason: 'expired' };
  if (payload.a !== expect.agent_id.toUpperCase() || payload.p !== expect.phone)
    return { ok: false, reason: 'mismatch' };
  return { ok: true, verified_at: new Date(payload.iat) };
}
