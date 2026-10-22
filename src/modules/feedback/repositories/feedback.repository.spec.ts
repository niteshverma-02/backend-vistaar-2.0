import type { Model, PipelineStage } from 'mongoose';

import type { Feedback } from '../schemas/feedback.schema';
import { FeedbackRepository, REASONS_PER_BUCKET } from './feedback.repository';

describe('FeedbackRepository.stats', () => {
  it('caps reasons per bucket, never across buckets', async () => {
    const aggregate = jest.fn().mockReturnValue({
      exec: () => Promise.resolve([]),
    });
    const repo = new FeedbackRepository({
      aggregate,
    } as unknown as Model<Feedback>);
    await repo.stats(new Date(0), new Date());

    const [pipeline] = aggregate.mock.calls[0] as [PipelineStage[]];
    const facet = (pipeline[1] as PipelineStage.Facet).$facet;
    const reasons: object[] = facet.reasons;
    expect(reasons.some((stage) => '$limit' in stage)).toBe(false);
    expect(reasons.at(-2)).toMatchObject({ $group: { _id: '$_id.bucket' } });
    expect(reasons.at(-1)).toEqual({
      $project: { reasons: { $slice: ['$reasons', REASONS_PER_BUCKET] } },
    });
  });
});
