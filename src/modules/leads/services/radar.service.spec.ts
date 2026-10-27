import type { HttpException } from '@nestjs/common';

import type { AgentsService } from '@modules/agents/services/agents.service';
import type { OrderService } from '@modules/orders/services/order.service';
import type { PiiService } from '@modules/spine/services/pii.service';
import type { PincodeService } from '@modules/spine/services/pincode.service';

import type { RadarPincodeQueryDto } from '../dto/radar.dto';
import type { KkdStoreRepository } from '../repositories/kkd-store.repository';
import type { RadarPoolRepository } from '../repositories/radar-pool.repository';
import type { VistaarLeadsRepository } from '../repositories/vistaar-leads.repository';
import type { RadarPoolService } from './radar-pool.service';
import { RadarService } from './radar.service';

const ME = { agent_id: 'VST-000006', pii_id: 'PII-1' };
const HERE = { lat: 23.2, lng: 77.4 };

const dot = (
  pii: string,
  lat: number,
  lng: number,
  stage = 'contacted',
  source = 'add',
) => ({
  pii_id: pii,
  name: pii,
  phone: '6000000101',
  village: 'Rampur',
  district: 'BHOPAL',
  crops: ['Wheat'],
  acreage: 5,
  stage,
  expected_value: 1000,
  customer_at: stage === 'won' ? new Date() : null,
  last_order_at: null,
  location: { type: 'Point', coordinates: [lng, lat] },
  location_source: source,
});

const store = (
  id: string,
  lat: number,
  lng: number,
  city: string,
  at: string,
) => ({
  id,
  status: 'active',
  city,
  state: 'MP',
  address: null,
  pincode: null,
  phone: null,
  point: { lat, lng },
  created_at: new Date(at),
});

const listQuery = (layer: 'kkd_leads' | 'org_customers', page = 1) =>
  ({ layer, page, limit: 50 }) as RadarPincodeQueryDto;

function setup(opts: { signup?: [number, number]; pincode?: string } = {}) {
  const rows = {
    nearby: jest
      .fn()
      .mockResolvedValue([
        dot('PII-FAR', 23.25, 77.45),
        dot('PII-CUST', 23.201, 77.401, 'won'),
        dot('PII-NEAR', 23.205, 77.405, 'prospect', 'pincode'),
      ]),
    countUnplaced: jest.fn().mockResolvedValue(2),
    heldAmong: jest.fn().mockResolvedValue(new Set(['PII-HELD'])),
  };
  const agents = {
    requireByAgentId: jest.fn().mockResolvedValue({
      location: opts.signup
        ? { type: 'Point', coordinates: opts.signup }
        : undefined,
      profile: { pincode: opts.pincode },
    }),
  };
  const orders = {
    businessByCustomer: jest.fn().mockResolvedValue(
      new Map([
        [
          'PII-CUST',
          {
            orders: 2,
            spend: 3000,
            last_order_at: new Date('2026-10-10'),
            last_order_stage: 'delivered',
          },
        ],
      ]),
    ),
  };
  const pincodes = {
    centre: jest.fn().mockResolvedValue(opts.pincode ? HERE : null),
    around: jest.fn().mockResolvedValue([
      {
        pincode: '462001',
        state: 'MP',
        district: 'BHOPAL',
        lat: 23.21,
        lng: 77.41,
        distance_km: 1.23,
      },
      {
        pincode: '462002',
        state: 'MP',
        district: 'BHOPAL',
        lat: 23.25,
        lng: 77.45,
        distance_km: 6.7,
      },
      {
        pincode: '462003',
        state: 'MP',
        district: 'BHOPAL',
        lat: 23.3,
        lng: 77.5,
        distance_km: 9.9,
      },
    ]),
    lookup: jest.fn().mockResolvedValue({
      pincode: '462001',
      state: 'MADHYA PRADESH',
      district: 'BHOPAL',
      taluk: null,
    }),
  };
  const pools = {
    countsFor: jest.fn().mockReturnValue({
      ready: true,
      built_at: new Date('2026-10-27T10:00:00Z'),
      counts: new Map([
        ['462001', { kkd_leads: 4, org_customers: 2 }],
        ['462003', { kkd_leads: 0, org_customers: 1 }],
      ]),
    }),
    page: jest.fn().mockResolvedValue({
      ids: ['PII-A', 'PII-HELD', 'PII-1', 'PII-B'],
      total: 9,
    }),
  };
  const poolRows = {
    kkdLeads: jest.fn().mockResolvedValue([
      {
        pii_id: 'PII-B',
        first_name: 'Sita',
        last_name: '',
        source: 'kkd_web',
        has_app: false,
        created_at: new Date('2026-01-02'),
      },
      {
        pii_id: 'PII-A',
        first_name: 'Ram',
        last_name: 'Lal',
        source: 'kkd_app',
        has_app: true,
        created_at: new Date('2026-03-01'),
      },
      {
        pii_id: 'PII-A',
        first_name: null,
        source: 'kkd_web',
        has_app: null,
        created_at: new Date('2025-12-01'),
      },
      {
        pii_id: 'PII-HELD',
        first_name: 'Held',
        source: 'kkd_app',
        created_at: new Date(),
      },
      {
        pii_id: 'PII-1',
        first_name: 'Me',
        source: 'kkd_app',
        created_at: new Date(),
      },
    ]),
    customers: jest.fn().mockResolvedValue([
      {
        pii_id: 'PII-A',
        first_name: 'Ram',
        number: '9425000012',
        order_count: 3,
        last_order_date: new Date('2026-09-01'),
      },
      {
        pii_id: 'PII-A',
        first_name: 'Ram old',
        number: '9425000012',
        order_count: 1,
        last_order_date: new Date('2025-01-01'),
      },
    ]),
  };
  const piis = {
    phonesOf: jest.fn().mockResolvedValue(new Map([['PII-A', '9876543210']])),
  };
  // A store 1 km away, its later copy on the same spot, and one about 60 km away.
  const stores = {
    all: jest
      .fn()
      .mockResolvedValue([
        store('FR-FAR', 23.2, 78.0, 'Sehore', '2025-01-01'),
        store('FR-COPY', 23.209, 77.4, 'Bhopal', '2025-05-14'),
        store('FR-1', 23.209, 77.4, 'Bhopal', '2025-05-05'),
      ]),
  };
  const service = new RadarService(
    rows as unknown as VistaarLeadsRepository,
    agents as unknown as AgentsService,
    orders as unknown as OrderService,
    pincodes as unknown as PincodeService,
    stores as unknown as KkdStoreRepository,
    pools as unknown as RadarPoolService,
    poolRows as unknown as RadarPoolRepository,
    piis as unknown as PiiService,
  );
  return { service, rows, orders, stores, pools, pincodes, poolRows };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return ((error as HttpException).getResponse() as { error: string }).error;
  }
  return 'no error';
}

