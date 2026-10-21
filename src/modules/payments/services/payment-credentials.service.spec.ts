import { randomBytes } from 'node:crypto';

import type { ConfigService } from '@nestjs/config';

import type { Env } from '@config/env.schema';

import type { PaymentProvider } from '../payments.domain';
import { CredentialCipher } from '../providers/credential-cipher';
import type { GatewayVerifier } from '../providers/gateway-verifier';
import type { PaymentAlerts } from '../providers/payment-alerts';
import type { PaymentCredentialRepository } from '../repositories/payment-credential.repository';
import type { PaymentOptionRepository } from '../repositories/payment-option.repository';
import type {
  CredentialTest,
  PaymentCredential,
} from '../schemas/payment-credential.schema';
import { PaymentCredentialsService } from './payment-credentials.service';

const A = 'a@katyayaniorganics.com';
const B = 'b@katyayaniorganics.com';
const C = 'c@katyayaniorganics.com';
const SECRET = 'cfsk_ma_test_abcdef1234567890';
const RZP = {
  mode: 'test' as const,
  fields: { key_id: 'rzp_test_AbCdEf123456' },
};
const CF = {
  mode: 'test' as const,
  fields: { app_id: 'TEST1234567890', secret_key: SECRET },
};

/** The repository's contract, kept in memory: conditional writes included. */
function memoryRepo() {
  const rows = new Map<string, PaymentCredential>();
  const strip = (r: PaymentCredential): PaymentCredential => ({
    ...r,
    secrets: null,
  });
  const patch = (id: string, set: Partial<PaymentCredential>) => {
    const next = { ...rows.get(id)!, ...set };
    rows.set(id, next);
    return strip(next);
  };
  const repo = {
    insertPending: jest.fn((row: PaymentCredential) => {
      const taken = [...rows.values()].some(
        (r) => r.provider === row.provider && r.status === 'pending',
      );
      if (taken) return Promise.resolve(null);
      const full = { ...row, created_at: new Date(), updated_at: new Date() };
      rows.set(row._id, full);
      return Promise.resolve(strip(full));
    }),
    find: jest.fn((id: string) => {
      const r = rows.get(id);
      return Promise.resolve(r ? strip(r) : null);
    }),
    findSealed: jest.fn((id: string) => Promise.resolve(rows.get(id) ?? null)),
    activeSealed: jest.fn((p: PaymentProvider) =>
      Promise.resolve(
        [...rows.values()].find(
          (r) => r.provider === p && r.status === 'active',
        ) ?? null,
      ),
    ),
    current: jest.fn(() =>
      Promise.resolve(
        [...rows.values()]
          .filter((r) => ['active', 'pending', 'approved'].includes(r.status))
          .map(strip),
      ),
    ),
    history: jest.fn(),
    setTest: jest.fn((id: string, test: CredentialTest) =>
      Promise.resolve(
        rows.get(id)?.status === 'pending' ? patch(id, { test }) : null,
      ),
    ),
    claimApproval: jest.fn((id: string, by: string, now: Date) => {
      const r = rows.get(id);
      const ok =
        r &&
        r.status === 'pending' &&
        r.expires_at > now &&
        r.submitted_by !== by &&
        r.test?.ok === true;
      return Promise.resolve(
        ok ? patch(id, { status: 'approved', decided_by: by }) : null,
      );
    }),
    retireActive: jest.fn(
      (
        p: PaymentProvider,
        exceptId: string | null,
        status: 'superseded' | 'revoked',
      ) => {
        const r = [...rows.values()].find(
          (x) =>
            x.provider === p && x.status === 'active' && x._id !== exceptId,
        );
        if (!r) return Promise.resolve(false);
        patch(r._id, { status, secrets: null });
        return Promise.resolve(true);
      },
    ),
    promote: jest.fn((id: string) =>
      Promise.resolve(
        rows.get(id)?.status === 'approved'
          ? patch(id, { status: 'active', activated_at: new Date() })
          : null,
      ),
    ),
    approving: jest.fn((p: PaymentProvider) =>
      Promise.resolve(
        [...rows.values()].some(
          (r) => r.provider === p && r.status === 'approved',
        ),
      ),
    ),
    reject: jest.fn((id: string, _by: string, reason: string) =>
      Promise.resolve(
        ['pending', 'approved'].includes(rows.get(id)?.status ?? '')
          ? patch(id, { status: 'rejected', secrets: null, reason })
          : null,
      ),
    ),
    expire: jest.fn((id: string) => {
      if (rows.get(id)?.status === 'pending')
        patch(id, { status: 'expired', secrets: null });
      return Promise.resolve();
    }),
  };
  return { repo, rows };
}

