import type { HttpException } from '@nestjs/common';

import type { AgentsService } from '@modules/agents/services/agents.service';

import type { EventRegistrationRepository } from '../repositories/event-registration.repository';
import type { EventRepository } from '../repositories/event.repository';
import type { FarmerEvent } from '../schemas/event.schema';
import { EventsService } from './events.service';
import type { RewardsService } from '@modules/rewards/services/rewards.service';

const AGENT = 'VST-000001';
const ID = '2b1f3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

function event(overrides: Partial<FarmerEvent> = {}): FarmerEvent {
  return {
    _id: ID,
    title: 'Kisan Mela',
    type: 'kisan_mela',
    starts_at: new Date(Date.now() + 86_400_000),
    location: 'Mandi ground',
    note: null,
    seats: 2,
    registered_count: 1,
    cohorts: [],
    is_active: true,
    created_by: 'ho',
    updated_by: 'ho',
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function setup(row: FarmerEvent | null = event(), cohort = 'vistaar_agent') {
  const events = {
    find: jest.fn().mockResolvedValue(row),
    takeSeat: jest
      .fn()
      .mockResolvedValue(
        row ? { ...row, registered_count: row.registered_count + 1 } : null,
      ),
    releaseSeat: jest
      .fn()
      .mockResolvedValue(
        row ? { ...row, registered_count: row.registered_count - 1 } : null,
      ),
    listActiveFrom: jest.fn().mockResolvedValue(row ? [row] : []),
  };
  const registrations = {
    add: jest.fn().mockResolvedValue(true),
    remove: jest.fn().mockResolvedValue(true),
    heldBy: jest.fn().mockResolvedValue(new Set<string>()),
  };
  const agents = {
    requireByAgentId: jest.fn().mockResolvedValue({ cohort }),
    cohortByAgentId: jest.fn().mockResolvedValue(cohort),
  };
  const service = new EventsService(
    events as unknown as EventRepository,
    registrations as unknown as EventRegistrationRepository,
    agents as unknown as AgentsService,
    {
      eventRegistered: jest.fn().mockResolvedValue([]),
    } as unknown as RewardsService,
  );
  return { service, events, registrations };
}

async function codeOf(call: Promise<unknown>): Promise<string> {
  try {
    await call;
  } catch (e) {
    return ((e as HttpException).getResponse() as { error: string }).error;
  }
  throw new Error('expected the call to fail');
}

describe('EventsService.register', () => {
  it('takes a seat once', async () => {
    const { service, events } = setup();
    const view = await service.register(AGENT, ID);
    expect(events.takeSeat).toHaveBeenCalled();
    expect(view).toMatchObject({
      registered: true,
      registered_count: 2,
      seats_left: 0,
    });
  });

  it('is a no-op for a partner who already has a seat', async () => {
    const { service, events, registrations } = setup();
    registrations.add.mockResolvedValueOnce(false);
    const view = await service.register(AGENT, ID);
    expect(events.takeSeat).not.toHaveBeenCalled();
    expect(view.registered).toBe(true);
  });

  it('gives the registration back when the last seat went meanwhile', async () => {
    const { service, events, registrations } = setup();
    events.takeSeat.mockResolvedValueOnce(null);
    events.find
      .mockResolvedValueOnce(event())
      .mockResolvedValueOnce(event({ registered_count: 2 }));
    expect(await codeOf(service.register(AGENT, ID))).toBe('EVENT_FULL');
    expect(registrations.remove).toHaveBeenCalledWith(ID, AGENT);
  });

  it('refuses a full or started event before writing', async () => {
    const full = setup(event({ registered_count: 2 }));
    expect(await codeOf(full.service.register(AGENT, ID))).toBe('EVENT_FULL');
    expect(full.registrations.add).not.toHaveBeenCalled();

    const started = setup(event({ starts_at: new Date(Date.now() - 1000) }));
    expect(await codeOf(started.service.register(AGENT, ID))).toBe(
      'EVENT_CLOSED',
    );
  });

  it("hides another cohort's event", async () => {
    const { service } = setup(event({ cohorts: ['ex_employee'] }));
    expect(await codeOf(service.register(AGENT, ID))).toBe('NOT_FOUND');
  });
});

describe('EventsService.unregister', () => {
  it('releases the seat', async () => {
    const { service, events } = setup();
    const view = await service.unregister(AGENT, ID);
    expect(events.releaseSeat).toHaveBeenCalledWith(ID);
    expect(view).toMatchObject({ registered: false, registered_count: 0 });
  });

  it('does not release a seat the partner never held', async () => {
    const { service, events, registrations } = setup();
    registrations.remove.mockResolvedValueOnce(false);
    await service.unregister(AGENT, ID);
    expect(events.releaseSeat).not.toHaveBeenCalled();
  });

  it('refuses after the event has started', async () => {
    const { service } = setup(
      event({ starts_at: new Date(Date.now() - 1000) }),
    );
    expect(await codeOf(service.unregister(AGENT, ID))).toBe('EVENT_CLOSED');
  });
});

describe('EventsService.upcoming', () => {
  it("lists only the caller's cohort's events, with their seat", async () => {
    const mine = event();
    const other = event({ _id: 'other', cohorts: ['ex_employee'] });
    const { service, events, registrations } = setup(mine);
    events.listActiveFrom.mockResolvedValueOnce([mine, other]);
    registrations.heldBy.mockResolvedValueOnce(new Set([ID]));
    const list = await service.upcoming(AGENT);
    expect(list.map((e) => [e.id, e.registered])).toEqual([[ID, true]]);
  });
});
