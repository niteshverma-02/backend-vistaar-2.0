import type { HttpException } from '@nestjs/common';

import type { AgentsService } from '@modules/agents/services/agents.service';
import type { EarningCohortsService } from '@modules/earning/services/earning-cohorts.service';
import type { SettingsService } from '@modules/settings/services/settings.service';
import type { StorageService } from '@modules/uploads/services/storage.service';

import type { GigsQueryDto } from '../dto/gig.dto';
import type { GigRepository } from '../repositories/gig.repository';
import type { Gig, GigCheckin } from '../schemas/gig.schema';
import type { GigReadsService } from './gig-reads.service';
import { GigsService } from './gigs.service';

const AGENT = 'VST-000001';
const ID = 'GIG-000001';
const DAY = 86_400_000;

function gig(overrides: Partial<Gig> = {}): Gig {
  return {
    _id: ID,
    title: 'Paddy blast demo',
    village: 'Rampur',
    district: 'Bhopal',
    state: 'MADHYA PRADESH',
    pincode: null,
    venue: null,
    venue_point: { lat: 23.2599, lng: 77.4126 },
    starts_at: new Date(Date.now() + 3 * DAY),
    ends_at: new Date(Date.now() + 3 * DAY + 7_200_000),
    expected_farmers: 25,
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
    posted_by: 'ho@katyayaniorganics.com',
    updated_by: 'ho@katyayaniorganics.com',
    created_at: new Date('2026-10-01T00:00:00Z'),
    updated_at: new Date('2026-10-01T00:00:00Z'),
    ...overrides,
  };
}

function setup(
  row: Gig,
  moved: Gig | null = row,
  cohortPayout: number | null = 300,
) {
  const gigs = {
    find: jest.fn().mockResolvedValue(row),
    transition: jest.fn().mockResolvedValue(moved),
    heldBetween: jest.fn().mockResolvedValue(0),
    openFrom: jest.fn().mockResolvedValue([row]),
  };
  const agents = {
    requireByAgentId: jest.fn().mockResolvedValue({
      stage: 'approved',
      is_active: true,
      cohort: 'vistaar_agent',
      preview: {},
      profile: null,
    }),
  };
  const settings = {
    get: jest
      .fn()
      .mockResolvedValue({ gig_checkin_radius_m: 500, gig_payout: 250 }),
  };
  const earning = {
    current: jest.fn().mockResolvedValue({
      cohort: { _id: 'ec_paddy', meeting_gig_payout: cohortPayout },
      since: new Date(),
    }),
  };
  const storage = {
    sign: jest.fn().mockResolvedValue(new Map()),
    stat: jest
      .fn()
      .mockResolvedValue({ size: 1000, contentType: 'image/jpeg' }),
  };
  const service = new GigsService(
    gigs as unknown as GigRepository,
    {} as unknown as GigReadsService,
    agents as unknown as AgentsService,
    settings as unknown as SettingsService,
    storage as unknown as StorageService,
    earning as unknown as EarningCohortsService,
  );
  return { service, gigs, storage, earning };
}

type Transition = [string, Record<string, unknown>, { $set: Partial<Gig> }];

async function failure(
  call: Promise<unknown>,
): Promise<{ status: number; code: string }> {
  try {
    await call;
  } catch (e) {
    const err = e as HttpException;
    return {
      status: err.getStatus(),
      code: (err.getResponse() as { error: string }).error,
    };
  }
  throw new Error('expected the call to fail');
}

const held = (overrides: Partial<Gig> = {}) =>
  gig({ status: 'accepted', agent_id: AGENT, ...overrides });

