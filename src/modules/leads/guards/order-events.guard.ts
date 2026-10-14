import { timingSafeEqual } from 'node:crypto';

import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { serviceUnavailable } from '@common/errors/api-error';
import type { Env } from '@config/env.schema';

export const ORDER_EVENTS_HEADER = 'x-webhook-secret';

/**
 * The order service's calls carry a shared secret (ORDER_EVENTS_SECRET), as
 * ko-sales' own order webhooks do. Unset = the route is off (503), so a
 * server without it never accepts a call.
 */
@Injectable()
export class OrderEventsGuard implements CanActivate {
  constructor(private readonly config: ConfigService<Env, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const secret = this.config.get('ORDER_EVENTS_SECRET', { infer: true });
    if (!secret) {
      throw serviceUnavailable(
        'ORDER_EVENTS_NOT_CONFIGURED',
        'Order events are not set up on this server.',
      );
    }
    const sent = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, unknown> }>().headers[
      ORDER_EVENTS_HEADER
    ];
    const a = Buffer.from(typeof sent === 'string' ? sent : '');
    const b = Buffer.from(secret);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      // Framework 401 → `UNAUTHORIZED`, as the auth guard answers a bad token.
      throw new UnauthorizedException('Invalid webhook secret.');
    }
    return true;
  }
}
