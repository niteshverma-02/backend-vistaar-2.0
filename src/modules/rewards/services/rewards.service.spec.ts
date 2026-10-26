import type { HttpException } from '@nestjs/common';
import { mongo, type Model } from 'mongoose';

import type { AgentsService } from '@modules/agents/services/agents.service';
import type {
  EarnedReward,
  EarningRulesService,
} from '@modules/earning/services/earning-rules.service';
import type { SettingsService } from '@modules/settings/services/settings.service';

import {
  CoinAccountRepository,
  type CoinAccountRecord,
} from '../repositories/coin-account.repository';
import {
  RewardRepository,
  type NewReward,
  type RewardRecord,
} from '../repositories/reward.repository';
import type { RewardDocument } from '../schemas/reward.schema';
import { RewardsService } from './rewards.service';

const AGENT = 'VST-000006';
const HO = 'ho@katyayaniorganics.com';
const FARMER = {
  pii_id: 'PII-9',
  name: 'Ramesh Patel',
  crops: ['Paddy'],
  acreage: 3,
  district: 'Raipur',
  state: 'CHHATTISGARH',
};

const earned = (kind: 'coin' | 'gig', amount: number): EarnedReward => ({
  rule_id: `rule-${kind}`,
  rule_name: `${kind} rule`,
  cohort_id: 'ec_paddy',
  kind,
  amount,
});

/** Just enough of `vistaar_v2_rewards`: inserts keyed by `_id`, decisions filtered on pending. */
function fakeRepo() {
  const rows = new Map<string, RewardRecord>();
  const decideOne = (
    id: string,
    status: 'approved' | 'rejected',
    reason: string | null,
    by: string,
    at: Date,
    agentId?: string,
  ) => {
    const row = rows.get(id);
    if (!row || row.status !== 'pending') return null;
    if (agentId && row.agent_id !== agentId) return null;
    Object.assign(row, { status, reason, reviewed_by: by, reviewed_at: at });
    return { ...row };
  };
  return {
    rows,
    insertNew: jest.fn((list: NewReward[]) => {
      const now = new Date();
      const ids: string[] = [];
      for (const r of list) {
        if (rows.has(r._id)) continue;
        rows.set(r._id, { ...r, created_at: now, updated_at: now });
        ids.push(r._id);
      }
      return Promise.resolve(ids);
    }),
    find: jest.fn((id: string) =>
      Promise.resolve(rows.has(id) ? { ...rows.get(id)! } : null),
    ),
    findMany: jest.fn((ids: string[]) =>
      Promise.resolve(
        ids.filter((id) => rows.has(id)).map((id) => ({ ...rows.get(id)! })),
      ),
    ),
    decide: jest.fn(
      (
        id: string,
        s: 'approved' | 'rejected',
        reason: string | null,
        by: string,
        at: Date,
      ) => Promise.resolve(decideOne(id, s, reason, by, at)),
    ),
    decideMany: jest.fn(
      (
        ids: string[],
        s: 'approved' | 'rejected',
        reason: string | null,
        by: string,
        at: Date,
        agentId?: string,
      ) =>
        Promise.resolve(
          ids.filter((id) => decideOne(id, s, reason, by, at, agentId)).length,
        ),
    ),
    totals: jest.fn((f: { kind?: string; status?: string }) =>
      Promise.resolve(
        [
          { kind: 'coin', status: 'approved', count: 3, amount: 30 },
          { kind: 'coin', status: 'pending', count: 1, amount: 10 },
          { kind: 'gig', status: 'pending', count: 2, amount: 100 },
        ].filter(
          (t) =>
            (!f.kind || t.kind === f.kind) &&
            (!f.status || t.status === f.status),
        ),
      ),
    ),
  };
}

