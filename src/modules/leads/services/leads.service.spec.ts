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

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

/** Applies `$set` / `$push` (with `$slice`) as Mongo would, and stamps `updated_at`. */
function apply(row: Row, upd: Update): Row {
  Object.assign(row, upd.$set ?? {});
  for (const [key, value] of Object.entries(upd.$push ?? {}))
    row[key] = [...((row[key] as unknown[]) ?? []), ...value.$each];
  row.updated_at = new Date();
  return { ...row };
}

/** Just enough of `vistaar_v2_leads` to run the claim, update, takeover and race paths for real. */
function fakeRows(seed: Row[] = []) {
  const rows = new Map<string, Row>(seed.map((r) => [r.pii_id, { ...r }]));
  return {
    rows,
    findByPii: jest.fn((pii: string) =>
      Promise.resolve(rows.has(pii) ? { ...rows.get(pii)! } : null),
    ),
    isHeldBy: jest.fn((pii: string, agent: string) =>
      Promise.resolve(rows.get(pii)?.agent_id === agent),
    ),
    remove: jest.fn((pii: string, agent: string) => {
      const row = rows.get(pii);
      if (!row || row.agent_id !== agent || row.stage === 'won')
        return Promise.resolve(false);
      rows.delete(pii);
      return Promise.resolve(true);
    }),
    partnerSummary: jest.fn(() =>
      Promise.resolve({
        total: 10,
        open: 7,
        pipeline_value: 0,
        won: 2,
        lost: 1,
        due: 0,
        by_stage: [],
      }),
    ),
    insert: jest.fn((row: Row) => {
      if (rows.has(row.pii_id)) return Promise.resolve(false);
      const now = new Date();
      rows.set(row.pii_id, { ...row, created_at: now, updated_at: now });
      return Promise.resolve(true);
    }),
    takeOver: jest.fn(
      (
        pii: string,
        from: { agent_id: string; updated_at: Date },
        upd: Update,
      ) => {
        const row = rows.get(pii);
        if (
          !row ||
          row.agent_id !== from.agent_id ||
          (row.updated_at as Date).getTime() !== from.updated_at.getTime()
        )
          return Promise.resolve(null);
        return Promise.resolve(apply(row, upd));
      },
    ),
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
        return Promise.resolve(apply(row, upd));
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
    /** Partners whose account is blocked. */
    blocked?: string[];
  } = {},
) {
  const agents = {
    isOutOfWork: jest.fn((id: string) =>
      Promise.resolve((opts.blocked ?? []).includes(id)),
    ),
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
      lead_release_days: 15,
      customer_release_days: 45,
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
  created_at: daysAgo(1),
  updated_at: daysAgo(1),
  last_worked_at: daysAgo(1),
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

describe('LeadsService.holds', () => {
  it('answers for the holding partner only — a linked farmer included', async () => {
    const { service } = setup({
      seed: [
        myRow(),
        myRow({ pii_id: 'PII-10', origin: 'linked', lead_id: 'L-77' }),
        myRow({ pii_id: 'PII-11', agent_id: 'VST-000002' }),
      ],
    });
    expect(await service.holds(ME.agent_id, 'pii-9')).toBe(true);
    expect(await service.holds(ME.agent_id, 'PII-10')).toBe(true);
    expect(await service.holds(ME.agent_id, 'PII-11')).toBe(false);
    expect(await service.holds(ME.agent_id, 'PII-404')).toBe(false);
  });
});

describe('LeadsService — release and transfer', () => {
  const OTHER = 'VST-000002';
  const theirs = (extra: Record<string, unknown> = {}) =>
    myRow({
      agent_id: OTHER,
      stage: 'negotiation',
      activities: [{ id: 'a1', type: 'note', text: 'their note' }],
      held_since: daysAgo(40),
      ...extra,
    });
  const theirLead = { lead_id: 'L-5', source: 'vistaar', created_by: OTHER };

  it('takes over a farmer the other partner left unworked for 15 days', async () => {
    const { service, org, rows } = setup({
      known: 'PII-9',
      seed: [theirs({ last_worked_at: daysAgo(16), updated_at: daysAgo(16) })],
      lead: theirLead,
    });
    expect((await service.check(ME, dto.phone)).status).toBe('released');

    const saved = await service.upsert(ME, dto);
    expect(saved).toMatchObject({
      result: 'linked',
      origin: 'linked',
      agent_id: ME.agent_id,
      lead_id: 'L-5',
      stage: 'prospect',
      activities: [],
    });
    expect(rows.rows.get('PII-9')?.holder_history).toEqual([
      expect.objectContaining({
        agent_id: OTHER,
        reason: 'released',
        by: ME.agent_id,
      }),
    ]);
    // The org's lead and contact stay the first partner's.
    expect(org.insertLead).not.toHaveBeenCalled();
    expect(org.updateLead).not.toHaveBeenCalled();
    expect(org.updateContact).not.toHaveBeenCalled();
  });

  it('keeps a farmer worked within 15 days with their partner', async () => {
    const { service } = setup({
      known: 'PII-9',
      seed: [theirs({ last_worked_at: daysAgo(14) })],
      lead: theirLead,
    });
    expect((await service.check(ME, dto.phone)).status).toBe('other_partner');
    expect(await codeOf(service.upsert(ME, dto))).toBe('FARMER_TAKEN');
  });

  it("frees a blocked partner's farmers at once", async () => {
    const { service, rows } = setup({
      known: 'PII-9',
      seed: [theirs()],
      lead: theirLead,
      blocked: [OTHER],
    });
    await service.upsert(ME, dto);
    expect(rows.rows.get('PII-9')).toMatchObject({
      agent_id: ME.agent_id,
      holder_history: [expect.objectContaining({ reason: 'partner_blocked' })],
    });
  });

  it('loses the takeover when the partner worked the farmer meanwhile', async () => {
    const { service, rows } = setup({
      known: 'PII-9',
      seed: [theirs({ last_worked_at: daysAgo(16) })],
      lead: theirLead,
    });
    rows.takeOver.mockResolvedValueOnce(null);
    expect(await codeOf(service.upsert(ME, dto))).toBe('FARMER_TAKEN');
  });

  it('keeps a customer won, released 45 days after the last order', async () => {
    const customer = {
      stage: 'won',
      customer_at: daysAgo(100),
      held_since: daysAgo(100),
      last_worked_at: daysAgo(1),
    };
    const kept = setup({
      known: 'PII-9',
      seed: [theirs({ ...customer, last_order_at: daysAgo(44) })],
      lead: theirLead,
    });
    expect(await codeOf(kept.service.upsert(ME, dto))).toBe('FARMER_TAKEN');

    const freed = setup({
      known: 'PII-9',
      seed: [theirs({ ...customer, last_order_at: daysAgo(46) })],
      lead: theirLead,
    });
    const saved = await freed.service.upsert(ME, dto);
    expect(saved).toMatchObject({ stage: 'won', agent_id: ME.agent_id });
    expect(saved.customer_at).toEqual(customer.customer_at);
  });

  it('renews the hold on any work, and shows when it lapses', async () => {
    const { service, rows } = setup({
      seed: [myRow({ last_worked_at: daysAgo(10) })],
    });
    const before = Date.now();
    const saved = await service.update(ME, 'PII-9', { expected_value: 900 });
    const worked = rows.rows.get('PII-9')?.last_worked_at as Date;
    expect(worked.getTime()).toBeGreaterThanOrEqual(before);
    expect(saved.releases_at.getTime()).toBe(worked.getTime() + 15 * DAY);

    await service.addActivity(ME, 'PII-9', { type: 'call', text: 'Called' });
    expect(
      (rows.rows.get('PII-9')?.last_worked_at as Date).getTime(),
    ).toBeGreaterThanOrEqual(worked.getTime());
  });

  it('lets HO move a farmer to another approved partner', async () => {
    const seeded = myRow({ stage: 'interested' });
    const { service, rows } = setup({ seed: [seeded] });
    const moved = await service.transfer(
      'PII-9',
      { agent_id: OTHER, reason: 'Partner left' },
      'ho@katyayaniorganics.com',
    );
    expect(moved).toMatchObject({
      agent_id: OTHER,
      origin: 'linked',
      stage: 'prospect',
      holder_history: [
        expect.objectContaining({
          agent_id: ME.agent_id,
          reason: 'transferred',
          by: 'ho@katyayaniorganics.com',
          note: 'Partner left',
        }),
      ],
    });
    expect(moved.activities[0].text).toContain('Partner left');
    // The farmer's consent was given to Katyayani: it moves with them.
    expect(rows.rows.get('PII-9')?.consent).toEqual(seeded.consent);
  });

  it('refuses a transfer to the same or an unapproved partner', async () => {
    const same = setup({ seed: [myRow()] });
    expect(
      await codeOf(
        same.service.transfer(
          'PII-9',
          { agent_id: ME.agent_id, reason: 'x' },
          'ho',
        ),
      ),
    ).toBe('VALIDATION_FAILED');
    const pending = setup({ seed: [myRow()], stage: 'kyc_review' });
    expect(
      await codeOf(
        pending.service.transfer(
          'PII-9',
          { agent_id: OTHER, reason: 'x' },
          'ho',
        ),
      ),
    ).toBe('PARTNER_NOT_APPROVED');
  });
});

describe('LeadsService — edit, remove, cards', () => {
  const farmerRow = (extra: Record<string, unknown> = {}) =>
    myRow({
      name: 'Ramesh',
      phone: '9876543210',
      village: 'Rampur',
      district: 'BHOPAL',
      state: 'MADHYA PRADESH',
      pincode: '462026',
      crops: ['Wheat'],
      acreage: 5,
      ...extra,
    });

  it('edits the farmer; the org lead Vistaar created follows', async () => {
    const { service, rows, org } = setup({
      seed: [farmerRow()],
      lead: { lead_id: 'L-5', source: 'vistaar', created_by: ME.agent_id },
      contact: { profile: 'farmer', source: 'vistaar' },
    });
    const saved = await service.update(ME, 'PII-9', {
      name: 'ramesh  kumar',
      crops: ['soybean', 'wheat'],
      acreage: 8,
    });
    expect(saved).toMatchObject({
      name: 'Ramesh Kumar',
      crops: ['Soybean', 'Wheat'],
      acreage: 8,
      phone: '9876543210',
      village: 'Rampur',
    });
    expect(rows.rows.get('PII-9')?.last_worked_at).toBeInstanceOf(Date);
    expect(org.updateLead).toHaveBeenCalledWith(
      'L-5',
      expect.objectContaining({ first_name: 'ramesh', last_name: 'kumar' }),
    );
  });

  it('edits only the partner’s copy for a farmer from another channel', async () => {
    const { service, org } = setup({
      seed: [farmerRow({ origin: 'linked' })],
      lead: { lead_id: 'L-77', source: 'kkd_app' },
    });
    await service.update(ME, 'PII-9', { village: 'Kheda' });
    expect(org.updateLead).not.toHaveBeenCalled();
    expect(org.updateContact).not.toHaveBeenCalled();
  });

  it('removes a lead and frees the farmer, but never a customer', async () => {
    const { service, rows } = setup({ seed: [farmerRow()] });
    expect(await service.remove(ME, 'pii-9')).toEqual({ removed: true });
    expect(rows.rows.has('PII-9')).toBe(false);

    const won = setup({ seed: [farmerRow({ stage: 'won' })] });
    expect(await codeOf(won.service.remove(ME, 'PII-9'))).toBe(
      'STAGE_NOT_ALLOWED',
    );
    const theirs = setup({ seed: [farmerRow({ agent_id: 'VST-000002' })] });
    expect(await codeOf(theirs.service.remove(ME, 'PII-9'))).toBe('NOT_FOUND');
  });

  it('counts conversion as won of all leads, as the app does', async () => {
    const { service } = setup();
    expect((await service.summaryMine(ME)).conversion_pct).toBe(20);
  });
});
