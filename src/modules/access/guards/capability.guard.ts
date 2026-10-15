import {
  applyDecorators,
  HttpStatus,
  Injectable,
  SetMetadata,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiBearerAuth, ApiForbiddenResponse } from '@nestjs/swagger';

import { AdminApi } from '@common/decorators/admin-api.decorator';
import { apiError } from '@common/errors/api-error';
import type { AuthedRequest } from '@common/interfaces/principal.interface';

import type { Capability } from '../access.domain';
import { AccessService } from '../services/access.service';

export const REQUIRES = 'vistaar:requires';

/**
 * Runs after the global auth guard has verified the SSO token: resolves the
 * caller's role and checks the route's capability. 403 `NO_ADMIN_ACCESS` for
 * an SSO user with no Vistaar role, `ROLE_NOT_ALLOWED` for one whose role
 * lacks this capability.
 */
@Injectable()
export class CapabilityGuard implements CanActivate {
  constructor(
    private readonly access: AccessService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const user = context.switchToHttp().getRequest<AuthedRequest>().user;
    if (user?.kind !== 'admin') return false;

    const access = await this.access.accessFor(user);
    if (!access.role) {
      throw apiError(
        HttpStatus.FORBIDDEN,
        'NO_ADMIN_ACCESS',
        'Your account does not have access to Vistaar. Please ask your admin for access.',
      );
    }

    const needed = this.reflector.get<Capability | undefined>(
      REQUIRES,
      context.getHandler(),
    );
    // The person's own list, so a capability withheld from them by name holds too.
    if (needed && !access.capabilities.includes(needed)) {
      throw apiError(
        HttpStatus.FORBIDDEN,
        'ROLE_NOT_ALLOWED',
        'Your role does not allow this action. Please ask your admin if you need it.',
      );
    }
    return true;
  }
}

/**
 * An HO-portal route: SSO token, a Vistaar role, and — when given — the
 * capability. Put it on every `/admin/*` handler.
 */
export const Can = (capability?: Capability) =>
  applyDecorators(
    AdminApi(),
    ApiBearerAuth(),
    ApiForbiddenResponse({
      description: '`NO_ADMIN_ACCESS` or `ROLE_NOT_ALLOWED`',
    }),
    ...(capability ? [SetMetadata(REQUIRES, capability)] : []),
    UseGuards(CapabilityGuard),
  );
