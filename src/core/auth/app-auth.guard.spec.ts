import { generateKeyPairSync } from 'node:crypto';

import type { ConfigService } from '@nestjs/config';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import * as jwt from 'jsonwebtoken';

import { IS_ADMIN_KEY } from '@common/decorators/admin-api.decorator';
import { IS_PUBLIC_KEY } from '@common/decorators/public.decorator';
import type { Env } from '@config/env.schema';

import { AppAuthGuard } from './app-auth.guard';
import { PartnerTokenService } from './partner-token.service';
import { SsoTokenVerifier } from './sso-token.verifier';

// jwks-rsa pulls in ESM-only `jose`, which jest on Node 22 cannot load; the
// key lookup is stubbed per test anyway.
jest.mock('jwks-rsa', () => ({ JwksClient: jest.fn() }));

const config = {
  get: (key: string) =>
    ({ VISTAAR_JWT_SECRET: 'a'.repeat(32), ACCESS_TOKEN_TTL_SECONDS: 3600 })[
      key
    ],
} as unknown as ConfigService<Env, true>;
const partnerTokens = new PartnerTokenService(config);
const partnerToken = partnerTokens.sign({
  sub: 'a1',
  agent_id: 'VST-1',
  pii_id: 'PII-1',
});
const ssoToken = jwt.sign(
  { email: 'ho@katyayaniorganics.com' },
  generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey,
  { algorithm: 'RS256', keyid: 'k1', expiresIn: 600 },
);

function run(
  meta: { public?: boolean; admin?: boolean },
  token?: string,
  sso = new SsoTokenVerifier(config),
) {
  const reflector = {
    getAllAndOverride: (key: string) =>
      key === IS_PUBLIC_KEY ? meta.public : key === IS_ADMIN_KEY && meta.admin,
  } as unknown as Reflector;
  const request = {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  };
  const context = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return new AppAuthGuard(reflector, partnerTokens, sso).canActivate(context);
}

describe('AppAuthGuard', () => {
  it('lets a @Public() route through with no token', async () => {
    await expect(run({ public: true })).resolves.toBe(true);
  });

  it('lets a partner token open a partner route', async () => {
    await expect(run({}, partnerToken)).resolves.toBe(true);
  });

  it('refuses a partner token on an admin route', async () => {
    await expect(run({ admin: true }, partnerToken)).rejects.toMatchObject({
      status: 401,
    });
  });

  it('refuses an SSO token on a partner route', async () => {
    const sso = { verify: jest.fn() } as unknown as SsoTokenVerifier;
    await expect(run({}, ssoToken, sso)).rejects.toMatchObject({
      status: 401,
    });
    expect(sso.verify).not.toHaveBeenCalled();
  });

  it('refuses a route with no token', async () => {
    await expect(run({})).rejects.toMatchObject({ status: 401 });
  });
});
