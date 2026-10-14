import { HttpException } from '@nestjs/common';
import { Types } from 'mongoose';

import type { AgentsService } from '@modules/agents/services/agents.service';
import type { CountersService } from '@modules/counters/services/counters.service';
import type { SettingsService } from '@modules/settings/services/settings.service';

import {
  FEEDBACK_PER_DAY_MAX,
  SUGGESTIONS_PER_DAY_MAX,
} from '../feedback.domain';
import type { FeedbackRepository } from '../repositories/feedback.repository';
import type { ProductSuggestionRepository } from '../repositories/product-suggestion.repository';
import { FeedbackService } from './feedback.service';

const AGENT = 'VST-000101';
// Mon 12 Oct 2026, 10:00 IST.
const NOW = new Date('2026-10-12T04:30:00Z');

const PARTNER = {
  agent_id: AGENT,
  phone: '9876543210',
  cohort: 'farmer_leader',
  owner_agent_id: 'A0-2691',
  profile: { name: 'Ramesh', district: 'Lucknow', state: 'Uttar Pradesh' },
  preview: {},
};

function setup() {
  const feedback = {
    countSince: jest.fn().mockResolvedValue(0),
    create: jest
      .fn()
      .mockImplementation((row: object) =>
        Promise.resolve({ ...row, _id: new Types.ObjectId(), created_at: NOW }),
      ),
  };
  const suggestions = {
    countSince: jest.fn().mockResolvedValue(0),
    create: jest
      .fn()
      .mockImplementation((row: object) =>
        Promise.resolve({ ...row, created_at: NOW }),
      ),
  };
  const agents = { requireByAgentId: jest.fn().mockResolvedValue(PARTNER) };
  const counters = { nextSuggestionNumber: jest.fn().mockResolvedValue(42) };
  const settings = {
    get: jest.fn().mockResolvedValue({ feedback_reasons: null }),
  };
  const service = new FeedbackService(
    feedback as unknown as FeedbackRepository,
    suggestions as unknown as ProductSuggestionRepository,
    agents as unknown as AgentsService,
    counters as unknown as CountersService,
    settings as unknown as SettingsService,
  );
  return { feedback, suggestions, agents, counters, service };
}

async function codeOf(promise: Promise<unknown>): Promise<unknown> {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(HttpException);
  return ((error as HttpException).getResponse() as { error: string }).error;
}

beforeEach(() => jest.useFakeTimers({ now: NOW }));
afterEach(() => jest.useRealTimers());

describe('FeedbackService.submit', () => {
  it("opens a call-back for a detractor, owned by the partner's officer", async () => {
    const { feedback, service } = setup();

    const receipt = await service.submit(AGENT, {
      nps: 4,
      reasons: ['Late delivery', ' late delivery '],
      comment: '  Delivery takes a week  ',
      rating: 2,
    });

    expect(feedback.create).toHaveBeenCalledWith(
      expect.objectContaining({
        agent_id: AGENT,
        bucket: 'detractor',
        reasons: ['Late delivery'],
        comment: 'Delivery takes a week',
        rating: 2,
        partner: expect.objectContaining({
          name: 'Ramesh',
          owner_agent_id: 'A0-2691',
        }) as unknown,
        follow_up: expect.objectContaining({
          status: 'open',
          owner_agent_id: 'A0-2691',
          due_at: new Date('2026-10-14T18:29:59.999Z'),
        }) as unknown,
      }),
    );
    expect(receipt).toMatchObject({
      bucket: 'detractor',
      follow_up_due_at: new Date('2026-10-14T18:29:59.999Z'),
    });
  });

  it('opens no call-back for a promoter, and stores no stars when none were given', async () => {
    const { feedback, service } = setup();

    const receipt = await service.submit(AGENT, { nps: 9 });

    expect(feedback.create).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: 'promoter',
        follow_up: null,
        rating: null,
        comment: null,
      }),
    );
    expect(receipt.follow_up_due_at).toBeNull();
  });

  it("counts the partner's answers from IST midnight", async () => {
    const { feedback, service } = setup();
    await service.submit(AGENT, { nps: 8 });
    expect(feedback.countSince).toHaveBeenCalledWith(
      AGENT,
      new Date('2026-10-11T18:30:00Z'),
    );
  });

  it('refuses once the day is used up', async () => {
    const { feedback, service } = setup();
    feedback.countSince.mockResolvedValue(FEEDBACK_PER_DAY_MAX);
    await expect(codeOf(service.submit(AGENT, { nps: 8 }))).resolves.toBe(
      'FEEDBACK_LIMIT',
    );
    expect(feedback.create).not.toHaveBeenCalled();
  });
});

describe('FeedbackService.suggest', () => {
  it('files it under a SUG- reference with the grouping key', async () => {
    const { suggestions, service } = setup();

    const receipt = await service.suggest(AGENT, {
      product: '  Emamectin   benzoate 5% SG ',
      crop: ' Chilli ',
      monthly_demand: '',
    });

    expect(suggestions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: 'SUG-000042',
        product: 'Emamectin benzoate 5% SG',
        product_key: 'emamectin benzoate 5% sg',
        crop: 'Chilli',
        monthly_demand: null,
        status: 'new',
      }),
    );
    expect(receipt).toEqual({
      ref: 'SUG-000042',
      product: 'Emamectin benzoate 5% SG',
      created_at: NOW,
    });
  });

  it('refuses once the day is used up, before taking a number', async () => {
    const { suggestions, counters, service } = setup();
    suggestions.countSince.mockResolvedValue(SUGGESTIONS_PER_DAY_MAX);
    await expect(
      codeOf(service.suggest(AGENT, { product: 'Neem oil' })),
    ).resolves.toBe('FEEDBACK_LIMIT');
    expect(counters.nextSuggestionNumber).not.toHaveBeenCalled();
  });
});
