import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { badRequest } from '@common/errors/api-error';
import type { Env } from '@config/env.schema';
import { OtpService } from '@modules/auth/services/otp.service';

import { leadOtpKey, readLeadOtp, signLeadOtp } from '../lead-otp.domain';

const COUNTRY_CODE = '+91';

/**
 * The farmer's OTP on lead add: sent and checked through the same SMS
 * service and limits as sign-in (own attempt counts), answered with a
 * 15-minute token that `POST /leads` requires.
 */
@Injectable()
export class LeadOtpService {
  private readonly key: Buffer;

  constructor(
    private readonly otp: OtpService,
    config: ConfigService<Env, true>,
  ) {
    this.key = leadOtpKey(config.get('VISTAAR_JWT_SECRET', { infer: true }));
  }

  /** `phone`: ten digits, already normalised. */
  send(phone: string, resend: boolean): Promise<void> {
    return this.otp.send(phone, COUNTRY_CODE, resend, 'lead');
  }

  /** Throws `OTP_INVALID` / `OTP_LIMIT` / `OTP_UNAVAILABLE` as sign-in does. */
  async verify(
    agentId: string,
    phone: string,
    otp: string,
    now = new Date(),
  ): Promise<{ otp_token: string; expires_at: Date }> {
    await this.otp.verify(phone, COUNTRY_CODE, otp, 'lead');
    return signLeadOtp(this.key, {
      agent_id: agentId,
      phone,
      verified_at: now,
    });
  }

  /** When the farmer's phone was verified for this partner — or a 400 the app can act on. */
  check(
    agentId: string,
    phone: string,
    token: string | undefined,
    now = new Date(),
  ): Date {
    if (!token) {
      throw badRequest(
        'LEAD_OTP_REQUIRED',
        'Verify the farmer’s mobile with an OTP before saving.',
      );
    }
    const verdict = readLeadOtp(
      this.key,
      token,
      { agent_id: agentId, phone },
      now,
    );
    if (verdict.ok) return verdict.verified_at;
    throw badRequest(
      'LEAD_OTP_INVALID',
      verdict.reason === 'expired'
        ? 'The farmer’s OTP check has expired. Please verify the mobile again.'
        : 'Verify this farmer’s mobile with an OTP again before saving.',
      [`reason=${verdict.reason}`],
    );
  }
}
