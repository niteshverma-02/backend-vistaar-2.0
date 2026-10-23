import type { AccessService } from '@modules/access/services/access.service';
import type { AgentsService } from '@modules/agents/services/agents.service';
import type { EarningCohortsService } from '@modules/earning/services/earning-cohorts.service';
import type { OnboardingService } from '@modules/onboarding/services/onboarding.service';
import type { RewardsService } from '@modules/rewards/services/rewards.service';
import type { SettingsService } from '@modules/settings/services/settings.service';

import type { NetworkRepository } from '../repositories/network.repository';
import { DeskService } from './desk.service';

const counts = {
  stages: {
    signed_up: 1,
    onboarding: 2,
    kyc_review: 1,
    changes_requested: 0,
    approved: 3,
    rejected: 0,
    blocked: 1,
  },
  unverified: 4,
  total: 8,
  by_cohort: [{ key: 'retailer', count: 8 }],
  by_state: [{ key: 'MADHYA PRADESH', count: 8 }],
};

describe('DeskService.summary', () => {
  let rangeCounts: jest.Mock;
  let service: DeskService;

  beforeEach(() => {
    rangeCounts = jest.fn().mockResolvedValue({ signed_up: 5, approved: 2 });
    service = new DeskService(
      {
        stageCounts: jest.fn().mockResolvedValue(counts),
        rangeCounts,
      } as unknown as AgentsService,
      {} as OnboardingService,
      {} as AccessService,
      {} as SettingsService,
      {} as NetworkRepository,
      {} as EarningCohortsService,
      {} as RewardsService,
    );
  });

  it('keeps the tabs as they were and reads no window without from / to', async () => {
    expect(await service.summary({})).toEqual({
      ...counts,
      signups_in_range: null,
      approved_in_range: null,
    });
    expect(rangeCounts).not.toHaveBeenCalled();
  });

  it('counts sign-ups and approvals over whole IST days, the end day included', async () => {
    const s = await service.summary({ from: '2026-10-01', to: '2026-10-31' });
    expect(s).toMatchObject({
      stages: counts.stages,
      signups_in_range: 5,
      approved_in_range: 2,
    });
    expect(rangeCounts).toHaveBeenCalledWith(
      new Date('2026-09-30T18:30:00Z'),
      new Date('2026-10-31T18:30:00Z'),
    );
  });

  it('refuses a window with no start, ending before it starts, or over a year', async () => {
    for (const query of [
      { to: '2026-10-31' },
      { from: '2026-10-31', to: '2026-10-01' },
      { from: '2025-01-01', to: '2026-10-31' },
    ]) {
      await expect(service.summary(query)).rejects.toMatchObject({
        status: 400,
      });
    }
    expect(rangeCounts).not.toHaveBeenCalled();
  });
});
