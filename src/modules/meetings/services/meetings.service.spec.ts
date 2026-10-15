import type { HttpException } from '@nestjs/common';

import type { PartnerRef } from '@common/auth/current-partner.decorator';
import type { AgentsService } from '@modules/agents/services/agents.service';
import type { AddFarmerDto } from '@modules/leads/dto/lead.dto';
import type { LeadsService } from '@modules/leads/services/leads.service';

import type { AttendeesDto, CreateMeetingDto } from '../dto/meeting.dto';
import type { Attendee } from '../meetings.domain';
import type { MeetingRepository } from '../repositories/meeting.repository';
import type { Meeting } from '../schemas/meeting.schema';
import type { MeetingNotifier } from './meeting-notifier.service';
import { MeetingsService } from './meetings.service';

const AGENT = 'VST-000001';
const ID = '2b1f3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const PARTNER: PartnerRef = { agent_id: AGENT, pii_id: 'PII-1000' };
const FUTURE = new Date(Date.now() + 86_400_000).toISOString();

function person(overrides: Partial<Attendee> = {}): Attendee {
  return {
    phone: '9876500001',
    name: 'Ramesh',
    village: 'Rampur',
    pii_id: 'PII-1',
    invited: true,
    present: false,
    walk_in: false,
    lead_captured: false,
    ...overrides,
  };
}

function meeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    _id: ID,
    agent_id: AGENT,
    type: 'farmer_meeting',
    title: 'Farmer meeting · Rampur',
    starts_at: new Date(FUTURE),
    village: 'Rampur',
    venue: null,
    pincode: null,
    organiser: 'self',
    agenda: null,
    status: 'scheduled',
    attendees: [person()],
    counts: { invited: 1, present: 0, leads: 0 },
    completed_at: null,
    cancelled_at: null,
    cancel_note: null,
    created_at: new Date('2026-10-01T00:00:00Z'),
    updated_at: new Date('2026-10-01T00:00:00Z'),
    ...overrides,
  };
}

function setup(row: Meeting | null = meeting(), stage = 'approved') {
  const meetings = {
    find: jest.fn().mockResolvedValue(row),
    create: jest.fn().mockImplementation((r: Meeting) =>
      Promise.resolve({
        ...r,
        created_at: new Date(),
        updated_at: new Date(),
      }),
    ),
    setAttendees: jest
      .fn()
      .mockImplementation(
        (_id: string, _a: string, _at: Date, attendees: Attendee[]) =>
          Promise.resolve({ ...row, attendees }),
      ),
    markCaptured: jest.fn().mockResolvedValue(row),
    updateScheduled: jest.fn().mockResolvedValue(row),
  };
  const leads = {
    invitees: jest.fn().mockResolvedValue([]),
    mineByPhones: jest.fn().mockResolvedValue(new Map()),
    upsert: jest.fn().mockResolvedValue({ pii_id: 'PII-9', result: 'created' }),
  };
  const agents = {
    requireByAgentId: jest.fn().mockResolvedValue({ stage, is_active: true }),
  };
  const notifier = { scheduled: jest.fn() };
  const service = new MeetingsService(
    meetings as unknown as MeetingRepository,
    leads as unknown as LeadsService,
    agents as unknown as AgentsService,
    notifier as unknown as MeetingNotifier,
  );
  return { service, meetings, leads, notifier };
}

const createDto = (
  overrides: Partial<CreateMeetingDto> = {},
): CreateMeetingDto => ({
  id: ID,
  type: 'farmer_meeting',
  starts_at: FUTURE,
  village: 'Rampur',
  ...overrides,
});

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

const sentTo = (fn: jest.Mock, call = 0) =>
  (fn.mock.calls as unknown as [string, string, Date, Attendee[]][])[call];

describe('MeetingsService.create', () => {
  it('refuses a partner who is not approved, before writing', async () => {
    const { service, meetings } = setup(null, 'kyc_pending');
    expect(await failure(service.create(AGENT, createDto()))).toEqual({
      status: 403,
      code: 'PARTNER_NOT_APPROVED',
    });
    expect(meetings.create).not.toHaveBeenCalled();
  });

  it('refuses a start time in the past', async () => {
    const { service } = setup(null);
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(
      (await failure(service.create(AGENT, createDto({ starts_at: past }))))
        .status,
    ).toBe(400);
  });

  it("returns a retried create's own meeting, and refuses another partner's id", async () => {
    const mine = setup(meeting());
    mine.meetings.create.mockResolvedValueOnce(null);
    const view = await mine.service.create(AGENT, createDto());
    expect(view.id).toBe(ID);
    expect(mine.notifier.scheduled).not.toHaveBeenCalled();

    const theirs = setup(meeting({ agent_id: 'VST-000099' }));
    theirs.meetings.create.mockResolvedValueOnce(null);
    expect(
      await failure(theirs.service.create(AGENT, createDto())),
    ).toMatchObject({ status: 409, code: 'MEETING_EXISTS' });
  });

  it("invites only the partner's own farmers and tells the notifier", async () => {
    const { service, meetings, leads, notifier } = setup(null);
    leads.invitees.mockResolvedValueOnce([
      {
        pii_id: 'PII-1',
        name: 'Ramesh',
        phone: '9876500001',
        village: 'Rampur',
        stage: 'prospect',
      },
      {
        pii_id: 'PII-2',
        name: 'Suresh',
        phone: '9876500002',
        village: 'Rampur',
        stage: 'prospect',
      },
    ]);
    await service.create(AGENT, createDto({ invite: ['pii-1', 'PII-77'] }));
    const saved = (meetings.create.mock.calls as unknown as [Meeting][])[0][0];
    expect(saved.attendees.map((a) => [a.pii_id, a.invited])).toEqual([
      ['PII-1', true],
    ]);
    expect(saved.counts.invited).toBe(1);
    expect(notifier.scheduled).toHaveBeenCalledTimes(1);
  });
});

