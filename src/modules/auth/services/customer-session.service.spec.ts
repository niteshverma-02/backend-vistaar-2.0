import type { PartnerPrincipal } from '@common/interfaces/principal.interface';
import type { AgentsService } from '@modules/agents/services/agents.service';

import {
  CustomerPassError,
  type CustomerPassPair,
  type KoSalesCustomerClient,
} from '../providers/ko-sales-customer.client';
import { CustomerSessionService } from './customer-session.service';

const partner: PartnerPrincipal = {
  kind: 'partner',
  sub: 'agent-1',
  agent_id: 'VST-000001',
  pii_id: 'PII-54018',
};

const agent = {
  _id: 'agent-1',
  agent_id: 'VST-000001',
  pii_id: 'PII-54018',
  phone: '9876543210',
  otp_verified: true,
  is_active: true,
  stage: 'active',
};

const pair = (over: Partial<CustomerPassPair> = {}): CustomerPassPair => ({
  access_token: 'eyJ.a.b',
  refresh_token: 'sid.rt',
  expires_in: 3600,
  refresh_expires_in: 2592000,
  pii_id: 'PII-54018',
  is_new_customer: false,
  ...over,
});

function build(opts: {
  enabled?: boolean;
  agent?: Record<string, unknown>;
  open?: jest.Mock;
}) {
  const koSales = {
    enabled: opts.enabled ?? true,
    open: opts.open ?? jest.fn().mockResolvedValue(pair()),
    logout: jest.fn().mockResolvedValue(undefined),
  };
  const agents = {
    require: jest.fn().mockResolvedValue(opts.agent ?? agent),
  };
  const service = new CustomerSessionService(
    agents as unknown as AgentsService,
    koSales as unknown as KoSalesCustomerClient,
  );
  return { service, koSales, agents };
}

describe('CustomerSessionService.open', () => {
  it('hands the partner their own pass, for their stored phone', async () => {
    const { service, koSales } = build({});
    await expect(
      service.open(partner, { device_id: 'dev-1' }),
    ).resolves.toEqual({
      access_token: 'eyJ.a.b',
      refresh_token: 'sid.rt',
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_expires_in: 2592000,
      pii_id: 'PII-54018',
      phone: '9876543210',
    });
    expect(koSales.open).toHaveBeenCalledWith('9876543210', {
      device_id: 'dev-1',
    });
  });

  it('answers CUSTOMER_SESSION_OFF without a platform key, asking nobody', async () => {
    const { service, koSales, agents } = build({ enabled: false });
    await expect(service.open(partner, {})).rejects.toMatchObject({
      status: 503,
      response: { error: 'CUSTOMER_SESSION_OFF' },
    });
    expect(agents.require).not.toHaveBeenCalled();
    expect(koSales.open).not.toHaveBeenCalled();
  });

  it('ends and refuses a pass for another person', async () => {
    const { service, koSales } = build({
      open: jest.fn().mockResolvedValue(pair({ pii_id: 'PII-99' })),
    });
    await expect(service.open(partner, {})).rejects.toMatchObject({
      status: 409,
      response: { error: 'CUSTOMER_SESSION_MISMATCH' },
    });
    expect(koSales.logout).toHaveBeenCalledWith('sid.rt');
  });

  it('ends and refuses a pass ko-sales made a new customer for', async () => {
    const { service, koSales } = build({
      open: jest.fn().mockResolvedValue(pair({ is_new_customer: true })),
    });
    await expect(service.open(partner, {})).rejects.toMatchObject({
      status: 409,
    });
    expect(koSales.logout).toHaveBeenCalledWith('sid.rt');
  });

  it('refuses a blocked partner before asking ko-sales', async () => {
    const { service, koSales } = build({
      agent: { ...agent, stage: 'blocked' },
    });
    await expect(service.open(partner, {})).rejects.toMatchObject({
      status: 403,
      response: { error: 'ACCOUNT_BLOCKED' },
    });
    expect(koSales.open).not.toHaveBeenCalled();
  });

  it('refuses a partner with no person linked', async () => {
    const { service } = build({ agent: { ...agent, pii_id: null } });
    await expect(service.open(partner, {})).rejects.toMatchObject({
      status: 401,
    });
  });

  it.each([
    ['platform_off', 503, 'CUSTOMER_SESSION_OFF'],
    ['busy', 429, 'CUSTOMER_SESSION_BUSY'],
    ['duplicate_pii', 409, 'CUSTOMER_SESSION_MISMATCH'],
    ['key_refused', 503, 'CUSTOMER_SESSION_UNAVAILABLE'],
    ['code_refused', 503, 'CUSTOMER_SESSION_UNAVAILABLE'],
    ['unavailable', 503, 'CUSTOMER_SESSION_UNAVAILABLE'],
  ] as const)('ko-sales %s → %i %s', async (reason, status, code) => {
    const { service } = build({
      open: jest.fn().mockRejectedValue(new CustomerPassError(reason, 401)),
    });
    await expect(service.open(partner, {})).rejects.toMatchObject({
      status,
      response: { error: code },
    });
  });
});
