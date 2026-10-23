import { isDeepStrictEqual } from 'node:util';

import type { Model, PipelineStage } from 'mongoose';

import type { VistaarLeadDocument } from '../schemas/vistaar-lead.schema';
import { VistaarLeadsRepository } from './vistaar-leads.repository';

describe('VistaarLeadsRepository.adminSummary (HO cards)', () => {
  let aggregate: jest.Mock;
  let repo: VistaarLeadsRepository;
  const since = {
    today: new Date('2026-10-22T18:30:00Z'),
    week: new Date('2026-10-16T18:30:00Z'),
    tomorrow: new Date('2026-10-23T18:30:00Z'),
  };
  const window = {
    from: new Date('2026-09-30T18:30:00Z'),
    to: new Date('2026-10-31T18:30:00Z'),
  };

  beforeEach(() => {
    aggregate = jest.fn().mockReturnValue({
      exec: () =>
        Promise.resolve([
          {
            total: [{ n: 3 }],
            today: [],
            week: [{ n: 1 }],
            partners: [{ n: 2 }],
            due_today: [],
            overdue: [{ n: 1 }],
            by_stage: [{ _id: 'won', count: 1 }],
            by_partner: [{ _id: 'VST-1', count: 3 }],
            by_state: [
              { _id: 'MADHYA PRADESH', count: 2 },
              { _id: null, count: 1 },
            ],
          },
        ]),
    });
    repo = new VistaarLeadsRepository({
      aggregate,
    } as unknown as Model<VistaarLeadDocument>);
  });

  const facets = () => {
    const [[stage]] = aggregate.mock.calls[0] as [[PipelineStage.Facet]];
    return stage.$facet as Record<string, unknown[]>;
  };
  const inWindow = {
    $match: { created_at: { $gte: window.from, $lt: window.to } },
  };
  const windowed = (f: Record<string, unknown[]>) =>
    Object.keys(f)
      .filter((k) => isDeepStrictEqual(f[k][0], inWindow))
      .sort();

  it('narrows only the period counts to the leads added in the window', async () => {
    await repo.adminSummary(since, window);
    const f = facets();
    expect(windowed(f)).toEqual([
      'by_partner',
      'by_stage',
      'by_state',
      'partners',
      'total',
    ]);
    // The day cards and the follow-up queues keep their own days.
    expect(f.today[0]).toEqual({
      $match: { created_at: { $gte: since.today } },
    });
    expect(f.overdue[0]).toHaveProperty('$match.next_follow_up');
  });

  it('reads every lead without a window, and names a missing state ""', async () => {
    const out = await repo.adminSummary(since);
    expect(windowed(facets())).toEqual([]);
    expect(facets().total).toEqual([{ $count: 'n' }]);
    expect(out).toMatchObject({
      total: 3,
      partners: 2,
      by_state: [
        { key: 'MADHYA PRADESH', count: 2 },
        { key: '', count: 1 },
      ],
    });
  });
});
