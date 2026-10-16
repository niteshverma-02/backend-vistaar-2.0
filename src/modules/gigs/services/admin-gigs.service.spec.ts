import type { HttpException } from '@nestjs/common';

import type { AgentsService } from '@modules/agents/services/agents.service';
import type { CountersService } from '@modules/counters/services/counters.service';
import type { EarningCohortsService } from '@modules/earning/services/earning-cohorts.service';
import type { SettingsService } from '@modules/settings/services/settings.service';
import type { StorageService } from '@modules/uploads/services/storage.service';

import type { CreateGigDto } from '../dto/gig.dto';
import type { GigRepository } from '../repositories/gig.repository';
import type { Gig } from '../schemas/gig.schema';
import { AdminGigsService } from './admin-gigs.service';

const ID = 'GIG-000001';
const HO = 'ho@katyayaniorganics.com';
const FUTURE = Date.now() + 2 * 86_400_000;

function gig(overrides: Partial<Gig> = {}): Gig {
  return {
    _id: ID,
    title: 'Paddy demo',
    village: 'Rampur',
    district: null,
    state: null,
    pincode: null,
    venue: null,
    venue_point: null,
    starts_at: new Date(FUTURE),
    ends_at: new Date(FUTURE + 7_200_000),
    expected_farmers: 0,
    min_farmers: 15,
    photos_required: 3,
    payout: 250,
    products: [],
    requirements: [],
    cohorts: [],
    status: 'open',
    agent_id: null,
    accepted_at: null,
    assigned_by: null,
    releases: [],
    check_in: null,
    attendees: [],
    photos: [],
    submitted_at: null,
    reviewed_by: null,
    reviewed_at: null,
    reject_reason: null,
    cancelled_by: null,
    cancel_reason: null,
    posted_by: HO,
    updated_by: HO,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function setup(row: Gig = gig(), agent: Record<string, unknown> = {}) {
  const repo = {
    find: jest.fn().mockResolvedValue(row),
    create: jest.fn().mockImplementation((r: Gig) => Promise.resolve(r)),
    transition: jest.fn().mockResolvedValue(null),
    removeUntaken: jest.fn().mockResolvedValue(false),
    seenElsewhere: jest.fn().mockResolvedValue([]),
  };
  const agents = {
    requireByAgentId: jest.fn().mockResolvedValue({
      agent_id: 'VST-000006',
      phone: '9876500000',
      stage: 'approved',
      is_active: true,
      cohort: 'vistaar_agent',
      profile: null,
      preview: {},
      ...agent,
    }),
  };
  const service = new AdminGigsService(
    repo as unknown as GigRepository,
    agents as unknown as AgentsService,
    {
      nextGigId: jest.fn().mockResolvedValue(ID),
    } as unknown as CountersService,
    {
      get: jest.fn().mockResolvedValue({
        gig_payout: 400,
        gig_min_farmers: 20,
        gig_photos_required: 4,
      }),
    } as unknown as SettingsService,
    {
      sign: jest.fn().mockResolvedValue(new Map()),
    } as unknown as StorageService,
    {
      current: jest.fn().mockResolvedValue({
        cohort: { _id: 'ec_paddy', meeting_gig_payout: 350 },
        since: new Date(),
      }),
    } as unknown as EarningCohortsService,
  );
  return { service, repo };
}

type Transition = [string, Record<string, unknown>, { $set: Partial<Gig> }];

const codeOf = (e: unknown) =>
  ((e as HttpException).getResponse() as { error: string }).error;

describe('AdminGigsService', () => {
  it('create takes min farmers and photos from settings when not sent', async () => {
    const { service, repo } = setup();
    const dto = {
      title: 'Paddy demo',
      village: 'Rampur',
      starts_at: new Date(FUTURE).toISOString(),
      ends_at: new Date(FUTURE + 3_600_000).toISOString(),
      payout: 300,
    } as CreateGigDto;

    await service.create(dto, HO);

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        payout: 300,
        payout_source: 'gig',
        min_farmers: 20,
        photos_required: 4,
        status: 'open',
        posted_by: HO,
      }),
    );
  });

  it('refuses an edit once a partner holds the gig', async () => {
    const { service, repo } = setup(
      gig({ status: 'accepted', agent_id: 'VST-000006' }),
    );

    const error = await service
      .update(ID, { title: 'New' }, HO)
      .catch((e: unknown) => e);

    expect(codeOf(error)).toBe('GIG_CLOSED');
    expect(repo.transition).not.toHaveBeenCalled();
  });

  it('refuses to delete a gig that was ever taken', async () => {
    const { service } = setup(
      gig({
        releases: [{ agent_id: 'VST-000006', at: new Date(), by: 'partner' }],
      }),
    );

    const error = await service.remove(ID).catch((e: unknown) => e);

    expect(codeOf(error)).toBe('GIG_CLOSED');
  });

  it('approves only from submitted', async () => {
    const { service, repo } = setup(
      gig({ status: 'accepted', agent_id: 'VST-000006' }),
    );

    const error = await service.approve(ID, HO).catch((e: unknown) => e);

    expect(repo.transition).toHaveBeenCalledWith(
      ID,
      { status: 'submitted' },
      expect.anything(),
    );
    expect(codeOf(error)).toBe('GIG_CLOSED');
  });

  it('will not assign to a partner who is not approved', async () => {
    const { service, repo } = setup(gig(), { stage: 'kyc_review' });

    const error = await service
      .assign(ID, { agent_id: 'VST-000006' }, HO)
      .catch((e: unknown) => e);

    expect(codeOf(error)).toBe('VALIDATION_FAILED');
    expect(repo.transition).not.toHaveBeenCalled();
  });

  it('create without a payout leaves it to the taker’s cohort', async () => {
    const { service, repo } = setup();
    await service.create(
      {
        title: 'Paddy demo',
        village: 'Rampur',
        starts_at: new Date(FUTURE).toISOString(),
        ends_at: new Date(FUTURE + 3_600_000).toISOString(),
      },
      HO,
    );
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ payout: null, payout_source: 'cohort' }),
    );
  });

  it('an edit to `payout: null` hands the pay to the cohort', async () => {
    const { service, repo } = setup();
    repo.transition.mockResolvedValue(gig());
    await service.update(ID, { payout: null }, HO);
    const [, , update] = repo.transition.mock.calls[0] as Transition;
    expect(update.$set).toMatchObject({
      payout: null,
      payout_source: 'cohort',
    });
  });

  it('assign fixes the partner’s cohort rate on a cohort-paid gig', async () => {
    const { service, repo } = setup(
      gig({ payout: null, payout_source: 'cohort' }),
    );
    repo.transition.mockResolvedValue(
      gig({ status: 'accepted', agent_id: 'VST-000006', payout: 350 }),
    );
    await service.assign(ID, { agent_id: 'VST-000006' }, HO);
    const [, when, update] = repo.transition.mock.calls[0] as Transition;
    expect(when).toMatchObject({ status: 'open', payout: null });
    expect(update.$set).toMatchObject({ status: 'accepted', payout: 350 });
  });

  it('reopen clears a cohort rate, keeps a payout HO set', async () => {
    const holder = { status: 'accepted' as const, agent_id: 'VST-000006' };
    const cohortPaid = setup(
      gig({ ...holder, payout: 350, payout_source: 'cohort' }),
    );
    cohortPaid.repo.transition.mockResolvedValue(gig());
    await cohortPaid.service.reopen(ID, HO);
    const [, , cleared] = cohortPaid.repo.transition.mock
      .calls[0] as Transition;
    expect(cleared.$set).toMatchObject({ status: 'open', payout: null });

    const hoPaid = setup(gig(holder));
    hoPaid.repo.transition.mockResolvedValue(gig());
    await hoPaid.service.reopen(ID, HO);
    const [, , kept] = hoPaid.repo.transition.mock.calls[0] as Transition;
    expect(kept.$set).not.toHaveProperty('payout');
  });
});
