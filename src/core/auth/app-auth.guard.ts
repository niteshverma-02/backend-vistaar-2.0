import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { IS_ADMIN_KEY } from '@common/decorators/admin-api.decorator';
import { IS_PUBLIC_KEY } from '@common/decorators/public.decorator';
import type { AuthedRequest } from '@common/interfaces/principal.interface';

import { PartnerTokenService } from './partner-token.service';
import { SsoTokenVerifier, SsoUnavailableError } from './sso-token.verifier';

/**
 * The one global guard. Every route is protected unless marked `@Public()`.
 * An `@AdminApi()` route accepts only the company SSO token; every other route
 * accepts only a partner token. The two never substitute for each other.
 */
@Injectable()
export class AppAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly partnerTokens: PartnerTokenService,
    private readonly sso: SsoTokenVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<AuthedRequest & { headers: Record<string, unknown> }>();
    const token = bearer(request.headers.authorization);
    if (!token) throw new UnauthorizedException('Please log in to continue.');

    if (this.reflector.getAllAndOverride<boolean>(IS_ADMIN_KEY, targets)) {
      let admin;
      try {
        admin = await this.sso.verify(token);
      } catch (error) {
        if (error instanceof SsoUnavailableError) {
          throw new ServiceUnavailableException(
            'Login is not working right now. Please try again in a few minutes.',
          );
        }
        throw error;
      }
      if (!admin)
        throw new UnauthorizedException(
          'You have been signed out. Please log in again.',
        );
      request.user = admin;
      return true;
    }

    const partner = this.partnerTokens.verify(token);
    if (!partner)
      throw new UnauthorizedException(
        'You have been signed out. Please log in again.',
      );
    request.user = partner;
    return true;
  }
}

function bearer(header: unknown): string | null {
  if (typeof header !== 'string') return null;
  const [scheme, value] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && value ? value.trim() : null;
}
