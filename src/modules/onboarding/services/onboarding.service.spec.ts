import type { HttpException } from '@nestjs/common';

import type { AgentsService } from '@modules/agents/services/agents.service';
import type { PiiService } from '@modules/spine/services/pii.service';
import type { PincodeService } from '@modules/spine/services/pincode.service';
import type { StorageService } from '@modules/uploads/services/storage.service';

import type { StepDef } from '../form.domain';
import { idKeysOf, type IdHolder } from '../id-keys.domain';
import type { OnboardingRepository } from '../repositories/onboarding.repository';
import type { OnboardingConfig } from '../schemas/onboarding-config.schema';
import type { OnboardingData } from '../schemas/onboarding-data.schema';
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
        key: 'aadhaar',
        type: 'document',
        label: en('Aadhaar'),
        required: true,
        org_document: 'adhar',
        validation: { number_required: true },
      },
      {
        key: 'pan_card',
        type: 'document',
        label: en('PAN'),
        required: true,
        org_document: 'pan',
        validation: { number_required: true },
      },
    ],
  },
];
const CONFIG = {
  _id: 'cfg-1',
  cohort: 'retailer',
  version: 1,
  steps: STEPS,
} as unknown as OnboardingConfig;

const doc = (raw = {}): OnboardingData =>
  ({
    _id: 'onb-1',
    agent_ref: 'ref-me',
    agent_id: 'VST-000001',
    pii_id: 'PII-1',
    cohort: 'retailer',
    config_id: 'cfg-1',
    config_version: 1,
    raw_data: raw,
    documents_review: {},
    remarks: {},
    submit_count: 0,
    version: 0,
  }) as unknown as OnboardingData;

const file = (name: string) => [`KO-documents/PII-1/${name}.jpg`];

/** `rows` stands in for every partner's `id_keys` on the collection. */
function setup(rows: IdHolder[]) {
  const idHolders = jest.fn((keys: IdHolder['id_keys'], exclude: string) =>
    Promise.resolve(
      rows.filter(
        (r) =>
          r.agent_ref !== exclude &&
          ((!!keys?.aadhaar_hash &&
            r.id_keys?.aadhaar_hash === keys.aadhaar_hash) ||
            (!!keys?.pan && r.id_keys?.pan === keys.pan)),
      ),
    ),
  );
  const updateIfVersion = jest.fn(() => Promise.resolve(doc()));
  const repo = {
    findByAgent: () => Promise.resolve(doc()),
    idHolders,
    updateIfVersion,
  } as unknown as OnboardingRepository;
  const agents = {
    require: () =>
      Promise.resolve({
        _id: 'ref-me',
        agent_id: 'VST-000001',
        pii_id: 'PII-1',
        stage: 'onboarding',
        is_active: true,
        cohort: 'retailer',
      }),
    setPreview: () => Promise.resolve(),
  } as unknown as AgentsService;
  const configs = {
    version: () => Promise.resolve(CONFIG),
    published: () => Promise.resolve(null),
  } as unknown as ConfigsService;
  const service = new OnboardingService(
    repo,
    configs,
    {} as CohortsService,
    agents,
    { sign: () => Promise.resolve({}) } as unknown as StorageService,
    {} as PiiService,
    { lookup: () => Promise.resolve(null) } as unknown as PincodeService,
  );
  return { service, updateIfVersion };
}

const keysFor = (aadhaar: string, pan: string) =>
  idKeysOf(STEPS, {
    aadhaar: { files: file('a'), number: aadhaar },
    pan_card: { files: file('p'), number: pan },
  });

describe('OnboardingService — Aadhaar / PAN duplicate check', () => {
  it("refuses another partner's Aadhaar with ID_IN_USE, without the number", async () => {
    const { service, updateIfVersion } = setup([
      {
        agent_ref: 'ref-other',
        agent_id: 'VST-000002',
        id_keys: keysFor('234567890123', 'ZZZZZ9999Z'),
      },
    ]);
    const error = await service
      .save('ref-me', {
        data: { aadhaar: { files: file('a'), number: '2345 6789 0123' } },
      })
      .catch((e: HttpException) => e);

    expect((error as HttpException).getStatus()).toBe(409);
    const body = JSON.stringify((error as HttpException).getResponse());
    expect(body).toContain('ID_IN_USE');
    expect(body).not.toContain('234567890123');
    expect(updateIfVersion).not.toHaveBeenCalled();
  });

  it('lets the same partner save their own Aadhaar again', async () => {
    const { service, updateIfVersion } = setup([
      {
        agent_ref: 'ref-me',
        agent_id: 'VST-000001',
        id_keys: keysFor('234567890123', 'ABCDE1234F'),
      },
    ]);
    await service.save('ref-me', {
      data: { aadhaar: { files: file('a'), number: '234567890123' } },
    });

    const [, , update] = updateIfVersion.mock.calls[0] as unknown as [
      string,
      number,
      { $set: { id_keys: { aadhaar_hash: string } } },
    ];
    expect(update.$set.id_keys.aadhaar_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('matches PAN whatever its case', async () => {
    const { service } = setup([
      {
        agent_ref: 'ref-other',
        agent_id: 'VST-000002',
        id_keys: keysFor('298765432109', 'ABCDE1234F'),
      },
    ]);
    await expect(
      service.save('ref-me', {
        data: { pan_card: { files: file('p'), number: 'abcde1234f' } },
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(keysFor('298765432109', ' abcde1234f ').pan).toBe('ABCDE1234F');
  });
});
