import { createHash, randomBytes } from 'node:crypto';

import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { apiError, badRequest, unauthorized } from '@common/errors/api-error';
import { normalizeMobile } from '@common/utils/phone.util';
import { PartnerTokenService } from '@core/auth/partner-token.service';
import type { Env } from '@config/env.schema';
import {
  AgentsService,
  type AgentRecord,
} from '@modules/agents/services/agents.service';
import { PiiService } from '@modules/spine/services/pii.service';

import {
  checkBeforeSend,
  checkBeforeVerify,
  type AccountCheck,
  type OtpIntent,
} from '../auth.domain';
import type { OtpSentDto, SessionDto } from '../dto/auth.dto';
import { SessionRepository } from '../repositories/session.repository';
import { OtpService } from './otp.service';

const RESEND_AFTER_SECONDS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

/**
 * Phone + OTP login. The partner record is created when the OTP is asked for
 * (`otp_verified: false`); verifying it gives the `VST-` id, links the person
 * on `piis`, and issues our own session — partners are not SSO users.
 */
@Injectable()
export class AuthService {
  private readonly refreshTtlMs: number;

  constructor(
    private readonly otp: OtpService,
    private readonly agents: AgentsService,
    private readonly piis: PiiService,
    private readonly tokens: PartnerTokenService,
    private readonly sessions: SessionRepository,
    config: ConfigService<Env, true>,
  ) {
    this.refreshTtlMs =
      config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true }) * DAY_MS;
  }

  async sendOtp(
    rawPhone: string,
    countryCode: string,
    resend: boolean,
    intent: OtpIntent,
  ): Promise<OtpSentDto> {
    const phone = this.phone(rawPhone);
    const existing = await this.agents.findByPhone(phone, countryCode);
    this.refuseAccount(checkBeforeSend(intent, existing));
    // Only signup creates the record; login sends to a partner who exists.
    const agent =
      existing ?? (await this.agents.registerOtpRequest(phone, countryCode));
    this.refuseBlocked(agent);
    await this.otp.send(phone, countryCode, resend);
    return { sent: true, resend_after_seconds: RESEND_AFTER_SECONDS };
  }

  async verifyOtp(
    rawPhone: string,
    countryCode: string,
    otp: string,
    userAgent: string | null,
    intent: OtpIntent,
  ): Promise<SessionDto> {
    const phone = this.phone(rawPhone);
    const agent = await this.agents.findByPhone(phone, countryCode);
    if (!agent) {
      throw badRequest(
        'OTP_NOT_REQUESTED',
        'Please ask for an OTP for this number first.',
      );
    }

    this.refuseAccount(checkBeforeVerify(intent, agent));
    await this.otp.verify(phone, countryCode, otp);
    this.refuseBlocked(agent);

    // Only the first verify touches the shared `piis`; later logins reuse the link.
    const piiId =
      agent.otp_verified && agent.pii_id
        ? agent.pii_id
        : (await this.piis.resolve(phone, countryCode)).pii_id;
    const verified = await this.agents.completeVerification(agent, piiId);

    return this.openSession(verified, userAgent);
  }

  async refresh(
    refreshToken: string,
    userAgent: string | null,
  ): Promise<SessionDto> {
    const session = await this.sessions.consume(hashToken(refreshToken));
    if (!session)
      throw unauthorized(
        'SESSION_INVALID',
        'You have been signed out. Please log in again.',
      );

    const agent = await this.agents.require(session.agent_ref);
    if (!agent.otp_verified || !agent.is_active) {
      throw unauthorized(
        'SESSION_INVALID',
        'You have been signed out. Please log in again.',
      );
    }
    this.refuseBlocked(agent);
    await this.agents.touchLogin(agent._id);
    return this.openSession(agent, userAgent ?? session.user_agent);
  }

  async logout(
    agentRef: string,
    refreshToken: string,
  ): Promise<{ signed_out: true }> {
    await this.sessions.remove(hashToken(refreshToken), agentRef);
    return { signed_out: true };
  }

  private async openSession(
    agent: AgentRecord,
    userAgent: string | null,
  ): Promise<SessionDto> {
    if (!agent.agent_id || !agent.pii_id) {
      // Unreachable once verification completed; a guard against a half-written row.
      throw unauthorized(
        'SESSION_INVALID',
        'You have been signed out. Please log in again.',
      );
    }
    const refreshToken = randomBytes(32).toString('base64url');
    const now = new Date();
    await this.sessions.create({
      _id: hashToken(refreshToken),
      agent_ref: agent._id,
      created_at: now,
      expires_at: new Date(now.getTime() + this.refreshTtlMs),
      user_agent: userAgent ? userAgent.slice(0, 200) : null,
    });

    return {
      access_token: this.tokens.sign({
        sub: agent._id,
        agent_id: agent.agent_id,
        pii_id: agent.pii_id,
      }),
      refresh_token: refreshToken,
      token_type: 'Bearer',
      expires_in: this.tokens.ttlSeconds,
      agent: {
        agent_id: agent.agent_id,
        pii_id: agent.pii_id,
        stage: agent.stage,
        is_approved: agent.is_approved,
        onboarding_id: agent.onboarding_id,
      },
    };
  }

  private phone(raw: string): string {
    const phone = normalizeMobile(raw);
    if (!phone)
      throw badRequest(
        'INVALID_PHONE',
        'Please enter a valid 10-digit mobile number.',
      );
    return phone;
  }

  /** The other door, said plainly — the app shows "Join Vistaar" or "Log in" from the code. */
  private refuseAccount(check: AccountCheck): void {
    if (check === 'not_found') {
      throw apiError(
        HttpStatus.NOT_FOUND,
        'ACCOUNT_NOT_FOUND',
        'There is no Vistaar account with this number. Tap Join Vistaar to sign up.',
      );
    }
    if (check === 'exists') {
      throw apiError(
        HttpStatus.CONFLICT,
        'ACCOUNT_EXISTS',
        'This number already has a Vistaar account. Please log in instead.',
      );
    }
  }

  private refuseBlocked(agent: AgentRecord): void {
    if (agent.stage === 'blocked' || !agent.is_active) {
      throw apiError(
        HttpStatus.FORBIDDEN,
        'ACCOUNT_BLOCKED',
        'Your account is blocked. Please contact Katyayani support.',
      );
    }
  }
}
