import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { serviceUnavailable } from '@common/errors/api-error';
import type { Env } from '@config/env.schema';

export interface SealedValue {
  /** Which env key sealed it, so the key can be rotated later. */
  kid: string;
  iv: string;
  tag: string;
  ct: string;
}

const ALGORITHM = 'aes-256-gcm';
/**
 * Pinned on both sides: left open, Node accepts a shortened tag on decrypt,
 * and a 4-byte tag can be forged by anyone who can write the row.
 */
const TAG_BYTES = 16;

/**
 * AES-256-GCM with the key from `PAYMENTS_CREDENTIALS_KEY`, which never
 * touches the database. `context` is bound in as associated data — the row,
 * provider and field — so a sealed secret copied into another row or field
 * fails to open instead of being used there.
 */
@Injectable()
export class CredentialCipher {
  private readonly key: Buffer | null;
  private readonly kid: string;

  constructor(config: ConfigService<Env, true>) {
    const raw = config.get('PAYMENTS_CREDENTIALS_KEY', { infer: true });
    this.key = raw ? Buffer.from(raw, 'base64') : null;
    this.kid = config.get('PAYMENTS_CREDENTIALS_KEY_ID', { infer: true });
  }

  get configured(): boolean {
    return this.key !== null;
  }

  seal(plain: string, context: string): SealedValue {
    const key = this.requireKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, key, iv, {
      authTagLength: TAG_BYTES,
    });
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return {
      kid: this.kid,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ct: ct.toString('base64'),
    };
  }

  /** Throws on a wrong key, a wrong context or any tampering. */
  open(sealed: SealedValue, context: string): string {
    const key = this.requireKey();
    if (sealed.kid !== this.kid) {
      throw new Error(
        `payment credential sealed with key "${sealed.kid}", server has "${this.kid}"`,
      );
    }
    const tag = Buffer.from(sealed.tag, 'base64');
    if (tag.length !== TAG_BYTES) {
      throw new Error('payment credential has a malformed authentication tag');
    }
    const decipher = createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(sealed.iv, 'base64'),
      { authTagLength: TAG_BYTES },
    );
    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(Buffer.from(sealed.ct, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  private requireKey(): Buffer {
    if (!this.key) {
      throw serviceUnavailable(
        'CREDENTIALS_NOT_CONFIGURED',
        'Payment credentials cannot be stored on this server yet. Please ask the tech team to set the encryption key.',
      );
    }
    return this.key;
  }
}

/** The associated data for one secret: its row, provider and field. */
export const sealContext = (
  rowId: string,
  provider: string,
  field: string,
): string => `vistaar-payment-credential:${rowId}:${provider}:${field}`;
