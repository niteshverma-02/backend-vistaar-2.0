import { HttpException } from '@nestjs/common';
import { Types } from 'mongoose';

import type { SettingsService } from '@modules/settings/services/settings.service';

import type { FeedbackRepository } from '../repositories/feedback.repository';
import type { ProductSuggestionRepository } from '../repositories/product-suggestion.repository';
import { AdminFeedbackService } from './admin-feedback.service';

const ID = new Types.ObjectId().toHexString();

function setup() {
  const feedback = {
    stats: jest.fn().mockResolvedValue({
      buckets: [
        { _id: 'detractor', count: 2 },
        { _id: 'promoter', count: 6 },
      ],
      ratings: [
        { _id: 5, count: 3 },
        { _id: 2, count: 1 },
      ],
      reasons: [
        { _id: 'detractor', reasons: [{ reason: 'Late delivery', count: 2 }] },
      ],
    }),
    followUpCounts: jest.fn().mockResolvedValue({ open: 3, overdue: 1 }),
    setFollowUp: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue(null),
  };
  const suggestions = { update: jest.fn() };
  const settings = { setFeedbackReasons: jest.fn() };
  const service = new AdminFeedbackService(
    feedback as unknown as FeedbackRepository,
    suggestions as unknown as ProductSuggestionRepository,
    settings as unknown as SettingsService,
  );
  return { feedback, suggestions, settings, service };
}

async function errorOf(promise: Promise<unknown>) {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(HttpException);
  return {
    status: (error as HttpException).getStatus(),
    code: ((error as HttpException).getResponse() as { error: string }).error,
  };
}

describe('AdminFeedbackService.summary', () => {
  it('rolls the range up into NPS, stars and reasons', async () => {
    const { service } = setup();
    const s = await service.summary('2026-10-01', '2026-10-14');
    expect(s).toMatchObject({
      total: 8,
      counts: { detractor: 2, passive: 0, promoter: 6 },
      nps: 50,
      rating: { count: 4, average: 4.3, stars: [0, 1, 0, 0, 3] },
      reasons: {
        detractor: [{ reason: 'Late delivery', count: 2 }],
        passive: [],
        promoter: [],
      },
      follow_ups: { open: 3, overdue: 1 },
    });
  });

  it('keeps every bucket’s own reasons, a small one included', async () => {
    const { service, feedback } = setup();
    const many = Array.from({ length: 20 }, (_, i) => ({
      reason: `Good ${i}`,
      count: 100 - i,
    }));
    feedback.stats.mockResolvedValueOnce({
      buckets: [],
      ratings: [],
      reasons: [
        { _id: 'promoter', reasons: many },
        { _id: 'detractor', reasons: [{ reason: 'Late delivery', count: 1 }] },
      ],
    });
    const s = await service.summary('2026-10-01', '2026-10-14');
    expect(s.reasons).toEqual({
      detractor: [{ reason: 'Late delivery', count: 1 }],
      passive: [],
      promoter: many,
    });
  });

  it('refuses a range over a year', async () => {
    const { service } = setup();
    await expect(
      errorOf(service.summary('2025-01-01', '2026-10-14')),
    ).resolves.toMatchObject({ status: 400 });
  });
});

describe('AdminFeedbackService.setFollowUp', () => {
  it('says a passive or promoter has no call-back, rather than not found', async () => {
    const { feedback, service } = setup();
    feedback.find.mockResolvedValue({ _id: ID, follow_up: null });
    await expect(
      errorOf(service.setFollowUp(ID, { status: 'done' }, 'ho@k.com')),
    ).resolves.toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
  });

  it('is not found when there is no such feedback', async () => {
    const { service } = setup();
    await expect(
      errorOf(service.setFollowUp(ID, { status: 'done' }, 'ho@k.com')),
    ).resolves.toMatchObject({ status: 404 });
  });

  it('records who closed it', async () => {
    const { feedback, service } = setup();
    feedback.setFollowUp.mockResolvedValue({
      _id: ID,
      agent_id: 'VST-1',
      reasons: [],
      follow_up: {
        status: 'done',
        due_at: new Date(),
        owner_agent_id: null,
        note: 'Called',
        done_by: 'ho@k.com',
        done_at: new Date(),
      },
    });
    await service.setFollowUp(
      ID,
      { status: 'done', note: ' Called ' },
      'ho@k.com',
    );
    expect(feedback.setFollowUp).toHaveBeenCalledWith(
      ID,
      expect.objectContaining({ note: 'Called', done_by: 'ho@k.com' }),
    );
  });
});

describe('AdminFeedbackService.setReasons', () => {
  const group = (chips: string[]) => ({ question: ' Why? ', chips });

  it('cleans the chips and saves all three groups', async () => {
    const { settings, service } = setup();
    await service.setReasons(
      {
        detractor: group(['Late delivery', 'late delivery ']),
        passive: group(['More products']),
        promoter: group(['Easy app']),
      },
      'ho@k.com',
    );
    expect(settings.setFeedbackReasons).toHaveBeenCalledWith(
      expect.objectContaining({
        detractor: { question: 'Why?', chips: ['Late delivery'] },
      }),
      'ho@k.com',
    );
  });

  it('refuses a group left with no chips', async () => {
    const { settings, service } = setup();
    await expect(
      errorOf(
        service.setReasons(
          {
            detractor: group([' ']),
            passive: group(['a']),
            promoter: group(['b']),
          },
          'ho@k.com',
        ),
      ),
    ).resolves.toMatchObject({ status: 400 });
    expect(settings.setFeedbackReasons).not.toHaveBeenCalled();
  });
});

describe('AdminFeedbackService.updateSuggestion', () => {
  it('refuses an empty change', async () => {
    const { suggestions, service } = setup();
    await expect(
      errorOf(service.updateSuggestion('SUG-000001', {}, 'ho@k.com')),
    ).resolves.toMatchObject({ status: 400 });
    expect(suggestions.update).not.toHaveBeenCalled();
  });
});
