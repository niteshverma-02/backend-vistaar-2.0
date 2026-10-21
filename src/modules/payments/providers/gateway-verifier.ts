import { Injectable, Logger } from '@nestjs/common';

import type { CredentialMode } from '../payment-credentials.domain';
import type { PaymentProvider } from '../payments.domain';

export interface VerifyResult {
  ok: boolean;
  /** A sentence HO can act on; never echoes a secret or the gateway's raw body. */
  message: string;
}

const TIMEOUT_MS = 10_000;

/**
 * The gateway endpoints, fixed in code: HO enters keys, never a URL, so the
 * check cannot be pointed at another server to collect them.
 */
const ENDPOINTS = {
  /** Public and key-only: answers for a Key ID with no secret. */
  razorpay: 'https://api.razorpay.com/v1/preferences',
  cashfree: {
    live: 'https://api.cashfree.com/pg/orders/vistaar-credential-check',
    test: 'https://sandbox.cashfree.com/pg/orders/vistaar-credential-check',
  },
  phonepe: {
    live: 'https://api.phonepe.com/apis/identity-manager/v1/oauth/token',
    test: 'https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token',
  },
} as const;

/**
 * Proves a set of keys opens the merchant account, with a call that reads or
 * mints a token and never moves money. The webhook secret cannot be checked
 * this way; the first real webhook does that.
 */
@Injectable()
export class GatewayVerifier {
  private readonly logger = new Logger(GatewayVerifier.name);

  async verify(
    provider: PaymentProvider,
    mode: CredentialMode,
    fields: Record<string, string>,
  ): Promise<VerifyResult> {
    try {
      switch (provider) {
        case 'razorpay':
          return await this.razorpay(fields);
        case 'cashfree':
          return await this.cashfree(mode, fields);
        case 'phonepe':
          return await this.phonepe(mode, fields);
      }
    } catch (error) {
      // The error is from fetch (timeout, DNS) — it holds no key.
      this.logger.warn(`${provider} credential check failed: ${String(error)}`);
      return {
        ok: false,
        message: `${label(provider)} could not be reached. Please try the check again in a minute.`,
      };
    }
  }

  private async razorpay(
    fields: Record<string, string>,
  ): Promise<VerifyResult> {
    // Key ID only: Razorpay's public preferences call says whether the key
    // exists and is active — the same check My Mali's checkout preflight uses.
    const url = `${ENDPOINTS.razorpay}?key_id=${encodeURIComponent(fields.key_id)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    return this.read('razorpay', res.status, res.ok);
  }

  private async cashfree(
    mode: CredentialMode,
    fields: Record<string, string>,
  ): Promise<VerifyResult> {
    const res = await fetch(ENDPOINTS.cashfree[mode], {
      headers: {
        'x-client-id': fields.app_id,
        'x-client-secret': fields.secret_key,
        'x-api-version': '2023-08-01',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // A made-up order id: 404 means the keys were accepted.
    return this.read('cashfree', res.status, res.ok || res.status === 404);
  }

  private async phonepe(
    mode: CredentialMode,
    fields: Record<string, string>,
  ): Promise<VerifyResult> {
    const res = await fetch(ENDPOINTS.phonepe[mode], {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: fields.client_id,
        client_version: fields.client_version,
        client_secret: fields.client_secret,
        grant_type: 'client_credentials',
      }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return this.read('phonepe', res.status, res.ok);
  }

  private read(
    provider: PaymentProvider,
    status: number,
    accepted: boolean,
  ): VerifyResult {
    if (accepted) {
      return { ok: true, message: `${label(provider)} accepted these keys.` };
    }
    if (status === 400 || status === 401 || status === 403) {
      return {
        ok: false,
        message: `${label(provider)} refused these keys. Check they are copied fully and are for the chosen mode.`,
      };
    }
    this.logger.warn(`${provider} credential check answered ${status}`);
    return {
      ok: false,
      message: `${label(provider)} answered with an error (${status}). Please try the check again later.`,
    };
  }
}

const LABELS: Record<PaymentProvider, string> = {
  razorpay: 'Razorpay',
  cashfree: 'Cashfree',
  phonepe: 'PhonePe',
};
const label = (p: PaymentProvider): string => LABELS[p];
