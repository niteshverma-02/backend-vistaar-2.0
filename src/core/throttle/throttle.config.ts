import type { ThrottlerModuleOptions } from '@nestjs/throttler';

/**
 * **Who a request counts against** for rate limiting.
 *
 * `ThrottlerGuard` keys on `req.ip` by default, and phones on a mobile network
 * sit behind the carrier's CGNAT — many handsets, one public address. Once the
 * auth guard has verified a token, the partner (or HO user) is the key, so
 * people on one tower do not spend each other's budget.
 *
 * A public route (OTP send/verify, refresh) has no verified identity and stays
 * on the IP; the OTP routes add their own per-number limit on top.
 */
export function throttleTracker(request: {
  user?: unknown;
  ip?: unknown;
}): string {
  const subject = verifiedSubject(request.user);

  if (subject) return `user:${subject}`;

  return `ip:${typeof request.ip === 'string' ? request.ip : 'unknown'}`;
}

function verifiedSubject(user: unknown): string | null {
  if (typeof user !== 'object' || user === null) return null;

  const { sub, email } = user as { sub?: unknown; email?: unknown };
  const id = typeof sub === 'string' ? sub : email;

  return typeof id === 'string' && id.length > 0 ? id : null;
}

/** Per route, per tracker. */
export const THROTTLE_OPTIONS: ThrottlerModuleOptions = {
  throttlers: [{ name: 'default', ttl: 60_000, limit: 120 }],
  getTracker: throttleTracker,
  errorMessage: 'Too many requests. Please wait a minute and try again.',
};