function setup({
  production = false,
  key = randomBytes(32).toString('base64'),
  gatewayOk = true,
} = {}) {
  const { repo, rows } = memoryRepo();
  const env: Record<string, unknown> = {
    NODE_ENV: production ? 'production' : 'development',
    PAYMENTS_CREDENTIALS_KEY: key,
    PAYMENTS_CREDENTIALS_KEY_ID: 'k1',
  };
  const config = {
    get: (k: string) => env[k],
  } as unknown as ConfigService<Env, true>;
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const verifier = {
    verify: jest.fn().mockResolvedValue({
      ok: gatewayOk,
      message: gatewayOk ? 'accepted' : 'refused',
    }),
  };
  const alerts = { send: jest.fn().mockResolvedValue(undefined) };
  const service = new PaymentCredentialsService(
    repo as unknown as PaymentCredentialRepository,
    audit as unknown as PaymentOptionRepository,
    new CredentialCipher(config),
    verifier as unknown as GatewayVerifier,
    alerts as unknown as PaymentAlerts,
    config,
  );
  return { service, repo, rows, audit, verifier, alerts };
}

/** Everything a caller, the audit log or Slack ever received. */
function everythingSent(
  s: ReturnType<typeof setup>,
  ...views: unknown[]
): string {
  return JSON.stringify([
    views,
    s.audit.log.mock.calls,
    s.alerts.send.mock.calls,
  ]);
}

describe('PaymentCredentialsService — submit', () => {
  it('stores secrets sealed and returns them only masked', async () => {
    const s = setup();

    const view = await s.service.submit('cashfree', CF, A);

    expect(view.status).toBe('pending');
    expect(view.public_fields).toEqual({ app_id: CF.fields.app_id });
    expect(view.masked).toEqual({ secret_key: '••••7890' });
    const stored = s.rows.get(view.id)!;
    expect(JSON.stringify(stored)).not.toContain(SECRET);
    expect(everythingSent(s, view)).not.toContain(SECRET);
    expect(s.alerts.send).toHaveBeenCalledWith(expect.stringContaining(A));
  });

  it('takes live keys on a test server and test keys in production', async () => {
    const live = await setup().service.submit(
      'razorpay',
      {
        mode: 'live',
        fields: { ...RZP.fields, key_id: 'rzp_live_AbCdEf123456' },
      },
      A,
    );
    expect(live.mode).toBe('live');
    const test = await setup({ production: true }).service.submit(
      'razorpay',
      RZP,
      A,
    );
    expect(test.mode).toBe('test');
  });

  it('takes a test Key ID under live and a live one under test', async () => {
    const s = setup();
    const view = await s.service.submit(
      'razorpay',
      { ...RZP, mode: 'live' },
      A,
    );
    expect(view.mode).toBe('live');
  });

  it('starts the form on the server mode and offers both', async () => {
    const dev = await setup().service.overview();
    expect(dev.required_mode).toBe('test');
    expect(dev.modes).toEqual(['test', 'live']);
    const prod = await setup({ production: true }).service.overview();
    expect(prod.required_mode).toBe('live');
  });

  it('answers 503 when the server has no encryption key', async () => {
    await expect(
      setup({ key: '' }).service.submit('razorpay', RZP, A),
    ).rejects.toMatchObject({
      status: 503,
      response: { error: 'CREDENTIALS_NOT_CONFIGURED' },
    });
  });

  it('allows one waiting set per provider', async () => {
    const s = setup();
    await s.service.submit('razorpay', RZP, A);

    await expect(s.service.submit('razorpay', RZP, B)).rejects.toMatchObject({
      status: 409,
      response: { error: 'CREDENTIALS_PENDING' },
    });
  });

  it('replaces a waiting set past its day', async () => {
    const s = setup();
    const first = await s.service.submit('razorpay', RZP, A);
    s.rows.get(first.id)!.expires_at = new Date(Date.now() - 1);

    await expect(s.service.submit('razorpay', RZP, B)).resolves.toMatchObject({
      status: 'pending',
    });
    expect(s.rows.get(first.id)!.status).toBe('expired');
    expect(s.rows.get(first.id)!.secrets).toBeNull();
  });
});

