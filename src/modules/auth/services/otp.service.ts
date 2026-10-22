import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { tooMany, unauthorized, unavailable } from '@common/errors/api-error';
import type { Env } from '@config/env.schema';

import { OtpAttemptRepository } from '../repositories/otp-attempt.repository';

const TEN_MINUTES = 10 * 60 * 1000;
/** 3 SMS per number per 10 minutes, sends and resends together. */
const SEND_LIMIT = 3;
/** 5 guesses per number per 10 minutes — a 4-digit code has 10,000. */
const VERIFY_LIMIT = 5;
const ONE_DAY = 24 * 60 * 60 * 1000;
/** 15 guesses per number per day — without it, 5 per 10 min is ~720 a day. */
const VERIFY_DAILY_LIMIT = 15;
const SUCCESS_MESSAGE = 'OTP verified successfully';

/**
 * Whose OTP it is: a partner signing in (`login`) or a farmer a partner adds
 * (`lead`). Each keeps its own attempt counts, so a partner verifying farmers
 * never uses up their own sign-in tries — the limits are the same.
 */
export type OtpScope = 'login' | 'lead';

/** `send:<phone>` for sign-in, as it always was; `lead-send:<phone>` for a farmer. */
export const attemptKey = (
  scope: OtpScope,
  kind: 'send' | 'verify',
  phone: string,
): string =>
  scope === 'login' ? `${kind}:${phone}` : `${scope}-${kind}:${phone}`;

/**
 * The OTP round trip through the company utilities service
 * (`utils.ko-tech.in`, MSG91 behind it). This service — never the app —
 * calls it, so "the phone is verified" is something we saw ourselves.
 *
 * The provider answers a wrong, expired or already-used code with 401 and
 * `{ error, data: { type: 'error', message } }`, and a good one with 2xx —
 * see `verdictOf` for how the two are told apart.
 */
