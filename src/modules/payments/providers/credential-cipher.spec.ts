import { randomBytes } from 'node:crypto';

import type { ConfigService } from '@nestjs/config';

import type { Env } from '@config/env.schema';

import { CredentialCipher, sealContext } from './credential-cipher';

function cipher(key: string | undefined, kid = 'k1'): CredentialCipher {
  const values: Record<string, unknown> = {
    PAYMENTS_CREDENTIALS_KEY: key,
    PAYMENTS_CREDENTIALS_KEY_ID: kid,
  };
  const config = { get: (k: string) => values[k] };
  return new CredentialCipher(config as unknown as ConfigService<Env, true>);
}

const KEY = randomBytes(32).toString('base64');
const CTX = sealContext('row-1', 'razorpay', 'key_secret');

describe('CredentialCipher', () => {
  it('opens what it sealed, and the sealed form holds no plain text', () => {
    const c = cipher(KEY);
    const sealed = c.seal('s3cr3tValue1234', CTX);

    expect(JSON.stringify(sealed)).not.toContain('s3cr3tValue1234');
    expect(c.open(sealed, CTX)).toBe('s3cr3tValue1234');
  });

  it('seals the same value differently each time', () => {
    const c = cipher(KEY);
    expect(c.seal('same', CTX).ct).not.toBe(c.seal('same', CTX).ct);
  });

  it('refuses a secret moved to another row or field', () => {
    const c = cipher(KEY);
    const sealed = c.seal('s3cr3t', CTX);

    expect(() =>
      c.open(sealed, sealContext('row-2', 'razorpay', 'key_secret')),
    ).toThrow();
    expect(() =>
      c.open(sealed, sealContext('row-1', 'razorpay', 'webhook_secret')),
    ).toThrow();
  });

  it('refuses a tampered value', () => {
    const c = cipher(KEY);
    const sealed = c.seal('s3cr3t', CTX);
    const ct = Buffer.from(sealed.ct, 'base64');
    ct[0] ^= 1;

    expect(() =>
      c.open({ ...sealed, ct: ct.toString('base64') }, CTX),
    ).toThrow();
  });

  it('refuses a shortened authentication tag', () => {
    const c = cipher(KEY);
    const sealed = c.seal('s3cr3t', CTX);
    const short = Buffer.from(sealed.tag, 'base64').subarray(0, 4);

    expect(() =>
      c.open({ ...sealed, tag: short.toString('base64') }, CTX),
    ).toThrow(/authentication tag/);
  });

  it('refuses a value sealed with another key', () => {
    const sealed = cipher(KEY).seal('s3cr3t', CTX);
    expect(() =>
      cipher(randomBytes(32).toString('base64')).open(sealed, CTX),
    ).toThrow();
    expect(() => cipher(KEY, 'k2').open(sealed, CTX)).toThrow(/k1/);
  });

  it('answers 503 CREDENTIALS_NOT_CONFIGURED without a key', () => {
    const c = cipher(undefined);
    expect(c.configured).toBe(false);
    expect(() => c.seal('x', CTX)).toThrow(/encryption key/);
  });
});
