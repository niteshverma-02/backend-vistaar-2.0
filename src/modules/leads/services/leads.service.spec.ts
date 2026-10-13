import type { HttpException } from '@nestjs/common';

import type { AccessService } from '@modules/access/services/access.service';
import type { AgentsService } from '@modules/agents/services/agents.service';
import type { SettingsService } from '@modules/settings/services/settings.service';
import type { PiiService } from '@modules/spine/services/pii.service';
import type { PincodeService } from '@modules/spine/services/pincode.service';

import type { AddFarmerDto } from '../dto/lead.dto';
import type {
  InsertResult,
  OrgLeadsRepository,
} from '../repositories/org-leads.repository';
import type { VistaarLeadsRepository } from '../repositories/vistaar-leads.repository';
import { LeadsService } from './leads.service';

type Row = Record<string, unknown> & {
  pii_id: string;
  agent_id: string;
  stage?: string;
};
type Update = {
  $set?: Record<string, unknown>;
  $push?: Record<string, { $each: unknown[] }>;
};

const ME = { agent_id: 'VST-000001', pii_id: 'PII-1' };
const dto: AddFarmerDto = {
  phone: '+91 98765 43210',
  name: 'Ramesh Patel',
  village: 'rampur',
  pincode: '462026',
  crops: ['Wheat'],
  acreage: 5,
  consent_version: 1,
};

/** Just enough of `vistaar_v2_leads` to run the claim, update and race paths for real. */
function fakeRows(seed: Row[] = []) {
  const rows = new Map<string, Row>(seed.map((r) => [r.pii_id, { ...r }]));
  return {
    rows,
    findByPii: jest.fn((pii: string) =>
      Promise.resolve(rows.has(pii) ? { ...rows.get(pii)! } : null),
    ),
    insert: jest.fn((row: Row) => {
      if (rows.has(row.pii_id)) return Promise.resolve(false);
      rows.set(row.pii_id, { ...row });
      return Promise.resolve(true);
    }),
    update: jest.fn(
      (
        pii: string,
        agent: string,
        upd: Update,
        expect: { stage?: string } = {},
      ) => {
        const row = rows.get(pii);
        if (!row || row.agent_id !== agent) return Promise.resolve(null);
        if (expect.stage && row.stage !== expect.stage)
          return Promise.resolve(null);
        Object.assign(row, upd.$set ?? {});
        for (const [key, value] of Object.entries(upd.$push ?? {}))
          row[key] = [...((row[key] as unknown[]) ?? []), ...value.$each];
        return Promise.resolve({ ...row });
      },
    ),
  };
}

function setup(
  opts: {
    stage?: string;
    cohort?: string;
    known?: string | null;
    lead?: { lead_id: string; source?: string; created_by?: string } | null;
    contact?: { profile?: string; source?: string } | null;
    head?: boolean;
    seed?: Row[];
    leadInserts?: InsertResult[];
  } = {},
) {
  const agents = {
    requireByAgentId: jest.fn().mockResolvedValue({
      stage: opts.stage ?? 'approved',
      is_active: true,
      cohort: opts.cohort ?? 'vistaar_agent',
      profile: { state: 'MADHYA PRADESH' },
    }),
    partnersByAgentIds: jest.fn().mockResolvedValue(new Map()),
  };
  const settings = {
    get: jest.fn().mockResolvedValue({
      lead_owner_agent_id: null,
      farmer_consent: { version: 1, text: { en: 'consent' } },
    }),
  };
  const access = {
    offlineHead: jest.fn().mockResolvedValue(
      opts.head === false
        ? null
        : {
            agent_id: 'A0-3001',
            ref: '674714aa1feb5afbbe0cbc29',
            is_active: true,
          },
    ),
    staffByIds: jest.fn().mockResolvedValue(new Map()),
  };
  let n = 4087722;
  const piis = {
    findIdByPhone: jest.fn().mockResolvedValue(opts.known ?? null),
    resolve: jest.fn().mockResolvedValue({ pii_id: 'PII-9', created: true }),
    nextOrgNumber: jest.fn().mockImplementation(() => Promise.resolve(++n)),
    saveAddress: jest.fn().mockResolvedValue('ADDR-1'),
  };
  const pincodes = {
    lookup: jest
      .fn()
      .mockResolvedValue({ state: 'MADHYA PRADESH', district: 'BHOPAL' }),
  };
  const inserts = [...(opts.leadInserts ?? ['ok'])];
  let lead = opts.lead ?? null;
  const org = {
    leadOf: jest.fn(() => Promise.resolve(lead)),
    contactOf: jest.fn().mockResolvedValue(opts.contact ?? null),
    insertLead: jest.fn((doc: { lead_id: string }) => {
      const result = inserts.shift() ?? 'ok';
      if (result === 'ok')
        lead = {
          lead_id: doc.lead_id,
          source: 'vistaar',
          created_by: ME.agent_id,
        };
      return Promise.resolve(result);
    }),
    insertContact: jest.fn().mockResolvedValue('ok'),
    updateLead: jest.fn().mockResolvedValue(undefined),
    updateContact: jest.fn().mockResolvedValue(undefined),
  };
  const rows = fakeRows(opts.seed);
  const service = new LeadsService(
    org as unknown as OrgLeadsRepository,
    rows as unknown as VistaarLeadsRepository,
    agents as unknown as AgentsService,
    piis as unknown as PiiService,
    pincodes as unknown as PincodeService,
    settings as unknown as SettingsService,
    access as unknown as AccessService,
  );
  return { service, org, rows, piis };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return ((error as HttpException).getResponse() as { error: string }).error;
  }
  return 'no error';
}