@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);
  private readonly base: string;
  private readonly timeoutMs: number;
  private readonly testNumbers: ReadonlySet<string>;
  private readonly testCode?: string;

  constructor(
    config: ConfigService<Env, true>,
    /** Shared by every server process, so the limits hold with many. */
    private readonly attempts: OtpAttemptRepository,
  ) {
    this.base = config.get('OTP_API_URL', { infer: true }).replace(/\/+$/, '');
    this.timeoutMs = config.get('OTP_TIMEOUT_MS', { infer: true });
    this.testNumbers = new Set(
      config
        .get('OTP_TEST_NUMBERS', { infer: true })
        .split(',')
        .map((n) => n.trim())
        .filter(Boolean),
    );
    this.testCode = config.get('OTP_TEST_CODE', { infer: true });
  }

  async send(
    phone: string,
    countryCode: string,
    resend: boolean,
    scope: OtpScope = 'login',
  ): Promise<void> {
    const wait = await this.attempts.take(
      attemptKey(scope, 'send', phone),
      SEND_LIMIT,
      TEN_MINUTES,
      new Date(),
    );
    if (wait) {
      throw tooMany(
        'OTP_LIMIT',
        `You have asked for too many OTPs. Please wait ${wait} seconds and try again.`,
        [`retry_after_seconds=${wait}`],
      );
    }
    if (this.isTestNumber(phone)) return;

    const res = await this.post(resend ? '/otp/resend' : '/otp/send', {
      number: phone,
      countryCode,
    });
    if (!res || !res.ok) {
      this.logger.warn(
        `OTP ${resend ? 'resend' : 'send'} failed: HTTP ${res?.status ?? 'no answer'}`,
      );
      throw unavailable(
        'OTP_UNAVAILABLE',
        'We could not send the OTP right now. Please try again in a minute.',
      );
    }
  }

  /** Resolves on a correct OTP; throws `OTP_INVALID` (401) or `OTP_UNAVAILABLE` (503). */
  async verify(
    phone: string,
    countryCode: string,
    otp: string,
    scope: OtpScope = 'login',
  ): Promise<void> {
    const key = attemptKey(scope, 'verify', phone);
    const wait = await this.attempts.take(
      key,
      VERIFY_LIMIT,
      TEN_MINUTES,
      new Date(),
    );
    if (wait) {
      throw tooMany(
        'OTP_LIMIT',
        `Too many wrong tries. Please wait ${wait} seconds and try again.`,
        [`retry_after_seconds=${wait}`],
      );
    }
    const dayKey = `${key}:day`;
    const dayWait = await this.attempts.take(
      dayKey,
      VERIFY_DAILY_LIMIT,
      ONE_DAY,
      new Date(),
    );
    if (dayWait) {
      throw tooMany(
        'OTP_LIMIT',
        'Too many wrong tries today. Please try again later.',
        [`retry_after_seconds=${dayWait}`],
      );
    }
    const resetAll = () =>
      Promise.all([this.attempts.reset(key), this.attempts.reset(dayKey)]);

    if (this.isTestNumber(phone)) {
      if (this.testCode && otp === this.testCode) {
        await resetAll();
        return;
      }
      throw unauthorized(
        'OTP_INVALID',
        'The OTP is wrong. Please check it and try again.',
      );
    }

    const res = await this.post('/otp/verify', {
      number: phone,
      countryCode,
      otp,
    });
    if (!res || res.status >= 500) {
      throw unavailable(
        'OTP_UNAVAILABLE',
        'We could not check the OTP right now. Please try again in a minute.',
      );
    }
    const verdict = verdictOf(res.ok, res.body);
    if (verdict !== 'refused') {
      if (verdict === 'status_only') {
        this.logger.warn(
          `OTP verify passed on HTTP ${res.status} without an otp_verified flag: ${shapeOf(res.body)}`,
        );
      }
      await resetAll();
      return;
    }
    throw unauthorized(
      'OTP_INVALID',
      /expire/i.test(providerMessage(res.body) ?? '')
        ? 'This OTP has expired. Please ask for a new OTP.'
        : 'The OTP is wrong. Please check it and try again.',
    );
  }

  private isTestNumber(phone: string): boolean {
    return this.testNumbers.has(phone);
  }

  /** `null` on a transport failure; the body is parsed when it is JSON. */
  private async post(
    path: string,
    payload: Record<string, string>,
  ): Promise<{ ok: boolean; status: number; body: unknown } | null> {
    try {
      const res = await fetch(`${this.base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const body: unknown = await res.json().catch(() => null);
      return { ok: res.ok, status: res.status, body };
    } catch (error) {
      this.logger.warn(`OTP service unreachable (${path}): ${String(error)}`);
      return null;
    }
  }
}

/**
 * `verified` on the provider's success body (HTTP 200
 * `{ message: 'OTP verified successfully' }`, seen 2026-10-09) or an explicit
 * `otp_verified: true`; `refused` on a non-2xx, `otp_verified: false`, or any
 * error marker; `status_only` for any other clean 2xx — still a pass, as
 * ko-sales and franchise-pos read it, but logged so a contract change shows.
 */
export function verdictOf(
  ok: boolean,
  body: unknown,
): 'verified' | 'status_only' | 'refused' {
  if (!ok) return 'refused';
  const b = asRecord(body);
  const data = asRecord(b?.data);
  const flag = b?.otp_verified ?? data?.otp_verified;
  if (flag === true) return 'verified';
  if (flag !== undefined) return 'refused';
  if (b?.error !== undefined || b?.type === 'error' || data?.type === 'error')
    return 'refused';
  if (b?.message === SUCCESS_MESSAGE) return 'verified';
  return 'status_only';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Keys and short status words only — enough to spot a contract change. */
function shapeOf(body: unknown): string {
  const b = asRecord(body);
  if (!b) return typeof body;
  return JSON.stringify(b, (key, value: unknown) => {
    if (typeof value === 'string')
      return key === 'type' || key === 'message'
        ? value.slice(0, 60)
        : 'string';
    return typeof value === 'number' ? 'number' : value;
  });
}

/**
 * "OTP expired" and the like, from `{ data: { message } }`. Read, never
 * shown: the provider's wording ("OTP not match") is not for a partner.
 */
function providerMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const data = (body as Record<string, unknown>).data;
  if (data && typeof data === 'object') {
    const message = (data as Record<string, unknown>).message;
    if (typeof message === 'string' && message.length < 120) return message;
  }
  return null;
}
