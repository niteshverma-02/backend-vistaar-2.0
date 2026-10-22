import type { AgentsService } from '@modules/agents/services/agents.service';
import type { PiiService } from '@modules/spine/services/pii.service';
import type { PincodeService } from '@modules/spine/services/pincode.service';
import type { StorageService } from '@modules/uploads/services/storage.service';

import type { BankChange } from '../bank-change.domain';
import type { StepDef } from '../form.domain';
import type { OnboardingRepository } from '../repositories/onboarding.repository';
import type { OnboardingConfig } from '../schemas/onboarding-config.schema';
import type { OnboardingData } from '../schemas/onboarding-data.schema';
import { BankChangeService } from './bank-change.service';
import type { CohortsService } from './cohorts.service';
import type { ConfigsService } from './configs.service';
import { OnboardingService } from './onboarding.service';

const en = (text: string) => ({ en: text });
const STEPS: StepDef[] = [
  {
    step_id: 'kyc',
    order: 1,
    title: en('KYC'),
    is_active: true,
    fields: [
      {
        key: 'bank_proof',
        type: 'document',
        label: en('Cheque'),
        required: true,
        org_document: 'bank_details',
        validation: { max_items: 1 },
      },
      {
        key: 'bank_account',
        type: 'object',
        label: en('Bank account'),
        required: true,
        maps_to: 'details.bank_account',
        fields: [
          {
            key: 'account_holder',
            type: 'text',
            label: en('Holder'),
            required: true,
          },
          {
            key: 'account_number',
            type: 'text',
            label: en('Number'),
            required: true,
            validation: { regex: '^\\d{9,18}$' },
          },
          {
            key: 'ifsc',
            type: 'text',
            label: en('IFSC'),
            required: true,
            validation: { regex: '^[A-Z]{4}0[A-Z0-9]{6}$' },
          },
          { key: 'upi_id', type: 'text', label: en('UPI'), required: false },
        ],
      },
    ],
  },
];
const CONFIG = {
  cohort: 'retailer',
  version: 1,
  steps: STEPS,
} as unknown as OnboardingConfig;

const OLD_PROOF = { files: ['KO-documents/PII-1/bank/old.jpg'] };
const NEW_REQUEST = {
  account_holder: 'Suresh Kumar',
  account_number: '998877665544',
  ifsc: 'hdfc0000123',
  proof_path: 'KO-documents/PII-1/bank/new.jpg',
};

/** `$set` with dotted paths, two levels deep — as the repository's write would land. */
function applySet(
  doc: OnboardingData,
  set: Record<string, unknown>,
): OnboardingData {
  const out = structuredClone(doc) as unknown as Record<
    string,
    Record<string, unknown>
  >;
  for (const [path, value] of Object.entries(set)) {
    const [head, tail] = path.split('.');
    if (tail === undefined) (out as Record<string, unknown>)[head] = value;
    else out[head] = { ...(out[head] ?? {}), [tail]: value };
  }
  return out as unknown as OnboardingData;
}

function setup() {
  let row = {
    _id: 'onb-1',
    agent_ref: 'ref-1',
    agent_id: 'VST-000001',
    pii_id: 'PII-1',
    cohort: 'retailer',
    config_version: 1,
    raw_data: {
      bank_proof: OLD_PROOF,
      bank_account: {
        account_holder: 'Suresh Kumar',
        account_number: '000123454321',
        ifsc: 'SBIN0001234',
        upi_id: 'suresh@upi',
      },
    },
    documents_review: {
      bank_proof: {
        status: 'verified',
        reason: null,
        by: 'ho@k.com',
        at: new Date(),
        sig: JSON.stringify(OLD_PROOF),
      },
    },
  } as unknown as OnboardingData;

  const repo = {
    findByAgent: () => Promise.resolve(row),
    forPayout: () => Promise.resolve([row]),
    startBankChange: jest.fn((_ref: string, change: BankChange) => {
      if (row.bank_change?.status === 'pending') return Promise.resolve(null);
      row = { ...row, bank_change: change };
      return Promise.resolve(row);
    }),
    closeBankChange: jest.fn(
      (
        _ref: string,
        at: Date,
        _version: number,
        set: Record<string, unknown>,
      ) => {
        const open = row.bank_change;
        if (
          open?.status !== 'pending' ||
          open.requested_at.getTime() !== at.getTime()
        )
          return Promise.resolve(null);
        row = applySet(row, set);
        return Promise.resolve(row);
      },
    ),
  } as unknown as OnboardingRepository;
  const partner = {
    _id: 'ref-1',
    agent_id: 'VST-000001',
    pii_id: 'PII-1',
    stage: 'approved',
    is_active: true,
  };
  const agents = {
    require: () => Promise.resolve(partner),
    requireByAgentId: () => Promise.resolve(partner),
    setProfileBankAccount: jest.fn(() => Promise.resolve()),
  } as unknown as AgentsService;
  const configs = {
    version: () => Promise.resolve(CONFIG),
  } as unknown as ConfigsService;
  const storage = {
    sign: () => Promise.resolve(new Map<string, string>()),
    urlOf: (path: string) => `https://bucket/${path}`,
  } as unknown as StorageService;
  const piis = {
    recordVerifiedDocument: jest.fn(),
    unverifyDocument: jest.fn(),
  };

  const forms = new OnboardingService(
    repo,
    configs,
    {} as CohortsService,
    agents,
    storage,
    piis as unknown as PiiService,
    {} as PincodeService,
  );
  const service = new BankChangeService(repo, forms, configs, agents, storage);
  const facts = async () => (await forms.payoutFacts(['ref-1'])).get('ref-1');
  return { service, facts, piis, repo, agents, row: () => row };
}

