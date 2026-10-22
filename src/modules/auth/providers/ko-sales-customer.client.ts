import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '@config/env.schema';

/** ko-sales answers `/customer/auth/*` well inside this; a slower call is treated as down. */
const REQUEST_TIMEOUT_MS = 10_000;

/** ko-sales' TokenPair (Customer Session Phase 2, MASTER §12). */
export interface CustomerPassPair {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_expires_in: number;
  pii_id: string;
  is_new_customer: boolean;
}

export interface CustomerDevice {
  device_id?: string;
  device_name?: string;
}

/**
 * Why ko-sales did not hand out a pass, as MASTER Part C's error table names
 * them:
 * - `key_refused` — 401 on temp-code: the platform key is wrong or was regenerated;
 * - `platform_off` — 403: the admin switched the platform off;
 * - `busy` — 429: over the platform's temp codes a minute;
 * - `duplicate_pii` — 401 "Multiple accounts…": the phone is on two customer records;
 * - `code_refused` — any other 401 on token: the temp code expired or was used;
 * - `unavailable` — no answer, a timeout, a 5xx, a 404 (route not deployed) or a 400.
 */
export type CustomerPassFailure =
  | 'key_refused'
  | 'platform_off'
  | 'busy'
  | 'duplicate_pii'
  | 'code_refused'
  | 'unavailable';

export class CustomerPassError extends Error {
  constructor(
    readonly reason: CustomerPassFailure,
    readonly status: number | null,
  ) {
    super(
      `ko-sales customer session: ${reason} (HTTP ${status ?? 'no answer'})`,
    );
  }
}

/**
 * ko-sales' Customer Session login, path 2 (MASTER §5): our own OTP already
 * proved the phone, so this server asks ko-sales (`B2B_API_URL`) for a
 * 2-minute temp code with the platform key and spends it on a pass pair at
 * once. The key never leaves this server and is never logged.
 */
@Injectable()
export class KoSalesCustomerClient {
  private readonly logger = new Logger(KoSalesCustomerClient.name);
  private readonly base: string;
  private readonly key: string;
  /** The platform the key was made for: `kp.<platform>.<secret>`. */
  private readonly platform: string;

  constructor(config: ConfigService<Env, true>) {
    this.base = config.get('B2B_API_URL', { infer: true }).replace(/\/+$/, '');
    this.key = config.get('KATYAYANI_PLATFORM_KEY', { infer: true });
    this.platform = this.key.split('.')[1] ?? '';
  }

  /** False until the admin's key is in `KATYAYANI_PLATFORM_KEY`. */
  get enabled(): boolean {
    return this.key !== '';
  }

  /** Temp code, then token — a pass pair for [phone] (ten digits). */
  async open(phone: string, device: CustomerDevice): Promise<CustomerPassPair> {
    const code = await this.post(
      '/customer/auth/temp-code',
      { phone },
      { 'x-platform-key': this.key },
    );
    if (!code.ok) throw this.failure('temp-code', code);
    const tempCode = stringField(code.body, 'temp_code');
    if (!tempCode) throw this.malformed('temp-code');

    const token = await this.post('/customer/auth/token', {
      grant_type: 'temp_code',
      platform: this.platform,
      phone,
      temp_code: tempCode,
      ...(device.device_id ? { device_id: device.device_id } : {}),
      ...(device.device_name ? { device_name: device.device_name } : {}),
    });
    if (!token.ok) throw this.failure('token', token);
    const pair = pairOf(token.body);
    if (!pair) throw this.malformed('token');
    return pair;
  }

  /** Ends that login on ko-sales. Best effort: a failure is logged, never thrown. */
  async logout(refreshToken: string): Promise<void> {
    const res = await this.post('/customer/auth/logout', {
      refresh_token: refreshToken,
    });
    if (!res.ok) {
      this.logger.warn(
        `Customer session logout failed: HTTP ${res.status ?? 'no answer'}`,
      );
    }
  }

  private failure(step: 'temp-code' | 'token', res: Answer): CustomerPassError {
    const { status } = res;
    let reason: CustomerPassFailure = 'unavailable';
    if (status === 403) reason = 'platform_off';
    else if (status === 429) reason = 'busy';
    else if (status === 401 && step === 'temp-code') reason = 'key_refused';
    else if (status === 401) {
      reason = /multiple accounts/i.test(messageOf(res.body))
        ? 'duplicate_pii'
        : 'code_refused';
    }
    const line = `Customer session ${step} refused: HTTP ${status ?? 'no answer'} → ${reason}`;
    // A refused key fails every partner until someone puts the new one in the env.
    if (reason === 'key_refused') this.logger.error(line);
    else this.logger.warn(line);
    return new CustomerPassError(reason, status);
  }

  private malformed(step: string): CustomerPassError {
    this.logger.warn(
      `Customer session ${step}: answer without the expected fields`,
    );
    return new CustomerPassError('unavailable', 200);
  }

  /** `status: null` on a transport failure; the body is parsed when it is JSON. */
  private async post(
    path: string,
    payload: Record<string, string>,
    headers: Record<string, string> = {},
  ): Promise<Answer> {
    try {
      const res = await fetch(`${this.base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const body: unknown = await res.json().catch(() => null);
      return { ok: res.ok, status: res.status, body };
    } catch (error) {
      this.logger.warn(`ko-sales unreachable (${path}): ${String(error)}`);
      return { ok: false, status: null, body: null };
    }
  }
}

interface Answer {
  ok: boolean;
  status: number | null;
  body: unknown;
}

const asRecord = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;

const stringField = (body: unknown, key: string): string | null => {
  const v = asRecord(body)?.[key];
  return typeof v === 'string' && v !== '' ? v : null;
};

/** ko-sales' error `message` is a sentence or, on validation, a list of them. */
const messageOf = (body: unknown): string => {
  const m = asRecord(body)?.message;
  return Array.isArray(m) ? m.join('; ') : typeof m === 'string' ? m : '';
};

function pairOf(body: unknown): CustomerPassPair | null {
  const b = asRecord(body);
  const access = stringField(b, 'access_token');
  const refresh = stringField(b, 'refresh_token');
  const piiId = stringField(b, 'pii_id');
  if (!b || !access || !refresh || !piiId) return null;
  const seconds = (v: unknown, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) && v > 0
      ? Math.trunc(v)
      : fallback;
  return {
    access_token: access,
    refresh_token: refresh,
    expires_in: seconds(b.expires_in, 3600),
    refresh_expires_in: seconds(b.refresh_expires_in, 30 * 24 * 3600),
    pii_id: piiId,
    is_new_customer: b.is_new_customer === true,
  };
}
