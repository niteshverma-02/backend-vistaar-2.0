import type { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';

import type { Env } from '@config/env.schema';

import { PartnerTokenService } from './partner-token.service';

const SECRET = 'a'.repeat(32);
const claims = { sub: 'a1', agent_id: 'VST-1', pii_id: 'PII-1', typ: 'access' };
const service = new PartnerTokenService({
  get: (key: string) =>
    ({ VISTAAR_JWT_SECRET: SECRET, ACCESS_TOKEN_TTL_SECONDS: 3600 })[key],
} as unknown as ConfigService<Env, true>);

const signed = (options: jwt.SignOptions) =>
  jwt.sign(claims, SECRET, {
    algorithm: 'HS256',
    issuer: 'vistaar-api',
    audience: 'vistaar-app',
    expiresIn: 3600,
    ...options,
  });

describe('PartnerTokenService', () => {
  it('accepts its own token', () => {
    expect(service.verify(service.sign(claims))).toEqual({
      kind: 'partner',
      sub: 'a1',
      agent_id: 'VST-1',
      pii_id: 'PII-1',
    });
  });

  it.each([
    ['alg none', jwt.sign(claims, '', { algorithm: 'none' })],
    ['a wrong audience', signed({ audience: 'other-app' })],
    ['a wrong issuer', signed({ issuer: 'other-api' })],
    ['an expired token', signed({ expiresIn: -10 })],
    ['another key', jwt.sign(claims, 'b'.repeat(32), { algorithm: 'HS256' })],
  ])('refuses %s', (_label, token) => {
    expect(service.verify(token)).toBeNull();
  });
});
