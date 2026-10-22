import type { HttpException } from '@nestjs/common';

import type { AgentsService } from '@modules/agents/services/agents.service';
import type { CountersService } from '@modules/counters/services/counters.service';
import type { EarningCohortsService } from '@modules/earning/services/earning-cohorts.service';
import type { SettingsService } from '@modules/settings/services/settings.service';
import type { StorageService } from '@modules/uploads/services/storage.service';

import type { AdminGigsQueryDto, CreateGigDto } from '../dto/gig.dto';
import type { GigRepository } from '../repositories/gig.repository';
import type { Gig } from '../schemas/gig.schema';
import { AdminGigsService } from './admin-gigs.service';
import type { RewardsService } from '@modules/rewards/services/rewards.service';

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

/** HO's earning cohorts: active ones (one dated, past its end), one archived, the default. */
const EARNING_COHORTS = [
  { _id: 'ec_bhopal_belt', status: 'active' },
  { _id: 'ec_diwali_2025', status: 'active', ends_on: '2025-11-30' },
  { _id: 'ec_rabi_2027', status: 'active', starts_on: '2027-10-01' },
  { _id: 'ec_old_belt', status: 'archived' },
  { _id: 'ec_default', status: 'active' },
];

function setup(row: Gig = gig(), agent: Record<string, unknown> = {}) {
  const repo = {
    find: jest.fn().mockResolvedValue(row),
    create: jest.fn().mockImplementation((r: Gig) => Promise.resolve(r)),
    transition: jest.fn().mockResolvedValue(null),
    removeUntaken: jest.fn().mockResolvedValue(false),
    seenElsewhere: jest.fn().mockResolvedValue([]),
    page: jest.fn().mockResolvedValue({ rows: [row], total: 1 }),
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
    partnersByAgentIds: jest.fn().mockResolvedValue(new Map()),
  };
  const counters = { nextGigId: jest.fn().mockResolvedValue(ID) };
  const earning = {
    current: jest.fn().mockResolvedValue({
      cohort: { _id: 'ec_paddy', meeting_gig_payout: 350 },
      since: new Date(),
    }),
    all: jest.fn().mockResolvedValue(EARNING_COHORTS),
  };
  const service = new AdminGigsService(
    repo as unknown as GigRepository,
    agents as unknown as AgentsService,
    counters as unknown as CountersService,
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
    earning as unknown as EarningCohortsService,
    {
      gigApproved: jest.fn().mockResolvedValue([]),
    } as unknown as RewardsService,
  );
  return { service, repo, counters, earning };
}

type Transition = [string, Record<string, unknown>, { $set: Partial<Gig> }];

const codeOf = (e: unknown) =>
  ((e as HttpException).getResponse() as { error: string }).error;
const messageOf = (e: unknown) =>
  ((e as HttpException).getResponse() as { message: string }).message;

