import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { JwksClient } from 'jwks-rsa';

import type { AdminPrincipal } from '@common/interfaces/principal.interface';
import type { Env } from '@config/env.schema';

export class SsoUnavailableError extends Error {}

const DEFAULT_JWKS_URL = 'https://sso.ko-tech.in/.well-known/jwks.json';

/**
 * Verifies the company SSO token the HO portal sends (RS256, keys from the
 * SSO's JWKS). This service never mints one. Only the signature, expiry,
 * the token `type` and the `email` claim matter here; what that email may do
 * is decided by the access module against `agents_v2`.
 */
@Injectable()
export class SsoTokenVerifier {
  private readonly logger = new Logger(SsoTokenVerifier.name);
  private readonly jwks: JwksClient;
  private readonly issuer?: string;
  private readonly audience?: string;

  constructor(config: ConfigService<Env, true>) {
    this.jwks = new JwksClient({
      jwksUri: config.get('SSO_JWKS_URL', { infer: true }) ?? DEFAULT_JWKS_URL,
      cache: true,
      cacheMaxAge: 10 * 60 * 1000,
      rateLimit: true,
      jwksRequestsPerMinute: 10,
      timeout: 5_000,
    });
    this.issuer = config.get('SSO_ISSUER', { infer: true });
    this.audience = config.get('SSO_AUDIENCE', { infer: true });
  }

  /**
   * `null` for a bad or expired token. Throws `SsoUnavailableError` when the
   * keys cannot be fetched — that is our outage (503), not the caller's 401.
   */
  async verify(token: string): Promise<AdminPrincipal | null> {
    const header = jwt.decode(token, { complete: true })?.header;
    if (!header?.kid || header.alg !== 'RS256') return null;

    let key: string;
    try {
      key = (await this.jwks.getSigningKey(header.kid)).getPublicKey();
    } catch (error) {
      // A rate-limit hit is someone spamming random `kid`s, not an SSO outage.
      if (
        error instanceof Error &&
        (error.name === 'SigningKeyNotFoundError' ||
          error.name === 'JwksRateLimitError')
      ) {
        return null;
      }
      this.logger.error(`SSO JWKS unreachable: ${String(error)}`);
      throw new SsoUnavailableError('SSO keys unavailable');
    }

    try {
      const decoded = jwt.verify(token, key, {
        algorithms: ['RS256'],
        ...(this.issuer ? { issuer: this.issuer } : {}),
        ...(this.audience ? { audience: this.audience } : {}),
      });
      if (typeof decoded !== 'object') return null;

      const claims = decoded as Record<string, unknown>;
      // The SSO signs its refresh token with the same key; it is longer-lived
      // and must only ever reach the SSO's own /refresh-token, never a bearer.
      if (claims.type !== undefined && claims.type !== 'access') return null;
      const email = typeof claims.email === 'string' ? claims.email : '';
      const iat = typeof claims.iat === 'number' ? claims.iat : 0;
      const exp = typeof claims.exp === 'number' ? claims.exp : 0;
      if (!email || !exp) return null;

      return {
        kind: 'admin',
        email: email.trim().toLowerCase(),
        iat,
        exp,
        ...(typeof claims.user_role === 'string'
          ? { user_role: claims.user_role }
          : {}),
      };
    } catch {
      return null;
    }
  }
}
