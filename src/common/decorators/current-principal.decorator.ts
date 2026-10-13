import {
  createParamDecorator,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';

import type {
  AdminPrincipal,
  AuthedRequest,
  PartnerPrincipal,
} from '../interfaces/principal.interface';

/** The verified partner — the only source of "who" on a partner route. */
export const CurrentPartner = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): PartnerPrincipal => {
    const user = ctx.switchToHttp().getRequest<AuthedRequest>().user;
    if (user?.kind !== 'partner') {
      throw new UnauthorizedException(
        'Please sign in to the Vistaar app to continue.',
      );
    }
    return user;
  },
);

/** The verified HO user — only valid on an `@AdminApi()` route. */
export const CurrentAdmin = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AdminPrincipal => {
    const user = ctx.switchToHttp().getRequest<AuthedRequest>().user;
    if (user?.kind !== 'admin') {
      throw new UnauthorizedException(
        'Please sign in to the HO portal to continue.',
      );
    }
    return user;
  },
);
