import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';

import type { AdminAccess, AccessService } from '../services/access.service';
import { CapabilityGuard } from './capability.guard';

function guard(access: Partial<AdminAccess>, needed: string) {
  const service = {
    accessFor: jest.fn().mockResolvedValue({
      email: 'x@katyayaniorganics.com',
      role: 'admin',
      capabilities: [],
      ...access,
    }),
  };
  const reflector = { get: jest.fn().mockReturnValue(needed) };
  const context = {
    switchToHttp: () => ({
      getRequest: () => ({
        user: { kind: 'admin', email: 'x', iat: 1, exp: 2 },
      }),
    }),
    getHandler: () => undefined,
  } as unknown as ExecutionContext;
  return new CapabilityGuard(
    service as unknown as AccessService,
    reflector as unknown as Reflector,
  ).canActivate(context);
}

describe('CapabilityGuard', () => {
  it('lets in a person whose own list has the capability', async () => {
    await expect(
      guard({ capabilities: ['payments.credentials'] }, 'payments.credentials'),
    ).resolves.toBe(true);
  });

  it('refuses a capability withheld from the person, even though their role has it', async () => {
    await expect(
      guard(
        { role: 'admin', capabilities: ['payments.write'] },
        'payments.credentials',
      ),
    ).rejects.toMatchObject({
      status: 403,
      response: { error: 'ROLE_NOT_ALLOWED' },
    });
  });

  it('refuses an SSO user with no Vistaar role', async () => {
    await expect(guard({ role: null }, 'payments.read')).rejects.toMatchObject({
      response: { error: 'NO_ADMIN_ACCESS' },
    });
  });
});