describe('BankChangeService', () => {
  it('refuses a second request while one is pending', async () => {
    const { service, repo } = setup();
    await service.request('ref-1', NEW_REQUEST);
    await expect(
      service.request('ref-1', {
        ...NEW_REQUEST,
        account_number: '111122223333',
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: { error: 'BANK_CHANGE_PENDING' },
    });
    expect(repo.startBankChange).toHaveBeenCalledTimes(1);
  });

  it("refuses a proof outside the partner's own folder", async () => {
    const { service, repo } = setup();
    await expect(
      service.request('ref-1', {
        ...NEW_REQUEST,
        proof_path: 'KO-documents/PII-2/bank/x.jpg',
      }),
    ).rejects.toMatchObject({
      status: 400,
      response: { error: 'VALIDATION_FAILED' },
    });
    expect(repo.startBankChange).not.toHaveBeenCalled();
  });

  it('approve swaps the account payouts read, verifies the proof and copies it to piis', async () => {
    const { service, facts, piis, row } = setup();
    await service.request('ref-1', NEW_REQUEST);
    expect(await facts()).toMatchObject({
      bank_change_pending: true,
      bank_account: { account_number: '000123454321' },
    });

    await service.approve('VST-000001', 'ho@k.com');

    expect(await facts()).toMatchObject({
      bank_verified: true,
      bank_change_pending: false,
      bank_account: {
        account_holder: 'Suresh Kumar',
        account_number: '998877665544',
        ifsc: 'HDFC0000123',
      },
    });
    expect(row().raw_data.bank_account).toMatchObject({ upi_id: 'suresh@upi' });
    expect(row().documents_review.bank_proof).toMatchObject({
      status: 'verified',
      by: 'ho@k.com',
    });
    expect(piis.recordVerifiedDocument).toHaveBeenCalledWith(
      'PII-1',
      'bank_details',
      {
        id: null,
        image: 'https://bucket/KO-documents/PII-1/bank/new.jpg',
      },
    );
  });

  it('approve can be run again when a copy after the approval failed', async () => {
    const { service, piis, agents, repo, row } = setup();
    await service.request('ref-1', NEW_REQUEST);
    jest
      .mocked(agents.setProfileBankAccount)
      .mockRejectedValueOnce(new Error('network'));
    await expect(service.approve('VST-000001', 'ho@k.com')).rejects.toThrow(
      'network',
    );
    expect(row().bank_change?.status).toBe('approved');

    await expect(
      service.approve('VST-000001', 'ho@k.com'),
    ).resolves.toMatchObject({ status: 'approved' });
    expect(repo.closeBankChange).toHaveBeenCalledTimes(1);
    expect(piis.recordVerifiedDocument).toHaveBeenCalledTimes(2);
    expect(agents.setProfileBankAccount).toHaveBeenLastCalledWith(
      expect.objectContaining({ agent_id: 'VST-000001' }),
      {
        account_holder: 'Suresh Kumar',
        account_number: '998877665544',
        ifsc: 'HDFC0000123',
      },
    );
  });

  it('reject keeps the old account', async () => {
    const { service, facts, piis } = setup();
    await service.request('ref-1', NEW_REQUEST);
    const view = await service.reject(
      'VST-000001',
      'Cheque is blurred',
      'ho@k.com',
    );

    expect(view).toMatchObject({
      status: 'rejected',
      reason: 'Cheque is blurred',
    });
    expect(await facts()).toMatchObject({
      bank_verified: true,
      bank_change_pending: false,
      bank_account: { account_number: '000123454321', ifsc: 'SBIN0001234' },
    });
    expect(piis.recordVerifiedDocument).not.toHaveBeenCalled();
  });
});