/** `vistaar_v2_coin_accounts` as Mongo applies the three guarded updates. */
function fakeCoinAccounts() {
  const accounts = new Map<string, CoinAccountRecord>();
  const now = new Date();
  return {
    accounts,
    find: jest.fn((agent: string) =>
      Promise.resolve(
        accounts.has(agent) ? structuredClone(accounts.get(agent)!) : null,
      ),
    ),
    hold: jest.fn(
      (
        agent: string,
        id: string,
        coins: number,
        approved: number,
        at: Date,
      ) => {
        const a = accounts.get(agent);
        if (!a) {
          accounts.set(agent, {
            _id: agent,
            spent: coins,
            redemptions: [{ id, coins, active: true, at, released_at: null }],
            created_at: now,
            updated_at: now,
          });
          return Promise.resolve(true);
        }
        if (
          a.spent > approved - coins ||
          a.redemptions.some((r) => r.id === id)
        )
          return Promise.resolve(false);
        a.spent += coins;
        a.redemptions.push({ id, coins, active: true, at, released_at: null });
        return Promise.resolve(true);
      },
    ),
    rehold: jest.fn(
      (
        agent: string,
        id: string,
        coins: number,
        approved: number,
        at: Date,
      ) => {
        const a = accounts.get(agent);
        const r = a?.redemptions.find((x) => x.id === id && !x.active);
        if (!a || !r || a.spent > approved - coins)
          return Promise.resolve(false);
        a.spent += coins;
        Object.assign(r, { coins, active: true, at, released_at: null });
        return Promise.resolve(true);
      },
    ),
    release: jest.fn((agent: string, id: string, coins: number, at: Date) => {
      const a = accounts.get(agent);
      const r = a?.redemptions.find(
        (x) => x.id === id && x.coins === coins && x.active,
      );
      if (!a || !r) return Promise.resolve(false);
      a.spent -= coins;
      Object.assign(r, { active: false, released_at: at });
      return Promise.resolve(true);
    }),
  };
}

function setup(rewards: EarnedReward[] = [earned('coin', 10)]) {
  const repo = fakeRepo();
  const rules = {
    evaluate: jest.fn().mockResolvedValue(rewards),
    coinRedeemLimit: jest.fn().mockResolvedValue({ pct: 10, max: null }),
  };
  const agents = {
    partnersByAgentIds: jest
      .fn()
      .mockResolvedValue(new Map([[AGENT, { agent_id: AGENT, name: 'Asha' }]])),
  };
  const settings = {
    get: jest.fn().mockResolvedValue({ gig_pay_enabled: false }),
  };
  const coins = fakeCoinAccounts();
  const service = new RewardsService(
    repo as unknown as RewardRepository,
    rules as unknown as EarningRulesService,
    agents as unknown as AgentsService,
    settings as unknown as SettingsService,
    coins as unknown as CoinAccountRepository,
  );
  return { service, repo, rules, coins };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return ((error as HttpException).getResponse() as { error: string }).error;
  }
  return 'no error';
}

/** 16 Oct 2026, 11:00 IST. */
const NOW = new Date('2026-10-16T05:30:00Z');