describe('MeetingsService.setAttendees', () => {
  const dto = (attendees: AttendeesDto['attendees']): AttendeesDto => ({
    attendees,
  });

  it("keeps invites, makes newcomers walk-ins and links the partner's own lead", async () => {
    const { service, meetings, leads } = setup();
    leads.mineByPhones.mockResolvedValue(
      new Map([['9876500002', { pii_id: 'PII-2', stage: 'prospect' }]]),
    );
    await service.setAttendees(
      AGENT,
      ID,
      dto([
        { phone: '9876500001', name: 'Ramesh', present: true },
        { phone: '+91 98765 00002', name: 'Suresh', present: true },
        { phone: '9876500003', name: 'Mahesh', present: false },
      ]),
    );
    const list = sentTo(meetings.setAttendees)[3];
    expect(list.map((a) => [a.phone, a.invited, a.walk_in, a.pii_id])).toEqual([
      ['9876500001', true, false, 'PII-1'],
      ['9876500002', false, true, 'PII-2'],
      ['9876500003', false, true, null],
    ]);
  });

  it('re-reads and tries once more when the meeting changed meanwhile', async () => {
    const later = new Date('2026-10-02T00:00:00Z');
    const { service, meetings } = setup();
    meetings.find.mockResolvedValueOnce(meeting()).mockResolvedValueOnce(
      meeting({
        updated_at: later,
        attendees: [person({ lead_captured: true })],
      }),
    );
    meetings.setAttendees.mockResolvedValueOnce(null);
    await service.setAttendees(
      AGENT,
      ID,
      dto([{ phone: '9876500001', name: 'Ramesh', present: true }]),
    );
    expect(meetings.setAttendees).toHaveBeenCalledTimes(2);
    const retry = sentTo(meetings.setAttendees, 1);
    expect(retry[2]).toBe(later);
    expect(retry[3][0].lead_captured).toBe(true);
  });

  it('refuses an invalid mobile before reading or writing', async () => {
    const { service, meetings } = setup();
    expect(
      (
        await failure(
          service.setAttendees(
            AGENT,
            ID,
            dto([{ phone: '12345', name: 'X', present: true }]),
          ),
        )
      ).status,
    ).toBe(400);
    expect(meetings.setAttendees).not.toHaveBeenCalled();
  });
});

describe('MeetingsService.captureLead', () => {
  const farmer = (phone: string) => ({ phone }) as AddFarmerDto;

  it("refuses a mobile that is not this attendee's", async () => {
    const { service, leads } = setup();
    expect(
      (
        await failure(
          service.captureLead(PARTNER, ID, '9876500001', farmer('9876500009')),
        )
      ).status,
    ).toBe(400);
    expect(leads.upsert).not.toHaveBeenCalled();
  });

  it('never re-saves someone already the partner’s lead (add-lead would overwrite them)', async () => {
    const { service, leads } = setup();
    leads.mineByPhones.mockResolvedValue(
      new Map([['9876500001', { pii_id: 'PII-1', stage: 'won' }]]),
    );
    expect(
      (
        await failure(
          service.captureLead(PARTNER, ID, '9876500001', farmer('9876500001')),
        )
      ).status,
    ).toBe(400);
    expect(leads.upsert).not.toHaveBeenCalled();
  });

  it('adds the lead as found at a meeting, then marks the attendee captured', async () => {
    const { service, leads, meetings } = setup();
    await service.captureLead(PARTNER, ID, '9876500001', farmer('9876500001'));
    const sent = (
      leads.upsert.mock.calls as unknown as [PartnerRef, AddFarmerDto][]
    )[0];
    expect(sent[1].found_via).toBe('meeting');
    expect(meetings.markCaptured).toHaveBeenCalledWith(
      ID,
      AGENT,
      '9876500001',
      'PII-9',
    );
  });
});

describe('MeetingsService.complete', () => {
  it('refuses with nobody present', async () => {
    const { service, meetings } = setup();
    expect(await failure(service.complete(AGENT, ID))).toEqual({
      status: 400,
      code: 'VALIDATION_FAILED',
    });
    expect(meetings.updateScheduled).not.toHaveBeenCalled();
  });
});
