import type { ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import type { Env } from '@config/env.schema';

import { OrderEventsGuard } from './order-events.guard';

const SECRET = 's3cret-for-order-events-123';

const guardWith = (secret?: string) =>
  new OrderEventsGuard({
    get: () => secret,
  } as unknown as ConfigService<Env, true>);

const call = (header?: string) =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({
        headers: header === undefined ? {} : { 'x-webhook-secret': header },
      }),
    }),
  }) as unknown as ExecutionContext;

const statusOf = (fn: () => unknown): number => {
  try {
    fn();
  } catch (error) {
    return (error as { getStatus: () => number }).getStatus();
  }
  return 200;
};

describe('OrderEventsGuard', () => {
  it('lets the order service in with the shared secret only', () => {
    const guard = guardWith(SECRET);
    expect(guard.canActivate(call(SECRET))).toBe(true);
    expect(statusOf(() => guard.canActivate(call('wrong')))).toBe(401);
    expect(statusOf(() => guard.canActivate(call()))).toBe(401);
  });

  it('is off (503) on a server with no secret', () => {
    expect(statusOf(() => guardWith(undefined).canActivate(call(SECRET)))).toBe(
      503,
    );
  });
});
