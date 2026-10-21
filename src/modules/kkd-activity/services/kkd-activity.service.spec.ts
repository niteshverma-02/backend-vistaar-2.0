import { HttpException } from '@nestjs/common';

import type { PageQueryDto } from '@common/dto/page-query.dto';
import type { AgentsService } from '@modules/agents/services/agents.service';
import type { LeadsService } from '@modules/leads/services/leads.service';
import type { PincodeService } from '@modules/spine/services/pincode.service';
import type { ProductFactsService } from '@modules/spine/services/product-facts.service';

import type { KkdActivityQueryDto } from '../dto/kkd-activity.dto';
import type { FarmerOrdersRepository } from '../repositories/farmer-orders.repository';
import type { KkdEventsRepository } from '../repositories/kkd-events.repository';
import type { StoreActivityRepository } from '../repositories/store-activity.repository';
import type { StoreDirectoryRepository } from '../repositories/store-directory.repository';

import { KkdActivityService } from './kkd-activity.service';

const PARTNER = { agent_id: 'VST-000006', pii_id: 'PII-1' };
const SINCE = new Date('2026-05-01T00:00:00Z');
const AT = new Date('2026-06-10T06:00:00Z');

const page = (q: Partial<KkdActivityQueryDto> = {}): KkdActivityQueryDto =>
  ({ page: 1, limit: 50, ...q }) as PageQueryDto;

function build(over: {
  orders?: jest.Mock;
  walkins?: jest.Mock;
  agent?: unknown;
  centre?: jest.Mock;
  holds?: boolean;
}) {
  const leads = {
    heldFarmers: jest.fn().mockResolvedValue([
      {
        pii_id: 'PII-7',
        name: 'Ramesh',
        phone: '9826000001',
        village: 'Goharganj',
        stage: 'won',
        since: SINCE,
      },
    ]),
    holds: jest.fn().mockResolvedValue(over.holds ?? true),
  };
  const agents = {
    requireByAgentId: jest.fn().mockResolvedValue(over.agent ?? {}),
  };
  const pincodes = { centre: over.centre ?? jest.fn().mockResolvedValue(null) };
  const products = { facts: jest.fn().mockResolvedValue(new Map()) };
  const orders = {
    since:
      over.orders ??
      jest.fn().mockResolvedValue([
        {
          order_id: 'KSK-1',
          date: AT,
          pii_id: 'PII-7',
          marketplace: 'MKTP-3',
          order_status: 'delivered',
          total_amount: 400,
          items: [],
        },
      ]),
  };
  const store = {
    posOrders: jest.fn().mockResolvedValue([]),
    walkins:
      over.walkins ??
      jest.fn().mockResolvedValue([
        {
          _id: 'w1',
          franchise_id: 'FR-100',
          walked_in_at: AT,
          phone: '9826000001',
        },
      ]),
    prescriptions: jest.fn().mockResolvedValue([]),
  };
  const events = { since: jest.fn().mockResolvedValue([]) };
  const directory = {
    load: jest.fn().mockResolvedValue({
      franchises: [
        {
          franchiseId: 'FR-100',
          city: 'Raisen',
          coordinates: [77.78, 23.33],
          warehouse_id: null,
        },
      ],
      v2: [],
      logins: [],
    }),
  };
  const service = new KkdActivityService(
    leads as unknown as LeadsService,
    agents as unknown as AgentsService,
    pincodes as unknown as PincodeService,
    products as unknown as ProductFactsService,
    orders as unknown as FarmerOrdersRepository,
    store as unknown as StoreActivityRepository,
    events as unknown as KkdEventsRepository,
    directory as unknown as StoreDirectoryRepository,
  );
  return { service, leads, orders, store, events, pincodes };
}

describe('KkdActivityService', () => {
  it('reads only the partner’s held farmers, from the earliest hold on', async () => {
    const { service, leads, orders, store, events } = build({});
    const res = await service.feed(PARTNER, page());

    expect(leads.heldFarmers).toHaveBeenCalledWith('VST-000006');
    expect(orders.since).toHaveBeenCalledWith(['PII-7'], SINCE, 2000);
    expect(store.walkins).toHaveBeenCalledWith(
      ['PII-7'],
      ['9826000001'],
      SINCE,
      2000,
    );
    expect(events.since).toHaveBeenCalledWith(['9826000001'], SINCE, 2000);
    expect(res.items.map((a) => a.id)).toEqual(['order:KSK-1', 'walk_in:w1']);
    expect(res.total).toBe(2);
  });

  it('still answers when one source is down', async () => {
    const { service } = build({
      orders: jest.fn().mockRejectedValue(new Error('timeout')),
    });
    const res = await service.feed(PARTNER, page());
    expect(res.items.map((a) => a.id)).toEqual(['walk_in:w1']);
  });

  it('refuses a farmer the partner does not hold', async () => {
    const { service } = build({ holds: false });
    await expect(
      service.feed(PARTNER, page({ customer: 'PII-99' })),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('reads the sources once a minute per partner, not per call', async () => {
    const { service, orders } = build({});
    await service.feed(PARTNER, page());
    await service.summary(PARTNER, { month: '2026-06' });
    expect(orders.since).toHaveBeenCalledTimes(1);
  });

  it('places the stores from the signup point, else the pincode centre', async () => {
    const fromSignup = await build({
      agent: { location: { coordinates: [77.41, 23.26] } },
    }).service.stores(PARTNER);
    expect(fromSignup.centre).toEqual({
      lat: 23.26,
      lng: 77.41,
      source: 'signup',
    });
    expect(fromSignup.stores.map((s) => s.id)).toEqual(['FR-100']);

    const centre = jest.fn().mockResolvedValue({ lat: 22.72, lng: 75.86 });
    const fromPin = await build({
      agent: { profile: { pincode: '452001' } },
      centre,
    }).service.stores(PARTNER);
    expect(centre).toHaveBeenCalledWith('452001');
    expect(fromPin).toMatchObject({
      centre: { source: 'pincode' },
      km: 50,
      stores: [],
    });

    const none = await build({}).service.stores(PARTNER);
    expect(none).toEqual({ centre: null, km: 50, stores: [] });
  });
});