const NEW_GIG = {
  title: 'Paddy demo',
  village: 'Rampur',
  starts_at: new Date(FUTURE).toISOString(),
  ends_at: new Date(FUTURE + 3_600_000).toISOString(),
} as CreateGigDto;

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

  describe('earning cohorts on a gig', () => {
    const since = new Date('2026-10-01T00:00:00Z');

    it('create keeps each earning cohort once; none sent = every earning cohort', async () => {
      const { service, repo } = setup();
      await service.create(
        {
          ...NEW_GIG,
          earning_cohorts: ['ec_bhopal_belt', 'ec_default', 'ec_bhopal_belt'],
        },
        HO,
      );
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          earning_cohorts: ['ec_bhopal_belt', 'ec_default'],
        }),
      );

      const plain = setup();
      await plain.service.create(NEW_GIG, HO);
      expect(plain.repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ earning_cohorts: [] }),
      );
      expect(plain.earning.all).not.toHaveBeenCalled();
    });

    it('create refuses an unknown or archived earning cohort, before taking an id', async () => {
      for (const id of ['ec_nowhere', 'ec_old_belt']) {
        const { service, repo, counters } = setup();
        const error = await service
          .create({ ...NEW_GIG, earning_cohorts: ['ec_bhopal_belt', id] }, HO)
          .catch((e: unknown) => e);

        expect((error as HttpException).getStatus()).toBe(400);
        expect(codeOf(error)).toBe('EARNING_COHORT_NOT_FOUND');
        expect(messageOf(error)).toBe(
          `Earning cohort ${id} does not exist or is archived.`,
        );
        expect(counters.nextGigId).not.toHaveBeenCalled();
        expect(repo.create).not.toHaveBeenCalled();
      }
    });

    it('a dated cohort is a valid target before its start and after its end', async () => {
      const { service, repo } = setup();
      await service.create(
        { ...NEW_GIG, earning_cohorts: ['ec_rabi_2027', 'ec_diwali_2025'] },
        HO,
      );
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          earning_cohorts: ['ec_rabi_2027', 'ec_diwali_2025'],
        }),
      );
    });

    it('an edit checks earning cohorts only when it sends them', async () => {
      const refused = setup();
      const error = await refused.service
        .update(ID, { earning_cohorts: ['ec_old_belt'] }, HO)
        .catch((e: unknown) => e);
      expect(codeOf(error)).toBe('EARNING_COHORT_NOT_FOUND');
      expect(refused.repo.transition).not.toHaveBeenCalled();

      const saved = setup();
      saved.repo.transition.mockResolvedValue(gig());
      await saved.service.update(
        ID,
        { earning_cohorts: ['ec_bhopal_belt', 'ec_bhopal_belt'] },
        HO,
      );
      const [, , update] = saved.repo.transition.mock.calls[0] as Transition;
      expect(update.$set.earning_cohorts).toEqual(['ec_bhopal_belt']);

      const untouched = setup();
      untouched.repo.transition.mockResolvedValue(gig());
      await untouched.service.update(ID, { title: 'New' }, HO);
      const [, , other] = untouched.repo.transition.mock.calls[0] as Transition;
      expect(other.$set).not.toHaveProperty('earning_cohorts');
      expect(untouched.earning.all).not.toHaveBeenCalled();

      // `[]` opens the gig to every earning cohort again.
      const cleared = setup(gig({ earning_cohorts: ['ec_bhopal_belt'] }));
      cleared.repo.transition.mockResolvedValue(gig());
      await cleared.service.update(ID, { earning_cohorts: [] }, HO);
      const [, , open] = cleared.repo.transition.mock.calls[0] as Transition;
      expect(open.$set.earning_cohorts).toEqual([]);
    });

    it('assign refuses a partner outside the gig’s earning cohorts', async () => {
      const row = gig({ earning_cohorts: ['ec_bhopal_belt'] });
      for (const agent of [
        { earning_cohort: { id: 'ec_default', since } },
        {}, // not placed in an earning cohort yet
      ]) {
        const { service, repo } = setup(row, agent);
        const error = await service
          .assign(ID, { agent_id: 'VST-000006' }, HO)
          .catch((e: unknown) => e);

        expect(codeOf(error)).toBe('VALIDATION_FAILED');
        expect(messageOf(error)).toBe(
          'This gig is not for this partner’s earning cohort. Change the gig’s earning cohorts first.',
        );
        expect(repo.transition).not.toHaveBeenCalled();
      }

      const inside = setup(row, {
        earning_cohort: { id: 'ec_bhopal_belt', since },
      });
      inside.repo.transition.mockResolvedValue(
        gig({ status: 'accepted', agent_id: 'VST-000006' }),
      );
      await inside.service.assign(ID, { agent_id: 'VST-000006' }, HO);
      expect(inside.repo.transition).toHaveBeenCalled();
    });

    it('the list and the detail always carry `earning_cohorts` (`[]` on an old gig)', async () => {
      const old = gig();
      expect(old).not.toHaveProperty('earning_cohorts');
      const { service } = setup(old);
      expect((await service.get(ID)).earning_cohorts).toEqual([]);
      const page = await service.list({
        skip: 0,
        limit: 50,
      } as AdminGigsQueryDto);
      expect(page.items[0].earning_cohorts).toEqual([]);

      const targeted = setup(gig({ earning_cohorts: ['ec_bhopal_belt'] }));
      expect((await targeted.service.get(ID)).earning_cohorts).toEqual([
        'ec_bhopal_belt',
      ]);
    });
  });
});