describe('RewardsService — events', () => {
  it('records a pending row per kind the rules pay, with the rule and cohort of the moment', async () => {
    const { service, repo, rules } = setup([
      earned('coin', 10),
      earned('gig', 50),
    ]);
    expect(await service.leadCreated(AGENT, FARMER)).toEqual([
      'lead_created:PII-9:coin',
      'lead_created:PII-9:gig',
    ]);
    expect(rules.evaluate).toHaveBeenCalledWith(AGENT, 'lead_created', {
      crops: ['Paddy'],
      acreage: 3,
      farmer_district: 'Raipur',
      farmer_state: 'CHHATTISGARH',
    });
    expect(repo.rows.get('lead_created:PII-9:gig')).toMatchObject({
      agent_id: AGENT,
      rule_id: 'rule-gig',
      rule_name: 'gig rule',
      cohort_id: 'ec_paddy',
      trigger: 'lead_created',
      farmer_name: 'Ramesh Patel',
      due_day: null,
      amount: 50,
      status: 'pending',
    });
  });

  it('writes nothing when no rule pays, or one pays 0', async () => {
    const none = setup([]);
    expect(await none.service.leadCreated(AGENT, FARMER)).toEqual([]);
    expect(none.repo.insertNew).not.toHaveBeenCalled();

    const zero = setup([earned('coin', 0)]);
    expect(await zero.service.leadCreated(AGENT, FARMER)).toEqual([]);
    expect(zero.repo.insertNew).not.toHaveBeenCalled();
  });

  it('never fails the partner’s request when recording fails', async () => {
    const { service, rules } = setup();
    rules.evaluate.mockRejectedValueOnce(new Error('mongo down'));
    await expect(service.leadCreated(AGENT, FARMER)).resolves.toEqual([]);
  });

  it('pays a follow-up only when due by the end of today (IST), keyed on its due day', async () => {
    const { service, rules, repo } = setup([earned('gig', 20)]);
    const farmer = { pii_id: 'PII-9', name: 'Ramesh Patel' };

    const tomorrow = new Date('2026-10-17T03:30:00Z');
    expect(
      await service.followUpDone(AGENT, farmer, tomorrow, 'call', NOW),
    ).toEqual([]);
    expect(await service.followUpDone(AGENT, farmer, NOW, 'note', NOW)).toEqual(
      [],
    );
    expect(rules.evaluate).not.toHaveBeenCalled();

    const overdue = new Date('2026-10-14T12:00:00Z');
    expect(
      await service.followUpDone(AGENT, farmer, overdue, 'visit', NOW),
    ).toEqual(['follow_up_done:PII-9:2026-10-14:gig']);
    expect(rules.evaluate).toHaveBeenCalledWith(AGENT, 'follow_up_done', {
      activity_type: 'visit',
      days_overdue: 2,
    });
    expect(repo.rows.get('follow_up_done:PII-9:2026-10-14:gig')?.due_day).toBe(
      '2026-10-14',
    );

    // A second call on the same due day: already rewarded.
    expect(
      await service.followUpDone(AGENT, farmer, overdue, 'call', NOW),
    ).toEqual([]);
  });

  it('closes a removed lead’s pending lead-added rewards, never decided ones', async () => {
    const { service, repo } = setup([earned('coin', 10), earned('gig', 5)]);
    await service.leadCreated(AGENT, FARMER);
    await service.approve('lead_created:PII-9:gig', HO);

    expect(await service.leadRemoved(AGENT, 'PII-9')).toBe(1);
    expect(repo.rows.get('lead_created:PII-9:coin')).toMatchObject({
      status: 'rejected',
      reason: 'lead removed',
      reviewed_by: 'system',
    });
    expect(repo.rows.get('lead_created:PII-9:gig')?.status).toBe('approved');
  });
});

describe('RewardsService — HO review', () => {
  async function seeded() {
    const ctx = setup([earned('coin', 10), earned('gig', 50)]);
    await ctx.service.leadCreated(AGENT, FARMER);
    return ctx;
  }

  it('approves a pending reward once; a second decision is a 409, an unknown id a 404', async () => {
    const { service } = await seeded();
    const view = await service.approve('lead_created:PII-9:gig', HO);
    expect(view).toMatchObject({
      status: 'approved',
      reviewed_by: HO,
      partner: { name: 'Asha' },
    });
    expect(
      await codeOf(service.reject('lead_created:PII-9:gig', 'dup', HO)),
    ).toBe('REWARD_NOT_PENDING');
    expect(await codeOf(service.approve('lead_created:PII-0:coin', HO))).toBe(
      'NOT_FOUND',
    );
  });

  it('bulk: moves only pending rows and says why the rest were skipped', async () => {
    const { service } = await seeded();
    await service.reject('lead_created:PII-9:coin', 'Not a farmer', HO);

    const out = await service.approveMany(
      [
        'lead_created:PII-9:gig',
        'lead_created:PII-9:coin',
        'lead_created:PII-0:coin',
      ],
      HO,
    );
    expect(out).toEqual({
      changed: ['lead_created:PII-9:gig'],
      skipped: [
        { id: 'lead_created:PII-9:coin', status: 'rejected' },
        { id: 'lead_created:PII-0:coin', status: null },
      ],
    });
  });

  it('the app summary: coins and gig ₹ by status, and whether gig pay is on', async () => {
    const { service } = setup();
    expect(await service.summaryMine(AGENT)).toEqual({
      coins: {
        approved: 30,
        pending: 10,
        spent: 0,
        available: 30,
        max_pct: 10,
        max_per_order: null,
      },
      gig: { approved_amount: 0, pending_amount: 100, pay_enabled: false },
    });
  });
});