describe('GigsService', () => {
  it('accept: losing the race to another partner is GIG_TAKEN', async () => {
    const { service } = setup(gig(), null);
    expect(await failure(service.accept(AGENT, ID))).toEqual({
      status: 409,
      code: 'GIG_TAKEN',
    });
  });

  it('accept: another gig that day only warns', async () => {
    const { service, gigs } = setup(gig(), held());
    gigs.heldBetween.mockResolvedValue(1);
    const out = await service.accept(AGENT, ID);
    expect(out.status).toBe('accepted');
    expect(out.warning).toBe('You already have a gig that day.');
  });

  it('release: refused on the gig’s own day', async () => {
    const { service, gigs } = setup(held({ starts_at: new Date() }));
    expect(await failure(service.release(AGENT, ID))).toEqual({
      status: 409,
      code: 'GIG_CLOSED',
    });
    expect(gigs.transition).not.toHaveBeenCalled();
  });

  it('check-in: far from the venue or without GPS is flagged, not refused', async () => {
    const flagsOf = async (location?: { lat: number; lng: number }) => {
      const { service, gigs } = setup(held());
      await service.checkIn(AGENT, ID, { location });
      const [, , update] = gigs.transition.mock.calls[0] as [
        string,
        unknown,
        { $set: { status: string; check_in: GigCheckin } },
      ];
      expect(update.$set.status).toBe('checked_in');
      return update.$set.check_in.flags;
    };
    expect(await flagsOf({ lat: 22.7196, lng: 75.8577 })).toContain('far');
    expect(await flagsOf()).toContain('no_gps');
  });

  it('submit: refused below the minimum farmers, before writing', async () => {
    const attendees = [{ phone: '9876500001', name: 'Ramesh', village: null }];
    const { service, gigs } = setup(held({ status: 'checked_in', attendees }));
    expect(await failure(service.submit(AGENT, ID))).toEqual({
      status: 400,
      code: 'VALIDATION_FAILED',
    });
    expect(gigs.transition).not.toHaveBeenCalled();
  });

  it('photos: a path outside the partner’s own gig folder is refused unread', async () => {
    const { service, storage } = setup(held({ status: 'checked_in' }));
    const path = `vistaar/gigs/VST-000002/${ID}/2b1f3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d.jpg`;
    expect(await failure(service.addPhoto(AGENT, ID, { path }))).toEqual({
      status: 400,
      code: 'MEDIA_NOT_FOUND',
    });
    expect(storage.stat).not.toHaveBeenCalled();
  });

  describe('cohort pay (HO left the payout empty)', () => {
    const open = () => gig({ payout: null, payout_source: 'cohort' });

    it('accept fixes the taker’s cohort rate, only if the pay is still as read', async () => {
      const { service, gigs } = setup(open(), held({ payout: 300 }));
      await service.accept(AGENT, ID);
      const [, when, update] = gigs.transition.mock.calls[0] as Transition;
      expect(when).toMatchObject({ status: 'open', payout: null });
      expect(update.$set).toMatchObject({ status: 'accepted', payout: 300 });
    });

    it('a cohort with no rate pays the settings payout', async () => {
      const { service, gigs } = setup(open(), held(), null);
      await service.accept(AGENT, ID);
      const [, , update] = gigs.transition.mock.calls[0] as Transition;
      expect(update.$set.payout).toBe(250);
    });

    it('a payout HO set wins: the cohort is not read', async () => {
      const { service, gigs, earning } = setup(gig({ payout: 500 }), held());
      await service.accept(AGENT, ID);
      const [, when, update] = gigs.transition.mock.calls[0] as Transition;
      expect(when).toMatchObject({ payout: 500 });
      expect(update.$set).not.toHaveProperty('payout');
      expect(earning.current).not.toHaveBeenCalled();
    });

    it('giving it back clears the fixed pay for the next taker', async () => {
      const cohortHeld = held({ payout: 300, payout_source: 'cohort' });
      const { service, gigs } = setup(cohortHeld);
      await service.release(AGENT, ID);
      const [, , update] = gigs.transition.mock.calls[0] as Transition;
      expect(update.$set).toMatchObject({ status: 'open', payout: null });

      const other = setup(held());
      await other.service.release(AGENT, ID);
      const [, , kept] = other.gigs.transition.mock.calls[0] as Transition;
      expect(kept.$set).not.toHaveProperty('payout');
    });

    it('the Available tab shows each viewer their own pay', async () => {
      const { service } = setup(open());
      const page = await service.list(AGENT, {
        tab: 'available',
        skip: 0,
        limit: 50,
      } as GigsQueryDto);
      expect(page.items[0]).toMatchObject({
        payout: 300,
        payout_source: 'cohort',
      });
    });
  });
});