const firstArg = (mock: jest.Mock): Record<string, unknown> =>
  (mock.mock.calls as [Record<string, unknown>][])[0][0];

const myRow = (extra: Partial<Row> = {}): Row => ({
  _id: 'r1',
  pii_id: 'PII-9',
  agent_id: ME.agent_id,
  lead_id: 'L-5',
  origin: 'created',
  stage: 'prospect',
  next_follow_up: null,
  lost_reason: null,
  stage_history: [],
  activities: [],
  consent: { version: 1, at: new Date() },
  ...extra,
});

describe('LeadsService.upsert', () => {
  it('creates a new farmer: our row first, then the org lead, contact and address', async () => {
    const { service, org, rows, piis } = setup();
    const saved = await service.upsert(ME, { ...dto, note: 'Needs fungicide' });

    expect(piis.resolve).toHaveBeenCalledWith('9876543210', '+91');
    expect(rows.insert.mock.invocationCallOrder[0]).toBeLessThan(
      org.insertLead.mock.invocationCallOrder[0],
    );
    expect(firstArg(org.insertLead)).toMatchObject({
      lead_id: 'L-4187723',
      source: 'vistaar',
      created_by: 'VST-000001',
      lead_owner: {
        agent_id: 'A0-3001',
        agent_ref: '674714aa1feb5afbbe0cbc29',
      },
    });
    expect(firstArg(org.insertLead)).not.toHaveProperty('profiled_at');
    expect(org.insertContact).toHaveBeenCalled();
    expect(piis.saveAddress).toHaveBeenCalled();
    expect(saved).toMatchObject({
      result: 'created',
      origin: 'created',
      lead_id: 'L-4187723',
      stage: 'prospect',
      village: 'Rampur',
      consent_version: 1,
    });
    expect(saved.activities[0]).toMatchObject({
      type: 'note',
      text: 'Needs fungicide',
    });
  });

  it('links a Katyayani farmer from another channel without touching the org records', async () => {
    const { service, org, piis } = setup({
      known: 'PII-9',
      lead: { lead_id: 'L-77', source: 'kkd_app' },
      contact: { profile: 'farmer', source: 'kkd_app' },
      head: false,
    });
    const saved = await service.upsert(ME, dto);

    expect(saved).toMatchObject({
      result: 'linked',
      origin: 'linked',
      lead_id: 'L-77',
    });
    expect(org.insertLead).not.toHaveBeenCalled();
    expect(org.updateLead).not.toHaveBeenCalled();
    expect(org.updateContact).not.toHaveBeenCalled();
    expect(piis.saveAddress).not.toHaveBeenCalled();
  });

  it("updates the partner's own farmer, and the org records Vistaar wrote", async () => {
    const { service, org } = setup({
      known: 'PII-9',
      seed: [myRow()],
      lead: { lead_id: 'L-5', source: 'vistaar', created_by: ME.agent_id },
      contact: { profile: 'farmer', source: 'vistaar' },
    });
    const saved = await service.upsert(ME, { ...dto, name: 'Ramesh Kumar' });

    expect(saved.result).toBe('updated');
    expect(saved.name).toBe('Ramesh Kumar');
    expect(org.insertLead).not.toHaveBeenCalled();
    expect(org.updateLead).toHaveBeenCalledWith(
      'L-5',
      expect.objectContaining({ first_name: 'ramesh', last_name: 'kumar' }),
    );
    expect(org.updateContact).toHaveBeenCalled();
  });

  it('takes the next id when the shared counter hands out a used one', async () => {
    const { service, org } = setup({ leadInserts: ['taken_id', 'ok'] });
    await service.upsert(ME, dto);
    expect(org.insertLead).toHaveBeenCalledTimes(2);
  });

  it.each([
    [{ stage: 'kyc_review' }, {}, 'PARTNER_NOT_APPROVED'],
    [{ stage: 'blocked' }, {}, 'ACCOUNT_BLOCKED'],
    [{}, { consent_version: 0 }, 'CONSENT_OUTDATED'],
    [{ cohort: 'ex_employee' }, {}, 'VALIDATION_FAILED'],
    [{}, { next_follow_up: '2020-01-01T00:00:00Z' }, 'VALIDATION_FAILED'],
    [{ known: 'PII-1' }, {}, 'SELF_LEAD'],
    [
      { known: 'PII-9', seed: [myRow({ agent_id: 'VST-000002' })] },
      {},
      'FARMER_TAKEN',
    ],
    [{ known: 'PII-9', contact: { profile: 'retailer' } }, {}, 'NOT_A_FARMER'],
    [{ head: false }, {}, 'LEADS_NOT_CONFIGURED'],
  ])('refuses %j %j before any write (%s)', async (opts, body, code) => {
    const { service, org, rows, piis } = setup(opts);
    expect(await codeOf(service.upsert(ME, { ...dto, ...body }))).toBe(code);
    expect(rows.insert).not.toHaveBeenCalled();
    expect(org.insertLead).not.toHaveBeenCalled();
    expect(piis.resolve).not.toHaveBeenCalled();
  });

  it('accepts an ex-employee who declared', async () => {
    const { service } = setup({ cohort: 'ex_employee' });
    const saved = await service.upsert(ME, {
      ...dto,
      ex_employee_declared: true,
    });
    expect(saved.result).toBe('created');
  });

  it('loses a race to another partner claiming the same farmer', async () => {
    const { service, rows, org } = setup();
    rows.insert.mockResolvedValueOnce(false);
    rows.rows.set('PII-9', myRow({ agent_id: 'VST-000002' }));
    expect(await codeOf(service.upsert(ME, dto))).toBe('FARMER_TAKEN');
    expect(org.insertLead).not.toHaveBeenCalled();
  });
});