describe('PaymentCredentialsService — test, approve', () => {
  async function submitted(opts?: Parameters<typeof setup>[0]) {
    const s = setup(opts);
    const view = await s.service.submit('razorpay', RZP, A);
    return { s, id: view.id };
  }

  it('checks the gateway with the opened keys', async () => {
    const { s, id } = await submitted();

    const view = await s.service.test(id, A);

    expect(s.verifier.verify).toHaveBeenCalledWith(
      'razorpay',
      'test',
      RZP.fields,
    );
    expect(view.test).toMatchObject({ ok: true, by: A });
  });

  it('goes live after a passed check and a second admin, wiping the old set', async () => {
    const { s, id: first } = await submitted();
    await s.service.test(first, A);
    await s.service.approve(first, B);

    const second = await s.service.submit('razorpay', RZP, B);
    await s.service.test(second.id, B);
    const live = await s.service.approve(second.id, A);

    expect(live.status).toBe('active');
    expect(s.rows.get(first)!.status).toBe('superseded');
    expect(s.rows.get(first)!.secrets).toBeNull();
    await expect(s.service.usable('razorpay')).resolves.toEqual({
      id: second.id,
      mode: 'test',
      fields: RZP.fields,
    });
    expect([...(await s.service.activeModes(true))]).toEqual([
      ['razorpay', 'test'],
    ]);
  });

  it('never lets the submitter approve their own keys', async () => {
    const { s, id } = await submitted();
    await s.service.test(id, A);

    await expect(s.service.approve(id, A)).rejects.toMatchObject({
      status: 403,
      response: { error: 'APPROVER_IS_SUBMITTER' },
    });
    expect(s.rows.get(id)!.status).toBe('pending');
  });

  it('refuses approval before a passed check', async () => {
    const { s, id } = await submitted({ gatewayOk: false });

    await expect(s.service.approve(id, B)).rejects.toMatchObject({
      response: { error: 'CREDENTIALS_NOT_TESTED' },
    });
    await s.service.test(id, B);
    await expect(s.service.approve(id, B)).rejects.toMatchObject({
      response: { error: 'CREDENTIALS_NOT_TESTED' },
    });
  });

  it('refuses approval past the day', async () => {
    const { s, id } = await submitted();
    await s.service.test(id, A);
    s.rows.get(id)!.expires_at = new Date(Date.now() - 1);

    await expect(s.service.approve(id, B)).rejects.toMatchObject({
      response: { error: 'CREDENTIALS_EXPIRED' },
    });
  });

  it('finishes an approval interrupted after its first step', async () => {
    const { s, id } = await submitted();
    await s.service.test(id, A);
    s.repo.promote.mockResolvedValueOnce(null);
    await expect(s.service.approve(id, B)).rejects.toBeDefined();
    expect(s.rows.get(id)!.status).toBe('approved');

    await expect(s.service.approve(id, B)).resolves.toMatchObject({
      status: 'active',
    });
  });

  it('lets another admin finish or cancel a stuck approval, and holds new keys meanwhile', async () => {
    const { s, id } = await submitted();
    await s.service.test(id, A);
    s.repo.promote.mockResolvedValueOnce(null);
    await expect(s.service.approve(id, B)).rejects.toBeDefined();

    // Nothing new while this set is half-way to live: it would retire the newer one.
    await expect(s.service.submit('razorpay', RZP, C)).rejects.toMatchObject({
      response: { error: 'CREDENTIALS_PENDING' },
    });
    // The submitter still cannot push their own keys live.
    await expect(s.service.approve(id, A)).rejects.toBeDefined();
    // Any other admin can cancel it.
    await expect(s.service.reject(id, C, 'stuck')).resolves.toMatchObject({
      status: 'rejected',
    });
  });
});

describe('PaymentCredentialsService — Razorpay Key ID only', () => {
  it('stores, checks, approves and hands out a Key ID with no secrets', async () => {
    const s = setup();
    const keyOnly = {
      mode: 'test' as const,
      fields: { key_id: RZP.fields.key_id },
    };

    const sent = await s.service.submit('razorpay', keyOnly, A);
    expect(sent.masked).toEqual({});
    await s.service.test(sent.id, A);
    expect(s.verifier.verify).toHaveBeenCalledWith('razorpay', 'test', {
      key_id: RZP.fields.key_id,
    });
    await s.service.approve(sent.id, B);

    await expect(s.service.usable('razorpay')).resolves.toEqual({
      id: sent.id,
      mode: 'test',
      fields: { key_id: RZP.fields.key_id },
    });
  });
});

describe('PaymentCredentialsService — reject, revoke', () => {
  it('wipes rejected keys', async () => {
    const s = setup();
    const { id } = await s.service.submit('razorpay', RZP, A);

    await s.service.reject(id, A, 'Wrong account');

    expect(s.rows.get(id)).toMatchObject({ status: 'rejected', secrets: null });
  });

  it('revokes the live keys at once and alerts', async () => {
    const s = setup();
    const { id } = await s.service.submit('razorpay', RZP, A);
    await s.service.test(id, A);
    await s.service.approve(id, B);
    await s.service.activeModes();

    await s.service.revoke('razorpay', B, 'Key leaked in a screenshot');

    expect(s.rows.get(id)).toMatchObject({ status: 'revoked', secrets: null });
    await expect(s.service.usable('razorpay')).resolves.toBeNull();
    expect((await s.service.activeModes()).size).toBe(0);
    expect(s.alerts.send).toHaveBeenLastCalledWith(
      expect.stringContaining('REVOKED'),
    );
  });

  it('answers 404 when there is nothing live to revoke', async () => {
    await expect(
      setup().service.revoke('cashfree', B, 'Just in case'),
    ).rejects.toMatchObject({ status: 404 });
  });
});
