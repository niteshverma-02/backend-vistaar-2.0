import { HttpException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import type { Env } from '@config/env.schema';
import type { AgentsService } from '@modules/agents/services/agents.service';
import type { CohortsService } from '@modules/onboarding/services/cohorts.service';

import type { UpdatePaymentOptionDto } from '../dto/payment-option.dto';
import type { PaymentOptionRepository } from '../repositories/payment-option.repository';
import type { PaymentOption } from '../schemas/payment-option.schema';
import type { PaymentCredentialsService } from './payment-credentials.service';
import { PaymentOptionsService } from './payment-options.service';

const HO = 'ho@katyayaniorganics.com';

function row(overrides: Partial<PaymentOption> = {}): PaymentOption {
  return {
    _id: 'razorpay',
    label: 'Razorpay',
    hint: 'UPI, cards, net banking',
    is_active: true,
    order: 0,
    cohorts: [],
    version: 2,
    updated_by: HO,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function setup(
  rows: PaymentOption[] = [],
  {
    online = true,
    cohort = 'shop',
    // Providers with approved live keys.
    keys = ['razorpay', 'cashfree', 'phonepe'],
  }: { online?: boolean; cohort?: string | null; keys?: string[] } = {},
) {
  const repo = {
    listAll: jest.fn().mockResolvedValue(rows),
    find: jest
      .fn()
      .mockImplementation((id: string) =>
        Promise.resolve(rows.find((r) => r._id === id) ?? null),
      ),
    save: jest
      .fn()
      .mockImplementation(
        (id: string, version: number, set: Partial<PaymentOption>) =>
          Promise.resolve(
            row({
              _id: id as PaymentOption['_id'],
              ...set,
              version: version + 1,
            }),
          ),
      ),
    reorder: jest.fn().mockResolvedValue(undefined),
    log: jest.fn().mockResolvedValue(undefined),
    auditPage: jest.fn(),
  };
  const agents = { cohortById: jest.fn().mockResolvedValue(cohort) };
  const cohorts = {
    require: jest
      .fn()
      .mockImplementation((key: string) =>
        key === 'ghost'
          ? Promise.reject(new HttpException('COHORT_NOT_FOUND', 400))
          : Promise.resolve({ key }),
      ),
  };
  const credentials = {
    activeModes: jest
      .fn()
      .mockResolvedValue(new Map(keys.map((k) => [k, 'test']))),
    activePublicIds: jest
      .fn()
      .mockResolvedValue(
        new Map(
          keys.map((k) => [
            k,
            k === 'razorpay' ? { key_id: 'rzp_test_abc123' } : { app_id: 'x' },
          ]),
        ),
      ),
  };
  const config = { get: jest.fn().mockReturnValue(online) };
  const service = new PaymentOptionsService(
    repo as unknown as PaymentOptionRepository,
    agents as unknown as AgentsService,
    cohorts as unknown as CohortsService,
    credentials as unknown as PaymentCredentialsService,
    config as unknown as ConfigService<Env, true>,
  );
  return { service, repo, cohorts, credentials };
}

const dto = (d: Partial<UpdatePaymentOptionDto>): UpdatePaymentOptionDto => ({
  version: 2,
  ...d,
});

describe('PaymentOptionsService.forPartner', () => {
  it('shows nothing while the server kill switch is off, whatever HO set', async () => {
    const { service, repo } = setup([row()], { online: false });

    await expect(service.forPartner('a1')).resolves.toEqual([]);
    expect(repo.listAll).not.toHaveBeenCalled();
  });

  it('shows only switched-on options for the cohort, in order, never-saved ones off', async () => {
    const { service } = setup([
      row({ _id: 'phonepe', label: 'PhonePe', order: 0 }),
      row({ _id: 'razorpay', order: 1 }),
      row({ _id: 'cashfree', is_active: true, cohorts: ['farmer_leader'] }),
    ]);

    const list = await service.forPartner('a1');

    expect(list.map((o) => o.id)).toEqual(['phonepe', 'razorpay']);
    expect(list[0]).toEqual({
      id: 'phonepe',
      provider: 'phonepe',
      label: 'PhonePe',
      hint: 'UPI, cards, net banking',
    });
  });

  it('shows nothing before HO saves any option', async () => {
    const { service } = setup([]);
    await expect(service.forPartner('a1')).resolves.toEqual([]);
  });

  it('reads the stored rows at most once a minute, and again after an HO change', async () => {
    const { service, repo } = setup([row()]);

    await service.forPartner('a1');
    await service.forPartner('a2');
    expect(repo.listAll).toHaveBeenCalledTimes(1);

    await service.update('razorpay', dto({ is_active: false }), HO);
    await service.forPartner('a1');
    expect(repo.listAll).toHaveBeenCalledTimes(2);
  });
});

describe('PaymentOptionsService.forPartner — keys', () => {
  it('never shows a switched-on option whose keys are not approved (or were revoked)', async () => {
    const { service } = setup(
      [row({ _id: 'razorpay' }), row({ _id: 'phonepe', order: 1 })],
      { keys: ['phonepe'] },
    );

    const list = await service.forPartner('a1');

    expect(list.map((o) => o.id)).toEqual(['phonepe']);
  });

  it('gives the Razorpay row its live Key ID, and no other row any id', async () => {
    const { service } = setup([
      row({ _id: 'razorpay' }),
      row({ _id: 'cashfree', order: 1 }),
    ]);

    const list = await service.forPartner('a1');

    expect(list.map((o) => [o.id, o.key_id])).toEqual([
      ['razorpay', 'rzp_test_abc123'],
      ['cashfree', undefined],
    ]);
    expect('key_id' in list[1]).toBe(false);
  });

  it('shows a switched-on Cashfree with no keys — KO Utils holds them', async () => {
    const { service } = setup(
      [row({ _id: 'razorpay' }), row({ _id: 'cashfree', order: 1 })],
      { keys: [] },
    );

    const list = await service.forPartner('a1');

    expect(list).toEqual([
      {
        id: 'cashfree',
        provider: 'cashfree',
        label: 'Razorpay',
        hint: 'UPI, cards, net banking',
      },
    ]);
  });
});

describe('PaymentOptionsService.list', () => {
  it('lists every provider with the kill switch, a never-saved one at version 0', async () => {
    const { service } = setup([row()], { online: false });

    const view = await service.list();

    expect(view.online_enabled).toBe(false);
    expect(view.items.map((o) => [o.id, o.version, o.is_active])).toEqual([
      ['razorpay', 2, true],
      ['cashfree', 0, false],
      ['phonepe', 0, false],
    ]);
  });

  it('marks Cashfree keyless and ready, ignoring any keys left from before', async () => {
    const { service } = setup([row()], { keys: ['razorpay', 'cashfree'] });

    const view = await service.list();

    expect(
      view.items.map((o) => [o.id, o.keys_required, o.configured, o.mode]),
    ).toEqual([
      ['razorpay', true, true, 'test'],
      ['cashfree', false, true, null],
      ['phonepe', true, false, null],
    ]);
  });
});

describe('PaymentOptionsService.update', () => {
  it('saves at the version HO read and logs before → after', async () => {
    const { service, repo } = setup([row()]);

    const saved = await service.update(
      'razorpay',
      dto({ is_active: false, label: '  Razorpay UPI ' }),
      HO,
    );

    expect(repo.save).toHaveBeenCalledWith(
      'razorpay',
      2,
      { is_active: false, label: 'Razorpay UPI' },
      HO,
    );
    expect(saved.version).toBe(3);
    expect(repo.log).toHaveBeenCalledWith(
      expect.objectContaining({
        option_id: 'razorpay',
        action: 'update',
        before: { is_active: true, label: 'Razorpay' },
        after: { is_active: false, label: 'Razorpay UPI' },
        by: HO,
      }),
    );
  });

  it('answers 409 VERSION_CONFLICT when another screen changed it, and logs nothing', async () => {
    const { service, repo } = setup([row()]);
    repo.save.mockResolvedValue(null);

    await expect(
      service.update('razorpay', dto({ is_active: false }), HO),
    ).rejects.toMatchObject({
      status: 409,
      response: { error: 'VERSION_CONFLICT' },
    });
    expect(repo.log).not.toHaveBeenCalled();
  });

  it('refuses a link in the hint before writing', async () => {
    const { service, repo } = setup([row()]);

    await expect(
      service.update('razorpay', dto({ hint: 'Pay at https://evil.in' }), HO),
    ).rejects.toMatchObject({ status: 400 });
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('refuses an unknown cohort before writing', async () => {
    const { service, repo } = setup([row()]);

    await expect(
      service.update('razorpay', dto({ cohorts: ['ghost'] }), HO),
    ).rejects.toBeInstanceOf(HttpException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('refuses an empty change', async () => {
    const { service } = setup([row()]);
    await expect(service.update('razorpay', dto({}), HO)).rejects.toMatchObject(
      { status: 400 },
    );
  });

  it('keeps the saved change when the audit write fails', async () => {
    const { service, repo } = setup([row()]);
    repo.log.mockRejectedValue(new Error('mongo down'));

    await expect(
      service.update('razorpay', dto({ is_active: false }), HO),
    ).resolves.toMatchObject({ is_active: false });
  });
});

describe('PaymentOptionsService.update — keys', () => {
  it('refuses to switch on an option without approved keys, reading them fresh', async () => {
    const { service, repo, credentials } = setup([row({ is_active: false })], {
      keys: [],
    });

    await expect(
      service.update('razorpay', dto({ is_active: true }), HO),
    ).rejects.toMatchObject({
      status: 400,
      response: { error: 'CREDENTIALS_MISSING' },
    });
    expect(credentials.activeModes).toHaveBeenCalledWith(true);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('switches Cashfree on with no keys at all', async () => {
    const { service, repo } = setup(
      [row({ _id: 'cashfree', is_active: false })],
      { keys: [] },
    );

    await expect(
      service.update('cashfree', dto({ is_active: true }), HO),
    ).resolves.toMatchObject({
      is_active: true,
      keys_required: false,
      configured: true,
    });
    expect(repo.save).toHaveBeenCalled();
  });

  it('still lets HO switch off or rename an option without keys', async () => {
    const { service } = setup([row()], { keys: [] });

    await expect(
      service.update('razorpay', dto({ is_active: false, label: 'RZP' }), HO),
    ).resolves.toMatchObject({ is_active: false, configured: false });
  });
});

describe('PaymentOptionsService.reorder', () => {
  it('writes and logs the new order', async () => {
    const { service, repo } = setup([]);

    await service.reorder({ ids: ['phonepe', 'razorpay', 'cashfree'] }, HO);

    expect(repo.reorder).toHaveBeenCalledWith(
      ['phonepe', 'razorpay', 'cashfree'],
      HO,
    );
    expect(repo.log).toHaveBeenCalledWith(
      expect.objectContaining({
        option_id: '*',
        action: 'reorder',
        before: { ids: ['razorpay', 'cashfree', 'phonepe'] },
        after: { ids: ['phonepe', 'razorpay', 'cashfree'] },
      }),
    );
  });

  it('refuses a list that leaves an option out', async () => {
    const { service, repo } = setup([]);

    await expect(
      service.reorder({ ids: ['phonepe', 'razorpay'] }, HO),
    ).rejects.toMatchObject({ status: 400 });
    expect(repo.reorder).not.toHaveBeenCalled();
  });
});
