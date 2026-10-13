import {
  createParamDecorator,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';

import type { AuthedRequest } from '@common/interfaces/principal.interface';

/**
 * The calling partner's `VST-` id, from the partner token `AppAuthGuard`
 * verified — never from a header, the body, the query or a path param, so a
 * partner cannot name another partner.
 */
export const CurrentPartnerId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const user = context.switchToHttp().getRequest<AuthedRequest>().user;
    if (user?.kind !== 'partner' || !user.agent_id) {
      throw new UnauthorizedException(
        'Your session has ended. Please sign in again.',
      );
    }
    return user.agent_id;
  },
);

/** The calling partner as the token names them: their `VST-` id and their own person. */
export interface PartnerRef {
  agent_id: string;
  /** The partner's own `piis` row — what a shop-stock cart is filed under. */
  pii_id: string;
}

/** `CurrentPartnerId`, plus the partner's `pii_id`, from the same verified token. */
export const CurrentPartner = createParamDecorator(
  (_data: unknown, context: ExecutionContext): PartnerRef => {
    const user = context.switchToHttp().getRequest<AuthedRequest>().user;
    if (user?.kind !== 'partner' || !user.agent_id || !user.pii_id) {
      throw new UnauthorizedException(
        'Your session has ended. Please sign in again.',
      );
    }
    return { agent_id: user.agent_id, pii_id: user.pii_id };
  },
);
