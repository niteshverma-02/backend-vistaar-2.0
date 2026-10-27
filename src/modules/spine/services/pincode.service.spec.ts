import type { PincodeRepository } from '../repositories/pincode.repository';
import { PincodeService, withTrustedCentres } from './pincode.service';

const row = (pincode: string, lat: number | null) => ({
  pincode,
  state: 'MADHYA PRADESH',
  district: 'BHOPAL',
  taluk: null,
  lat,
  lng: lat === null ? null : 77.4,
});

describe('PincodeService', () => {
  it('reads the whole book once and answers from memory', async () => {
    const repo = {
      all: jest
        .fn()
        .mockResolvedValue([row('462026', 23.2), row('464001', null)]),
      find: jest.fn(),
    };
    const service = new PincodeService(repo as unknown as PincodeRepository);
    expect(await service.lookup('462026')).toEqual({
      pincode: '462026',
      state: 'MADHYA PRADESH',
      district: 'BHOPAL',
      taluk: null,
    });
    expect(await service.centre('462026')).toEqual({ lat: 23.2, lng: 77.4 });
    // No point of its own: its district's centre.
    expect(await service.centre('464001')).toEqual({ lat: 23.2, lng: 77.4 });
    expect(await service.lookup('999999')).toBeNull();
    expect(await service.lookup('12')).toBeNull();
    expect(repo.all).toHaveBeenCalledTimes(1);
    expect(repo.find).not.toHaveBeenCalled();
  });

  it('lists the pincodes in a ring nearest first, or the nearest one when the ring holds none', async () => {
    const repo = {
      all: jest
        .fn()
        .mockResolvedValue([
          row('462003', 23.3),
          row('462001', 23.21),
          row('462002', 23.25),
        ]),
      find: jest.fn(),
    };
    const service = new PincodeService(repo as unknown as PincodeRepository);
    const ring = await service.around(23.2, 77.4, 6);
    expect(ring.map((p) => p.pincode)).toEqual(['462001', '462002']);
    expect(ring[0]).toMatchObject({
      district: 'BHOPAL',
      lat: 23.21,
      lng: 77.4,
    });
    expect(ring[0].distance_km).toBeCloseTo(1.11, 1);

    const tiny = await service.around(23.0, 77.4, 1);
    expect(tiny.map((p) => p.pincode)).toEqual(['462001']);
  });

  it('loads once for callers that arrive together', async () => {
    const repo = {
      all: jest.fn().mockResolvedValue([row('462026', 23.2)]),
      find: jest.fn(),
    };
    const service = new PincodeService(repo as unknown as PincodeRepository);
    await Promise.all([service.lookup('462026'), service.centre('462026')]);
    expect(repo.all).toHaveBeenCalledTimes(1);
  });

  it('asks the database pincode by pincode when the book cannot load', async () => {
    const repo = {
      all: jest.fn().mockRejectedValue(new Error('down')),
      find: jest.fn().mockResolvedValue({
        pincode: '462026',
        state: 'MP',
        district: null,
        taluk: null,
      }),
    };
    const service = new PincodeService(repo as unknown as PincodeRepository);
    expect((await service.lookup('462026'))?.state).toBe('MP');
    // Not retried at once: the next call goes straight to the single lookup.
    await service.lookup('462026');
    expect(repo.all).toHaveBeenCalledTimes(1);
    expect(await service.centre('462026')).toBeNull();
  });
});

describe('withTrustedCentres', () => {
  const at = (
    pincode: string,
    district: string,
    lat: number | null,
    lng: number | null,
  ) => ({
    pincode,
    state: 'MADHYA PRADESH',
    district,
    taluk: null,
    lat,
    lng,
  });

  it('keeps a pincode point near its district, swaps a far one for the district centre', () => {
    const rows = withTrustedCentres([
      at('455001', 'DEWAS', 23.287, 77.327), // ~130 km off: the book's error
      at('455111', 'DEWAS', 22.95, 76.05),
      at('455115', 'DEWAS', 22.9, 76.1),
      at('455116', 'DEWAS', 23.0, 76.0),
      at('455221', 'DEWAS', null, null), // no point at all
    ]);
    const byPin = new Map(rows.map((r) => [r.pincode, r]));
    expect(byPin.get('455111')).toMatchObject({ lat: 22.95, lng: 76.05 });
    // The median of the district's points (23.0, 76.1), not 455001's own.
    expect(byPin.get('455001')).toMatchObject({ lat: 23, lng: 76.1 });
    expect(byPin.get('455221')).toMatchObject({ lat: 23, lng: 76.1 });
  });
});