describe('RewardsService — coins at checkout', () => {
  const A = '11111111-1111-4111-8111-111111111111';
  const B = '22222222-2222-4222-8222-222222222222';

  it('spends approved coins once per checkout attempt; a retry answers the same hold', async () => {
    const { service, coins } = setup();
    expect(await service.spendCoins('vst-000006', A, 20, 1000)).toEqual({
      request_id: A,
      coins: 20,
      available: 10,
    });
    expect(await service.spendCoins(AGENT, A, 20, 1000)).toEqual({
      request_id: A,
      coins: 20,
      available: 10,
    });
    expect(coins.accounts.get(AGENT)?.spent).toBe(20);
    expect((await service.summaryMine(AGENT)).coins).toEqual({
      approved: 30,
      pending: 10,
      spent: 20,
      available: 10,
      max_pct: 10,
      max_per_order: null,
    });
  });

  it('refuses more than the cohort % of the subtotal', async () => {
    const { service, rules, coins } = setup();
    rules.coinRedeemLimit.mockResolvedValue({ pct: 5, max: null });
    expect(await codeOf(service.spendCoins(AGENT, A, 11, 200))).toBe(
      'COINS_OVER_LIMIT',
    );
    expect(coins.accounts.get(AGENT)?.spent ?? 0).toBe(0);
    expect((await service.spendCoins(AGENT, A, 10, 200)).coins).toBe(10);
  });

  it('refuses more than the cohort cap per order, whatever the %', async () => {
    const { service, rules } = setup();
    rules.coinRedeemLimit.mockResolvedValue({ pct: 100, max: 15 });
    expect(await codeOf(service.spendCoins(AGENT, A, 16, 1000))).toBe(
      'COINS_OVER_LIMIT',
    );
    expect((await service.spendCoins(AGENT, A, 15, 1000)).coins).toBe(15);
  });

  it('refuses more than the approved coins not yet spent', async () => {
    const { service } = setup();
    expect(await codeOf(service.spendCoins(AGENT, A, 31, 1000))).toBe(
      'NOT_ENOUGH_COINS',
    );
    await service.spendCoins(AGENT, A, 25, 1000);
    expect(await codeOf(service.spendCoins(AGENT, B, 6, 1000))).toBe(
      'NOT_ENOUGH_COINS',
    );
  });

  it('two orders at once never spend the same coins', async () => {
    const { service, coins } = setup();
    const out = await Promise.allSettled([
      service.spendCoins(AGENT, A, 20, 1000),
      service.spendCoins(AGENT, B, 20, 1000),
    ]);
    expect(out.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    expect(coins.accounts.get(AGENT)?.spent).toBe(20);
  });

  it('a release gives the coins back once; a retry of that attempt holds them again', async () => {
    const { service, coins } = setup();
    await service.spendCoins(AGENT, A, 20, 1000);
    expect(await service.releaseCoins(AGENT, A)).toEqual({
      request_id: A,
      released: true,
    });
    expect(await service.releaseCoins(AGENT, A)).toEqual({
      request_id: A,
      released: false,
    });
    expect(coins.accounts.get(AGENT)?.spent).toBe(0);
    await service.spendCoins(AGENT, A, 20, 1000);
    expect(coins.accounts.get(AGENT)?.spent).toBe(20);
    expect(coins.accounts.get(AGENT)?.redemptions).toHaveLength(1);
  });

  it('releasing an attempt that holds nothing changes nothing', async () => {
    const { service, coins } = setup();
    expect(await service.releaseCoins(AGENT, B)).toEqual({
      request_id: B,
      released: false,
    });
    expect(coins.release).not.toHaveBeenCalled();
  });
});

describe('RewardRepository.insertNew', () => {
  it('takes a duplicate _id as already rewarded, and rethrows anything else', async () => {
    const dup = new mongo.MongoServerError({ message: 'E11000', code: 11000 });
    const create = jest
      .fn()
      .mockRejectedValueOnce(dup)
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('network'));
    const repo = new RewardRepository({
      create,
    } as unknown as Model<RewardDocument>);
    const row = (id: string) => ({ _id: id }) as NewReward;
    expect(await repo.insertNew([row('a'), row('b')])).toEqual(['b']);
    await expect(repo.insertNew([row('c')])).rejects.toThrow('network');
  });
});
