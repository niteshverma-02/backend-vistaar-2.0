import type { HttpException } from '@nestjs/common';

import { AgentsService } from '@modules/agents/services/agents.service';

import { MeService } from './me.service';

const SUB = 'uuid-1';
const VST = 'VST-000006';

const agentRow = (over: Record<string, unknown> = {}) => ({
  _id: SUB,
  agent_id: VST,
  pii_id: 'PII-9',
  phone: '9000000000',
  country_code: '+91',
  stage: 'approved',
  is_approved: true,
  is_active: true,
  otp_verified: true,
  stage_history: [],
  owner_agent_id: null,
  profile: { name: 'Ramesh', state: 'MP' },
  preview: { name: 'Ramesh' },
  rejection_reason: null,
  created_at: new Date(),
  ...over,
});

function build(row: Record<string, unknown>, staff = new Map()) {
  const repo = {
    findById: jest.fn().mockResolvedValue(row),
    findByAgentId: jest.fn().mockResolvedValue(row),
    editProfile: jest
      .fn<Promise<unknown>, [string, Record<string, unknown>]>()
      .mockResolvedValue(row),
  };
  const agents = new AgentsService(repo as never, {} as never, {} as never);
  const me = new MeService(
    agents,
    { findByAgent: jest.fn().mockResolvedValue(null) } as never,
    { appCohort: jest.fn().mockResolvedValue(null) } as never,
    { staffByIds: jest.fn().mockResolvedValue(staff) } as never,
    {
      lookup: jest
        .fn()
        .mockResolvedValue({ state: 'GUJARAT', district: 'SURAT' }),
    } as never,
    { sign: jest.fn().mockResolvedValue(new Map()), stat: jest.fn() } as never,
  );
  return { me, repo };
}

async function codeOf(call: Promise<unknown>): Promise<string> {
  try {
    await call;
  } catch (e) {
    return ((e as HttpException).getResponse() as { error: string }).error;
  }
  throw new Error('expected the call to fail');
}

describe('MeService', () => {
  it('has no reporting officer without an owner', async () => {
    const { me } = build(agentRow());
    expect((await me.get(SUB)).reporting_officer).toBeNull();
  });

  it('names the owner as reporting officer, with phone and role', async () => {
    const staff = new Map([
      [
        'A0-1',
        { name: 'Asha Rao', phone: '9812345678', user_role: 'USR-1037' },
      ],
    ]);
    const { me } = build(agentRow({ owner_agent_id: 'A0-1' }), staff);
    expect((await me.get(SUB)).reporting_officer).toEqual({
      agent_id: 'A0-1',
      name: 'Asha Rao',
      phone: '9812345678',
      role: 'Offline Head',
    });
  });

  it('refuses a profile edit before approval', async () => {
    const { me, repo } = build(agentRow({ stage: 'kyc_review' }));
    expect(await codeOf(me.update(SUB, VST, { email: 'a@b.in' }))).toBe(
      'PARTNER_NOT_APPROVED',
    );
    expect(repo.editProfile).not.toHaveBeenCalled();
  });

  it('holds a new name for HO and takes state / district from the pincode', async () => {
    const { me, repo } = build(agentRow());
    await me.update(SUB, VST, {
      name: 'Ramesh Patel',
      state: 'Typed',
      pincode: '395003',
    });
    const [[, set]] = repo.editProfile.mock.calls;
    expect(set['profile.name']).toBeUndefined();
    expect(set.pending_name).toMatchObject({ value: 'Ramesh Patel' });
    expect(set).toMatchObject({
      'profile.state': 'GUJARAT',
      'profile.district': 'SURAT',
      'profile.pincode': '395003',
      'preview.state': 'GUJARAT',
    });
  });
});