describe('LeadsService.update', () => {
  const future = new Date(Date.now() + 86_400_000).toISOString();

  it('keeps won for the first order', async () => {
    const { service } = setup({ seed: [myRow()] });
    expect(await codeOf(service.update(ME, 'PII-9', { stage: 'won' }))).toBe(
      'STAGE_NOT_ALLOWED',
    );
  });

  it('needs a reason to lose a lead, then clears its follow-up', async () => {
    const { service, rows } = setup({
      seed: [myRow({ next_follow_up: new Date(future) })],
    });
    expect(await codeOf(service.update(ME, 'PII-9', { stage: 'lost' }))).toBe(
      'VALIDATION_FAILED',
    );
    const lost = await service.update(ME, 'PII-9', {
      stage: 'lost',
      lost_reason: 'Price too high',
    });
    expect(lost).toMatchObject({
      stage: 'lost',
      lost_reason: 'Price too high',
      next_follow_up: null,
    });
    expect(lost.stage_history.at(-1)).toMatchObject({
      from: 'prospect',
      to: 'lost',
    });
    expect(lost.activities[0]).toMatchObject({
      type: 'stage_change',
      text: 'Marked lost — Price too high',
    });
    expect(rows.update.mock.calls.at(-1)?.[3]).toEqual({ stage: 'prospect' });
  });

  it('reopens a lost lead and clears the reason', async () => {
    const { service } = setup({
      seed: [myRow({ stage: 'lost', lost_reason: 'Not reachable' })],
    });
    const open = await service.update(ME, 'PII-9', {
      stage: 'contacted',
      next_follow_up: future,
    });
    expect(open).toMatchObject({ stage: 'contacted', lost_reason: null });
  });

  it('refuses a past follow-up, and one on a closed lead', async () => {
    const { service } = setup({ seed: [myRow()] });
    expect(
      await codeOf(
        service.update(ME, 'PII-9', { next_follow_up: '2020-01-01T00:00:00Z' }),
      ),
    ).toBe('VALIDATION_FAILED');
    const closed = setup({ seed: [myRow({ stage: 'lost' })] });
    expect(
      await codeOf(
        closed.service.update(ME, 'PII-9', { next_follow_up: future }),
      ),
    ).toBe('VALIDATION_FAILED');
  });

  it('answers 409 when the lead moved meanwhile, 404 for another partner’s', async () => {
    const { service, rows } = setup({ seed: [myRow()] });
    rows.update.mockResolvedValueOnce(null);
    expect(
      await codeOf(service.update(ME, 'PII-9', { stage: 'contacted' })),
    ).toBe('STAGE_CHANGED');
    const other = setup({ seed: [myRow({ agent_id: 'VST-000002' })] });
    expect(
      await codeOf(other.service.update(ME, 'PII-9', { stage: 'contacted' })),
    ).toBe('NOT_FOUND');
  });
});
