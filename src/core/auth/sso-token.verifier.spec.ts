import { generateKeyPairSync } from 'node:crypto';

import type { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';

import type { Env } from '@config/env.schema';

import { SsoTokenVerifier, SsoUnavailableError } from './sso-token.verifier';

// jwks-rsa pulls in ESM-only `jose`, which jest on Node 22 cannot load; the
// key lookup is stubbed per test anyway.
jest.mock('jwks-rsa', () => ({ JwksClient: jest.fn() }));

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const token = jwt.sign({ email: 'Ho@Katyayaniorganics.com' }, privateKey, {
  algorithm: 'RS256',
  keyid: 'k1',
  expiresIn: 600,
});

function verifierWith(getSigningKey: jest.Mock): SsoTokenVerifier {
  const verifier = new SsoTokenVerifier({
    get: () => undefined,
  } as unknown as ConfigService<Env, true>);
  (verifier as unknown as { jwks: unknown }).jwks = { getSigningKey };
  return verifier;
}

const failing = (name: string) => {
  const error = new Error(name);
  error.name = name;
  return jest.fn().mockRejectedValue(error);
};

describe('SsoTokenVerifier', () => {
  it('accepts a token signed by an SSO key', async () => {
    const verifier = verifierWith(
      jest.fn().mockResolvedValue({
        getPublicKey: () => publicKey.export({ type: 'spki', format: 'pem' }),
      }),
    );
    await expect(verifier.verify(token)).resolves.toMatchObject({
      kind: 'admin',
      email: 'ho@katyayaniorganics.com',
    });
  });

  it.each([
    ['an access token', { type: 'access' }, true],
    ['a token with no type', {}, true],
    ['a refresh token', { type: 'refresh' }, false],
  ])('%s: accepted is %s', async (_, claims, accepted) => {
    const signed = jwt.sign(
      { email: 'ho@katyayaniorganics.com', ...claims },
      privateKey,
      { algorithm: 'RS256', keyid: 'k1', expiresIn: 600 },
    );
    const verifier = verifierWith(
      jest.fn().mockResolvedValue({
        getPublicKey: () => publicKey.export({ type: 'spki', format: 'pem' }),
      }),
    );
    const principal = await verifier.verify(signed);
    expect(principal !== null).toBe(accepted);
  });

  it.each(['SigningKeyNotFoundError', 'JwksRateLimitError'])(
    'answers %s with a 401, not an outage',
    async (name) => {
      await expect(
        verifierWith(failing(name)).verify(token),
      ).resolves.toBeNull();
    },
  );

  it('reports an unreachable JWKS as an outage', async () => {
    await expect(
      verifierWith(failing('JwksError')).verify(token),
    ).rejects.toBeInstanceOf(SsoUnavailableError);
  });
});