describe('RadarService', () => {
  it('lists my farmers in the ring, nearest first, customers with their business', async () => {
    const { service, rows, orders } = setup();
    const view = await service.around(ME, { ...HERE, km: 10 });
    expect(rows.nearby).toHaveBeenCalledWith(
      'VST-000006',
      expect.objectContaining(HERE),
      10,
      2000,
    );
    expect(view.items.map((d) => d.pii_id)).toEqual([
      'PII-CUST',
      'PII-NEAR',
      'PII-FAR',
    ]);
    expect(view.items[0]).toMatchObject({
      kind: 'customer',
      orders: 2,
      spend: 3000,
      exact: true,
    });
    expect(view.items[1]).toMatchObject({
      kind: 'lead',
      orders: null,
      exact: false,
    });
    expect(view.counts).toEqual({
      customers: 1,
      leads: 2,
      unplaced: 2,
      stores: 1,
      kkd_leads: 4,
      org_customers: 3,
    });
    expect(view.centre.source).toBe('gps');
    // Business is read for the customers in the ring only.
    expect(orders.businessByCustomer).toHaveBeenCalledWith('VST-000006', [
      'PII-CUST',
    ]);
  });

  it('shows KKD stores in the ring only, nearest first, the copy dropped, read once a minute', async () => {
    const { service, stores } = setup({});
    const view = await service.around(ME, { ...HERE, km: 10 });
    expect(view.stores.map((s) => s.id)).toEqual(['FR-1']);
    expect(view.stores[0]).toMatchObject({
      name: 'Katyayani Krishi Kendra · Bhopal',
      distance_km: 1,
      exact: true,
    });
    expect(view.counts.stores).toBe(1);
    expect(view.nearest_store).toBeNull();
    await service.around(ME, { ...HERE, km: 50 });
    expect(stores.all).toHaveBeenCalledTimes(1);
  });

  it('names the nearest store when none is in the ring', async () => {
    const view = await setup().service.around(ME, {
      lat: 25.6,
      lng: 85.1,
      km: 5,
    });
    expect(view.stores).toEqual([]);
    expect(view.nearest_store?.id).toBe('FR-FAR');
  });

  it('puts a marker on each ring pincode with KKD leads or org customers, nearest first', async () => {
    const { service, pools, pincodes } = setup();
    const view = await service.around(ME, { ...HERE, km: 10 });
    expect(pincodes.around).toHaveBeenCalledWith(HERE.lat, HERE.lng, 10);
    expect(pools.countsFor).toHaveBeenCalledWith([
      '462001',
      '462002',
      '462003',
    ]);
    expect(view.pincodes).toEqual([
      expect.objectContaining({
        pincode: '462001',
        distance_km: 1.2,
        kkd_leads: 4,
        org_customers: 2,
      }),
      expect.objectContaining({
        pincode: '462003',
        kkd_leads: 0,
        org_customers: 1,
      }),
    ]);
    expect(view.pools).toEqual({
      ready: true,
      built_at: new Date('2026-10-27T10:00:00Z'),
    });
  });

  it('reads only the layers asked for', async () => {
    const { service, rows, stores, pincodes } = setup();
    const view = await service.around(ME, {
      ...HERE,
      layers: ['org_customers'],
    });
    expect(rows.nearby).not.toHaveBeenCalled();
    expect(stores.all).not.toHaveBeenCalled();
    expect(view.items).toEqual([]);
    expect(
      view.pincodes.map((p) => [p.pincode, p.kkd_leads, p.org_customers]),
    ).toEqual([
      ['462001', 0, 2],
      ['462003', 0, 1],
    ]);

    const mineOnly = await service.around(ME, { ...HERE, layers: ['mine'] });
    expect(pincodes.around).toHaveBeenCalledTimes(1);
    expect(mineOnly.pincodes).toEqual([]);
    expect(mineOnly.pools.ready).toBe(true);
  });

  it("lists a pincode's KKD leads in pool order, masked, without held farmers or the partner", async () => {
    const { service, pools } = setup();
    const page = await service.pincodeList(
      ME,
      '462001',
      listQuery('kkd_leads', 2),
    );
    expect(pools.page).toHaveBeenCalledWith('kkd_leads', '462001', 50, 50);
    expect(page.items.map((p) => p.pii_id)).toEqual(['PII-A', 'PII-B']);
    expect(page.items[0]).toMatchObject({
      name: 'Ram Lal',
      phone_masked: '98******10',
      channels: ['kkd_app', 'kkd_web'],
      has_app: true,
      since: new Date('2025-12-01'),
      state: 'MADHYA PRADESH',
      district: 'BHOPAL',
    });
    expect(page.items[1]).toMatchObject({
      name: 'Sita',
      phone_masked: null,
      has_app: false,
    });
    expect(page.total).toBe(9);
    expect(JSON.stringify(page)).not.toContain('9876543210');
  });

  it("lists a pincode's org customers with their latest row, and caches the page", async () => {
    const { service, poolRows } = setup();
    const page = await service.pincodeList(
      ME,
      '462001',
      listQuery('org_customers'),
    );
    expect(page.items).toEqual([
      expect.objectContaining({
        pii_id: 'PII-A',
        name: 'Ram',
        phone_masked: '94******12',
        orders: 3,
        last_order_at: new Date('2026-09-01'),
      }),
    ]);
    await service.pincodeList(ME, '462001', listQuery('org_customers'));
    expect(poolRows.customers).toHaveBeenCalledTimes(1);
  });

  it('centres on the signup place, then the pincode, when the phone sends none', async () => {
    const signup = await setup({ signup: [77.5, 23.3] }).service.around(ME, {});
    expect(signup.centre).toEqual({ lat: 23.3, lng: 77.5, source: 'signup' });
    expect(signup.km).toBe(10);

    const pin = await setup({ pincode: '462026' }).service.around(ME, {});
    expect(pin.centre.source).toBe('pincode');

    expect(await codeOf(setup().service.around(ME, {}))).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('refuses half a location, or one outside India', async () => {
    const { service } = setup();
    expect(await codeOf(service.around(ME, { lat: 23.2 }))).toBe(
      'VALIDATION_FAILED',
    );
    expect(await codeOf(service.around(ME, { lat: 0, lng: 0 }))).toBe(
      'VALIDATION_FAILED',
    );
  });
});
