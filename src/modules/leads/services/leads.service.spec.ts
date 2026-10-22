import type { HttpException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import type { Env } from '@config/env.schema';

import type { AccessService } from '@modules/access/services/access.service';
import type { AgentsService } from '@modules/agents/services/agents.service';
import type { OtpService } from '@modules/auth/services/otp.service';
import type { EarningCohortsService } from '@modules/earning/services/earning-cohorts.service';
import type { SettingsService } from '@modules/settings/services/settings.service';
import type { PiiService } from '@modules/spine/services/pii.service';
import type { RewardsService } from '@modules/rewards/services/rewards.service';
import type { PincodeService } from '@modules/spine/services/pincode.service';

import { AdminLeadQueryDto, type AddFarmerDto } from '../dto/lead.dto';
import { leadOtpKey, signLeadOtp } from '../lead-otp.domain';
import type {
  InsertResult,
  OrgLeadsRepository,
} from '../repositories/org-leads.repository';
import type { VistaarLeadsRepository } from '../repositories/vistaar-leads.repository';
import { LeadOtpService } from './lead-otp.service';
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
const SECRET = 'a-test-secret-of-at-least-32-characters';
/** The farmer's OTP checked for ME a moment ago, as `POST /leads/otp/verify` answers. */
const otpTokenFor = (agentId: string, phone = '9876543210') =>
  signLeadOtp(leadOtpKey(SECRET), {
    agent_id: agentId,
    phone,
    verified_at: new Date(),
  }).otp_token;
const dto: AddFarmerDto = {
  phone: '+91 98765 43210',
  name: 'Ramesh Patel',
  village: 'rampur',
  pincode: '462026',
  crops: ['Wheat'],
  acreage: 5,
  consent_version: 1,
  otp_token: otpTokenFor(ME.agent_id),
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
    setLocation: jest.fn(
      (
        pii: string,
        agent: string,
        set: Record<string, unknown>,
        replaceable: string[],
      ) => {
        const row = rows.get(pii);
        const current = (row?.location_source as string | null) ?? null;
        if (!row || row.agent_id !== agent) return Promise.resolve(false);
        if (current !== null && !replaceable.includes(current))
          return Promise.resolve(false);
        Object.assign(row, set);
        return Promise.resolve(true);
      },
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
    /** The Vistaar partner whose number is being added. */
    partner?: { pii_id: string | null };
  } = {},
) {
  const agents = {
    findByPhone: jest.fn().mockResolvedValue(opts.partner ?? null),
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
    setAddressGeo: jest.fn().mockResolvedValue(undefined),
  };
  const pincodes = {
    centre: jest.fn().mockResolvedValue(null),
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
    setFollowUp: jest.fn().mockResolvedValue(undefined),
  };
  const rows = fakeRows(opts.seed);
  const earning = { recomputeLater: jest.fn(), useHoldings: jest.fn() };
  const otp = {
    send: jest.fn().mockResolvedValue(undefined),
    verify: jest.fn().mockResolvedValue(undefined),
  };
  const leadOtp = new LeadOtpService(
    otp as unknown as OtpService,
    {
      get: () => SECRET,
    } as unknown as ConfigService<Env, true>,
  );
  const rewards = {
    leadCreated: jest.fn().mockResolvedValue([]),
    followUpDone: jest.fn().mockResolvedValue([]),
    leadRemoved: jest.fn().mockResolvedValue(0),
  };
  const service = new LeadsService(
    org as unknown as OrgLeadsRepository,
    rows as unknown as VistaarLeadsRepository,
    agents as unknown as AgentsService,
    piis as unknown as PiiService,
    pincodes as unknown as PincodeService,
    settings as unknown as SettingsService,
    access as unknown as AccessService,
    earning as unknown as EarningCohortsService,
    leadOtp,
    rewards as unknown as RewardsService,
  );
  return { service, org, rows, piis, pincodes, earning, otp, rewards, agents };
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
    const { service, org, rows, piis, earning } = setup();
    const saved = await service.upsert(ME, { ...dto, note: 'Needs fungicide' });
    // One more open lead: the partner's earning cohort is looked at again.
    expect(earning.recomputeLater).toHaveBeenCalledWith(
      ['VST-000001'],
      'holdings_changed',
    );

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
    const { service, org, earning } = setup({
      known: 'PII-9',
      seed: [myRow()],
      lead: { lead_id: 'L-5', source: 'vistaar', created_by: ME.agent_id },
      contact: { profile: 'farmer', source: 'vistaar' },
    });
    const saved = await service.upsert(ME, { ...dto, name: 'Ramesh Kumar' });

    expect(saved.result).toBe('updated');
    expect(earning.recomputeLater).not.toHaveBeenCalled();
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
    [{ known: 'PII-2', partner: { pii_id: 'PII-2' } }, {}, 'PARTNER_NUMBER'],
    [{ partner: { pii_id: 'PII-2' } }, {}, 'PARTNER_NUMBER'],
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

  it('refuses another partner’s number in the check and the OTP too, not a bare OTP request', async () => {
    const { service, otp } = setup({ partner: { pii_id: 'PII-2' } });
    expect(await codeOf(service.check(ME, dto.phone))).toBe('PARTNER_NUMBER');
    expect(await codeOf(service.sendFarmerOtp(ME, dto.phone, false))).toBe(
      'PARTNER_NUMBER',
    );
    expect(otp.send).not.toHaveBeenCalled();

    const signupOnly = setup({ partner: { pii_id: null } });
    expect((await signupOnly.service.check(ME, dto.phone)).status).toBe('new');
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
    const { service, rows, earning } = setup({
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
    // A lost lead is no longer open.
    expect(earning.recomputeLater).toHaveBeenCalledWith(
      [ME.agent_id],
      'holdings_changed',
    );
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
    const { service, org, rows, earning } = setup({
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
    // Both partners' holdings changed.
    expect(earning.recomputeLater).toHaveBeenCalledWith(
      [ME.agent_id, OTHER],
      'holdings_changed',
    );
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

describe('LeadsService — where the farmer is', () => {
  // Bhopal's 462026 centre, and a fix 2 km from it.
  const CENTRE = { lat: 23.2, lng: 77.4 };
  const NEAR = { lat: 23.21, lng: 77.41, accuracy_m: 20 };
  const FAR = { lat: 23.6, lng: 77.4 }; // ~44 km away: the partner was elsewhere

  it('places a new farmer at the phone fix when it fits, and on the org address', async () => {
    const { service, rows, piis, pincodes } = setup();
    pincodes.centre.mockResolvedValue(CENTRE);
    const saved = await service.upsert(ME, { ...dto, location: NEAR });
    expect(saved.location).toMatchObject({
      lat: 23.21,
      lng: 77.41,
      exact: true,
      source: 'add',
    });
    expect(rows.rows.get('PII-9')?.location_source).toBe('add');
    expect(piis.setAddressGeo).toHaveBeenCalledWith('PII-9', 'vistaar', {
      lat: 23.21,
      lng: 77.41,
    });
  });

  it('falls back to the pincode centre for a vague or missing fix', async () => {
    const vague = setup();
    vague.pincodes.centre.mockResolvedValue(CENTRE);
    expect(
      (
        await vague.service.upsert(ME, {
          ...dto,
          location: { ...FAR, accuracy_m: 900 },
        })
      ).location,
    ).toMatchObject({ lat: 23.2, exact: false, source: 'pincode' });
    expect(vague.piis.setAddressGeo).not.toHaveBeenCalled();

    const none = setup();
    none.pincodes.centre.mockResolvedValue(CENTRE);
    expect((await none.service.upsert(ME, dto)).location?.source).toBe(
      'pincode',
    );
  });

  it('trusts a precise fix even far from the pincode point (those points are often wrong)', async () => {
    const { service, pincodes } = setup();
    pincodes.centre.mockResolvedValue(CENTRE);
    expect(
      (await service.upsert(ME, { ...dto, location: FAR })).location,
    ).toMatchObject({
      exact: true,
      source: 'add',
    });
  });

  it('a farm visit outranks an add; an order never moves a visited farm', async () => {
    const { service, rows, pincodes } = setup({
      seed: [
        myRow({
          pincode: '462026',
          location_source: 'add',
          location: { type: 'Point', coordinates: [77.41, 23.21] },
        }),
      ],
    });
    pincodes.centre.mockResolvedValue(CENTRE);
    await service.addActivity(ME, 'PII-9', {
      type: 'visit',
      text: 'At the farm',
      location: { lat: 23.205, lng: 77.402 },
    });
    expect(rows.rows.get('PII-9')?.location_source).toBe('visit');

    expect(
      await service.recordLocation(ME.agent_id, 'PII-9', {
        lat: 23.22,
        lng: 77.42,
      }),
    ).toBe(false);
    expect(rows.rows.get('PII-9')?.location_source).toBe('visit');
  });

  it('an order places a farmer known only by pincode; someone else’s farmer is ignored', async () => {
    const { service, rows, pincodes } = setup({
      seed: [
        myRow({
          pincode: '462026',
          location_source: 'pincode',
          location: { type: 'Point', coordinates: [77.4, 23.2] },
        }),
      ],
    });
    pincodes.centre.mockResolvedValue(CENTRE);
    expect(await service.recordLocation(ME.agent_id, 'PII-9', NEAR)).toBe(true);
    expect(rows.rows.get('PII-9')?.location_source).toBe('order');
    expect(await service.recordLocation('VST-000002', 'PII-9', NEAR)).toBe(
      false,
    );
  });

  it('a new pincode re-centres a farmer placed only by pincode', async () => {
    const { service, rows, pincodes } = setup({
      seed: [
        myRow({
          pincode: '462026',
          name: 'R',
          phone: '9876543210',
          village: 'V',
          crops: ['Wheat'],
          acreage: 5,
          location_source: 'pincode',
          location: { type: 'Point', coordinates: [77.4, 23.2] },
        }),
      ],
    });
    pincodes.centre.mockResolvedValue({ lat: 23.5, lng: 77.8 });
    await service.update(ME, 'PII-9', { pincode: '464001' });
    expect(rows.rows.get('PII-9')?.location).toEqual({
      type: 'Point',
      coordinates: [77.8, 23.5],
    });
  });
});

describe('LeadsService — HO list and map', () => {
  it('sorts only by a known field, and narrows to follow-ups due by tonight', async () => {
    const { service, rows } = setup();
    const listRecent = jest.fn().mockResolvedValue({ items: [], total: 0 });
    Object.assign(rows, { listRecent });

    const bad = Object.assign(new AdminLeadQueryDto(), { sort: 'name' });
    expect(await codeOf(service.list(bad))).toBe('VALIDATION_FAILED');

    await service.list(
      Object.assign(new AdminLeadQueryDto(), {
        due: true,
        district: 'bhopal',
        sort: '-last_order_at',
      }),
    );
    const [filter, , sort] = listRecent.mock.calls[0] as [
      Record<string, unknown>,
      unknown,
      Record<string, number>,
    ];
    expect(filter.due_before).toBeInstanceOf(Date);
    expect(filter.district).toBe('bhopal');
    expect(sort).toEqual({ last_order_at: -1 });

    // By follow-up: only leads that have one (nulls would fill page 1).
    await service.list(
      Object.assign(new AdminLeadQueryDto(), { sort: 'next_follow_up' }),
    );
    const [byFollowUp] = listRecent.mock.calls[1] as [Record<string, unknown>];
    expect(byFollowUp.has_follow_up).toBe(true);
  });

  it('reads a from / to day as the IST day', async () => {
    const { service, rows } = setup();
    const listRecent = jest.fn().mockResolvedValue({ items: [], total: 0 });
    Object.assign(rows, { listRecent });
    await service.list(
      Object.assign(new AdminLeadQueryDto(), {
        from: '2026-10-22',
        to: '2026-10-22',
        sort: '-created_at',
      }),
    );
    const [filter] = listRecent.mock.calls[0] as [{ from: Date; to: Date }];
    const inRange = (at: string) =>
      filter.from <= new Date(at) && new Date(at) < filter.to;
    expect(inRange('2026-10-22T01:00:00+05:30')).toBe(true);
    expect(inRange('2026-10-23T03:00:00+05:30')).toBe(false);
  });

  it('gives the map one dot per placed farmer and says when it stopped at the cap', async () => {
    const { service, rows } = setup();
    const dot = (pii: string) => ({
      pii_id: pii,
      agent_id: ME.agent_id,
      name: pii,
      stage: 'won',
      village: 'Kolar',
      district: 'BHOPAL',
      crops: ['wheat'],
      location: { type: 'Point', coordinates: [77.4, 23.2] },
      location_source: 'pincode',
      location_at: new Date('2026-10-01T00:00:00Z'),
    });
    const places = jest.fn().mockResolvedValue([dot('PII-1'), dot('PII-2')]);
    Object.assign(rows, { places });

    const out = await service.places({ stage: 'won' });
    expect(out.capped).toBe(false);
    expect(out.items[0]).toEqual({
      pii_id: 'PII-1',
      agent_id: ME.agent_id,
      name: 'PII-1',
      stage: 'won',
      village: 'Kolar',
      district: 'BHOPAL',
      state: null,
      crops: ['wheat'],
      lat: 23.2,
      lng: 77.4,
      exact: false,
      at: new Date('2026-10-01T00:00:00Z'),
    });
    expect((places.mock.calls[0] as [unknown, number])[1]).toBe(5_001);
  });
});

describe('LeadsService — farmer OTP on lead add', () => {
  it('refuses a save without the farmer’s OTP token, before anything is written', async () => {
    const { service, rows, piis } = setup();
    const { otp_token: _unused, ...bare } = dto;
    expect(await codeOf(service.upsert(ME, bare))).toBe('LEAD_OTP_REQUIRED');
    expect(piis.findIdByPhone).not.toHaveBeenCalled();
    expect(piis.resolve).not.toHaveBeenCalled();
    expect(rows.insert).not.toHaveBeenCalled();
  });

  it.each([
    ['another partner’s', otpTokenFor('VST-000002')],
    ['another mobile’s', otpTokenFor(ME.agent_id, '9876500000')],
    ['a forged', `${otpTokenFor(ME.agent_id).split('.')[0]}.AAAA`],
  ])('refuses %s token', async (_label, token) => {
    const { service, rows } = setup();
    expect(await codeOf(service.upsert(ME, { ...dto, otp_token: token }))).toBe(
      'LEAD_OTP_INVALID',
    );
    expect(rows.insert).not.toHaveBeenCalled();
  });

  it('refuses a token older than 15 minutes', async () => {
    const { service } = setup();
    const stale = signLeadOtp(leadOtpKey(SECRET), {
      agent_id: ME.agent_id,
      phone: '9876543210',
      verified_at: new Date(Date.now() - 16 * 60_000),
    }).otp_token;
    expect(await codeOf(service.upsert(ME, { ...dto, otp_token: stale }))).toBe(
      'LEAD_OTP_INVALID',
    );
  });

  it('verifies through the lead scope and hands back a token the save takes; stores when', async () => {
    const { service, otp, rows } = setup();
    const { otp_token } = await service.verifyFarmerOtp(
      ME,
      '+91 98765 43210',
      '1234',
    );
    expect(otp.verify).toHaveBeenCalledWith(
      '9876543210',
      '+91',
      '1234',
      'lead',
    );
    await service.upsert(ME, { ...dto, otp_token });
    expect(rows.rows.get('PII-9')?.otp_verified_at).toBeInstanceOf(Date);
  });

  it('sends the farmer’s OTP for approved partners only', async () => {
    const { service, otp } = setup();
    expect(await service.sendFarmerOtp(ME, '9876543210', false)).toEqual({
      sent: true,
      resend_after_seconds: 30,
    });
    expect(otp.send).toHaveBeenCalledWith('9876543210', '+91', false, 'lead');

    const pending = setup({ stage: 'kyc_pending' });
    expect(
      await codeOf(pending.service.sendFarmerOtp(ME, '9876543210', false)),
    ).toBe('PARTNER_NOT_APPROVED');
    expect(pending.otp.send).not.toHaveBeenCalled();
  });
});

describe('LeadsService — rewards', () => {
  it('rewards a new farmer with its facts, before the cohort is looked at again', async () => {
    const { service, rewards, earning } = setup();
    await service.upsert(ME, { ...dto, district: 'Sehore' });
    expect(rewards.leadCreated).toHaveBeenCalledWith(ME.agent_id, {
      pii_id: 'PII-9',
      name: 'Ramesh Patel',
      crops: ['Wheat'],
      acreage: 5,
      district: 'Sehore',
      state: 'MADHYA PRADESH',
    });
    expect(rewards.leadCreated.mock.invocationCallOrder[0]).toBeLessThan(
      earning.recomputeLater.mock.invocationCallOrder[0],
    );
  });

  it('does not reward the partner’s own farmer saved again', async () => {
    const { service, rewards } = setup({
      known: 'PII-9',
      seed: [myRow()],
      lead: { lead_id: 'L-5', source: 'vistaar', created_by: ME.agent_id },
      contact: { profile: 'farmer', source: 'vistaar' },
    });
    expect((await service.upsert(ME, dto)).result).toBe('updated');
    expect(rewards.leadCreated).not.toHaveBeenCalled();
  });

  it('passes the follow-up as it was due to the follow-up reward', async () => {
    const due = daysAgo(2);
    const { service, rewards } = setup({
      seed: [myRow({ next_follow_up: due })],
    });
    await service.addActivity(ME, 'PII-9', { type: 'visit', text: 'At farm' });
    expect(rewards.followUpDone).toHaveBeenCalledWith(
      ME.agent_id,
      expect.objectContaining({ pii_id: 'PII-9' }),
      due,
      'visit',
      expect.any(Date),
    );
  });

  it('closes the pending lead-added rewards of a removed lead', async () => {
    const { service, rewards } = setup({ seed: [myRow()] });
    await service.remove(ME, 'PII-9');
    expect(rewards.leadRemoved).toHaveBeenCalledWith(ME.agent_id, 'PII-9');
  });
});
