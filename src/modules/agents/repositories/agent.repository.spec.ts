import type { Model } from 'mongoose';

import type { AgentDocument } from '../schemas/agent.schema';
import { AgentRepository } from './agent.repository';

describe('AgentRepository.rangeCounts (HO summary window)', () => {
  let countDocuments: jest.Mock;
  let repo: AgentRepository;
  const from = new Date('2026-09-30T18:30:00Z');
  const to = new Date('2026-10-31T18:30:00Z');

  beforeEach(() => {
    countDocuments = jest
      .fn()
      .mockReturnValueOnce({ exec: () => Promise.resolve(7) })
      .mockReturnValueOnce({ exec: () => Promise.resolve(3) });
    repo = new AgentRepository({
      countDocuments,
    } as unknown as Model<AgentDocument>);
  });

  it('counts sign-ups by created_at and approvals by decided_at on is_approved', async () => {
    expect(await repo.rangeCounts(from, to)).toEqual({
      signed_up: 7,
      approved: 3,
    });
    const [signups, approvals] = countDocuments.mock.calls.map(
      (c: unknown[]) => c[0],
    );
    expect(signups).toEqual({
      otp_verified: true,
      created_at: { $gte: from, $lt: to },
    });
    // A rejected or reopened partner (is_approved false) also has a
    // decided_at; only an approval counts.
    expect(approvals).toEqual({
      otp_verified: true,
      is_approved: true,
      decided_at: { $gte: from, $lt: to },
    });
  });

  it('runs to now when the window has no end', async () => {
    await repo.rangeCounts(from);
    expect((countDocuments.mock.calls[1] as unknown[])[0]).toMatchObject({
      decided_at: { $gte: from },
    });
  });
});
