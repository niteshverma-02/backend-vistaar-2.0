import type { HttpException } from '@nestjs/common';

import type { AgentsService } from '@modules/agents/services/agents.service';
import type { CountersService } from '@modules/counters/services/counters.service';
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
  );
  return { service, repo };
}

const codeOf = (e: unknown) =>
  ((e as HttpException).getResponse() as { error: string }).error;

describe('AdminGigsService', () => {
  it('create takes payout, min farmers and photos from settings when not sent', async () => {
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
});
