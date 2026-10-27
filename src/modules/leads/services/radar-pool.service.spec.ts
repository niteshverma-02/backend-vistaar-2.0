import type { ConfigService } from '@nestjs/config';

import type { Env } from '@config/env.schema';

import type { PinPeople } from '../radar.domain';
import type { RadarPoolRepository } from '../repositories/radar-pool.repository';
import type { VistaarLeadsRepository } from '../repositories/vistaar-leads.repository';
import { RadarPoolService } from './radar-pool.service';

async function* rowsOf(rows: PinPeople[]): AsyncGenerator<PinPeople> {
  for (const r of rows) yield await Promise.resolve(r);
}

function setup(enabled = true) {
  const pools = {
    kkdByPincode: jest.fn(() =>
      rowsOf([{ pin: '462001', ids: ['PII-A', 'PII-HELD'] }]),
    ),
    customersByPincode: jest.fn(() =>
      rowsOf([{ pin: '462002', ids: ['PII-C'] }]),
    ),
  };
  const leads = {
    heldPiis: jest.fn().mockResolvedValue(new Set(['PII-HELD'])),
  };
  const config = { get: jest.fn().mockReturnValue(enabled) };
  const service = new RadarPoolService(
    pools as unknown as RadarPoolRepository,
    leads as unknown as VistaarLeadsRepository,
    config as unknown as ConfigService<Env, true>,
  );
  return { service, pools, leads };
}

describe('RadarPoolService', () => {
  it('answers not ready at first without waiting, and builds in the background', async () => {
    const { service, pools } = setup();
    const first = service.countsFor(['462001']);
    expect(first.ready).toBe(false);
    expect(first.counts.size).toBe(0);

    const page = await service.page('kkd_leads', '462001', 0, 50);
    expect(page).toEqual({ ids: ['PII-A'], total: 1 });
    expect(pools.kkdByPincode).toHaveBeenCalledTimes(1);

    const later = service.countsFor(['462001', '462002', '999999']);
    expect(later.ready).toBe(true);
    expect([...later.counts]).toEqual([
      ['462001', { kkd_leads: 1, org_customers: 0 }],
      ['462002', { kkd_leads: 0, org_customers: 1 }],
    ]);
  });

  it('builds once for callers that arrive together', async () => {
    const { service, pools } = setup();
    await Promise.all([
      service.page('kkd_leads', '462001', 0, 50),
      service.page('org_customers', '462002', 0, 50),
    ]);
    expect(pools.customersByPincode).toHaveBeenCalledTimes(1);
  });

  it('reads nothing when switched off', async () => {
    const { service, pools } = setup(false);
    expect(service.countsFor(['462001']).ready).toBe(false);
    expect(await service.page('kkd_leads', '462001', 0, 50)).toEqual({
      ids: [],
      total: 0,
    });
    expect(pools.kkdByPincode).not.toHaveBeenCalled();
  });

  it('waits before reading again after a failed build', async () => {
    const { service, leads, pools } = setup();
    leads.heldPiis.mockRejectedValueOnce(new Error('down'));
    expect(await service.page('kkd_leads', '462001', 0, 50)).toEqual({
      ids: [],
      total: 0,
    });
    await service.page('kkd_leads', '462001', 0, 50);
    expect(pools.customersByPincode).toHaveBeenCalledTimes(1);
  });
});
