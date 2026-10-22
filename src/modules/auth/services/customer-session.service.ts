import { HttpStatus, Injectable, Logger } from '@nestjs/common';

import {
  apiError,
  conflict,
  tooMany,
  unauthorized,
  unavailable,
} from '@common/errors/api-error';
import type { PartnerPrincipal } from '@common/interfaces/principal.interface';
import { AgentsService } from '@modules/agents/services/agents.service';

import type { CustomerSessionDto } from '../dto/customer-session.dto';
import {
  CustomerPassError,
  KoSalesCustomerClient,
  type CustomerDevice,
} from '../providers/ko-sales-customer.client';

/**
 * The partner's ko-sales customer pass (Customer Session Phase 2, path 2).
 * The partner's Vistaar token proves this server already checked their OTP,
 * so it asks ko-sales for a pass for the partner's own phone and hands the
 * pair to the app. The app refreshes it on ko-sales itself and comes back
 * here only when ko-sales refuses the long pass.
 *
 * The pass must belong to the person the partner already is: a pass for any
 * other `pii_id`, or one ko-sales made a new customer for, is ended at once
 * and never handed out.
 */
@Injectable()
export class CustomerSessionService {
  private readonly logger = new Logger(CustomerSessionService.name);

  constructor(
    private readonly agents: AgentsService,
    private readonly koSales: KoSalesCustomerClient,
  ) {}

  async open(
    partner: PartnerPrincipal,
    device: CustomerDevice,
  ): Promise<CustomerSessionDto> {
    if (!this.koSales.enabled) {
      throw unavailable(
        'CUSTOMER_SESSION_OFF',
        'Katyayani customer login is not switched on for Vistaar yet.',
      );
    }

    const agent = await this.agents.require(partner.sub);
    if (!agent.otp_verified || !agent.pii_id) {
      throw unauthorized(
        'SESSION_INVALID',
        'You have been signed out. Please log in again.',
      );
    }
    if (agent.stage === 'blocked' || !agent.is_active) {
      throw apiError(
        HttpStatus.FORBIDDEN,
        'ACCOUNT_BLOCKED',
        'Your account is blocked. Please contact Katyayani support.',
      );
    }

    let pair;
    try {
      pair = await this.koSales.open(agent.phone, device);
    } catch (error) {
      if (error instanceof CustomerPassError) throw refusal(error);
      throw error;
    }

    if (pair.pii_id !== agent.pii_id || pair.is_new_customer) {
      this.logger.error(
        `Customer pass for ${agent.agent_id} named ${pair.pii_id}` +
          `${pair.is_new_customer ? ' (new customer)' : ''}, partner is ${agent.pii_id} — login ended`,
      );
      await this.koSales.logout(pair.refresh_token);
      throw conflict(
        'CUSTOMER_SESSION_MISMATCH',
        'Your number is linked to a different Katyayani customer record. Please contact Katyayani support.',
      );
    }

    return {
      access_token: pair.access_token,
      refresh_token: pair.refresh_token,
      token_type: 'Bearer',
      expires_in: pair.expires_in,
      refresh_expires_in: pair.refresh_expires_in,
      pii_id: pair.pii_id,
      phone: agent.phone,
    };
  }
}

function refusal(error: CustomerPassError) {
  switch (error.reason) {
    case 'platform_off':
      return unavailable(
        'CUSTOMER_SESSION_OFF',
        'Katyayani customer login is switched off for Vistaar right now.',
      );
    case 'busy':
      return tooMany(
        'CUSTOMER_SESSION_BUSY',
        'Katyayani customer login is busy. Please try again in a minute.',
      );
    case 'duplicate_pii':
      return conflict(
        'CUSTOMER_SESSION_MISMATCH',
        'Your number is on two Katyayani customer records. Please contact Katyayani support.',
      );
    default:
      return unavailable(
        'CUSTOMER_SESSION_UNAVAILABLE',
        'Katyayani customer login is not reachable right now. Please try again in a minute.',
      );
  }
}
