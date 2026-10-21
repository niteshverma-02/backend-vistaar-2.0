import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { rewardIdOf } from '../rewards.domain';
import { BulkRewardsDto, RewardParamDto } from './reward.dto';

const idOk = async (id: string) =>
  (await validate(plainToInstance(RewardParamDto, { id }))).length === 0;

/** One id per trigger, built the way `RewardsService` builds them. */
const IDS = [
  rewardIdOf('lead_created', 'coin', 'PII-9'),
  rewardIdOf('follow_up_done', 'gig', 'PII-9', '2026-10-14'),
  rewardIdOf('lead_stage_advanced', 'coin', 'PII-9', 'interested'),
  rewardIdOf('reorder', 'coin', 'KSK-341382'),
  rewardIdOf('meeting_attendee_captured', 'coin', 'MTG-1', 'PII-9'),
  rewardIdOf('gig_approved', 'gig', 'GIG-900001'),
  rewardIdOf(
    'event_registered',
    'coin',
    '0b7c4a52-2f1e-4b8e-9a3d-6c1f0e2d9b47',
    'VST-000006',
  ),
  rewardIdOf('attendance_streak', 'coin', 'VST-000006', '2026-10-16'),
  rewardIdOf('onboarding_approved', 'coin', 'VST-000006'),
  rewardIdOf('story_created', 'coin', '5d2e8f61-7a4b-4c3d-8e9f-1a2b3c4d5e6f'),
];

describe('reward id params', () => {
  it.each(IDS)('takes %s', async (id) => {
    expect(await idOk(id)).toBe(true);
  });

  it('takes a whole batch of every trigger', async () => {
    const errors = await validate(
      plainToInstance(BulkRewardsDto, { ids: IDS }),
    );
    expect(errors).toEqual([]);
  });

  it.each([
    'lead_created:PII-9',
    'not_a_trigger:PII-9:coin',
    'lead_created:PII-9:cash',
    'lead_created::coin',
    'lead_created:PII 9:coin',
    'lead_created:a:b:c:d:coin',
  ])('refuses %s', async (id) => {
    expect(await idOk(id)).toBe(false);
  });
});
