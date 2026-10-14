import type { HttpException } from '@nestjs/common';

import type { AgentsService } from '@modules/agents/services/agents.service';
import type { OrderService } from '@modules/orders/services/order.service';
import type { PincodeService } from '@modules/spine/services/pincode.service';

import type { VistaarLeadsRepository } from '../repositories/vistaar-leads.repository';
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
  };
  const service = new RadarService(
    rows as unknown as VistaarLeadsRepository,
    agents as unknown as AgentsService,
    orders as unknown as OrderService,
    pincodes as unknown as PincodeService,
  );
  return { service, rows, orders };
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
    expect(view.counts).toEqual({ customers: 1, leads: 2, unplaced: 2 });
    expect(view.centre.source).toBe('gps');
    // Business is read for the customers in the ring only.
    expect(orders.businessByCustomer).toHaveBeenCalledWith('VST-000006', [
      'PII-CUST',
    ]);
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
