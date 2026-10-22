import type { Model } from 'mongoose';

import type { AddressRepository } from '../repositories/address.repository';
import type { OrgCounterRepository } from '../repositories/org-counter.repository';
import { PiiRepository } from '../repositories/pii.repository';
import type { AppCounterDocument } from '../schemas/app-counter.schema';
import type { PiiDocument } from '../schemas/pii.schema';
import { PiiService } from './pii.service';

const FIELDS = {
  village: 'Rampur',
  district: 'BHOPAL',
  state: 'MADHYA PRADESH',
  pincode: '462026',
};
const META = { source: 'vistaar', by: 'VST-000001' };

function setup() {
  const piis = {
    findIdByPhone: jest.fn().mockResolvedValue(null),
    nextPiiNumber: jest.fn().mockResolvedValue(41),
    insert: jest.fn().mockResolvedValue(true),
    hasAddresses: jest.fn().mockResolvedValue(false),
    addAddressRef: jest.fn().mockResolvedValue(undefined),
    removeAddressRefs: jest.fn().mockResolvedValue(undefined),
  };
  const addresses = {
    ownRow: jest.fn().mockResolvedValue(null),
    ownRows: jest.fn().mockResolvedValue([]),
    insert: jest.fn().mockResolvedValue(true),
    update: jest.fn().mockResolvedValue(undefined),
    removeOwn: jest.fn().mockResolvedValue(undefined),
  };
  let n = 100;
  const counters = { next: jest.fn(() => Promise.resolve(++n)) };
  const service = new PiiService(
    piis as unknown as PiiRepository,
    addresses as unknown as AddressRepository,
    counters as unknown as OrgCounterRepository,
  );
  return { service, piis, addresses, counters };
}

describe('PiiService.resolve', () => {
  it('lands on the person who took the phone while our id collided', async () => {
    const { service, piis } = setup();
    piis.findIdByPhone
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('PII-7');
    piis.insert.mockResolvedValueOnce(false);

    expect(await service.resolve('9876543210', '+91')).toEqual({
      pii_id: 'PII-7',
      created: false,
    });
    expect(piis.insert).toHaveBeenCalledTimes(1);
  });

  it('answers 503 after colliding twice with nobody on the phone', async () => {
    const { service, piis } = setup();
    piis.insert.mockResolvedValue(false);

    await expect(service.resolve('9876543210', '+91')).rejects.toMatchObject({
      status: 503,
    });
    expect(piis.nextPiiNumber).toHaveBeenCalledTimes(2);
  });

  it('answers 503 without inserting when the counter row is missing', async () => {
    const { service, piis } = setup();
    piis.nextPiiNumber.mockResolvedValue(null);

    await expect(service.resolve('9876543210', '+91')).rejects.toMatchObject({
      status: 503,
    });
    expect(piis.insert).not.toHaveBeenCalled();
  });
});

describe('PiiService.saveAddress', () => {
  it('updates the row this source filed, inserting nothing', async () => {
    const { service, addresses, piis } = setup();
    addresses.ownRow.mockResolvedValue({ address_id: 'ADDR-5' });

    expect(await service.saveAddress('PII-1', FIELDS, META)).toBe('ADDR-5');
    expect(addresses.update).toHaveBeenCalledWith(
      'ADDR-5',
      expect.objectContaining({ village: 'Rampur', zipcode: '462026' }),
    );
    expect(addresses.insert).not.toHaveBeenCalled();
    expect(piis.addAddressRef).not.toHaveBeenCalled();
  });

  it('files the first address as primary and lists it on the person', async () => {
    const { service, addresses, piis } = setup();

    expect(await service.saveAddress('PII-1', FIELDS, META)).toBe('ADDR-101');
    expect(addresses.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        address_id: 'ADDR-101',
        pii_id: 'PII-1',
        is_primary: true,
        source: 'vistaar',
        created_by: 'VST-000001',
      }),
    );
    expect(piis.addAddressRef).toHaveBeenCalledWith('PII-1', 'ADDR-101');
    expect(addresses.removeOwn).not.toHaveBeenCalled();
  });

  it('after a race with another process, keeps the lowest id and drops ours', async () => {
    const { service, addresses, piis } = setup();
    piis.hasAddresses.mockResolvedValue(true);
    addresses.ownRows.mockResolvedValue([
      { address_id: 'ADDR-101', is_primary: false },
      { address_id: 'ADDR-99', is_primary: false },
    ]);

    expect(await service.saveAddress('PII-1', FIELDS, META)).toBe('ADDR-99');
    expect(addresses.ownRows).toHaveBeenCalledWith('PII-1', 'vistaar');
    expect(addresses.removeOwn).toHaveBeenCalledWith('PII-1', 'vistaar', [
      'ADDR-101',
    ]);
    expect(piis.removeAddressRefs).toHaveBeenCalledWith('PII-1', ['ADDR-101']);
    expect(addresses.update).not.toHaveBeenCalled();
  });

  it('keeps a primary when the dropped row was the primary one', async () => {
    const { service, addresses, piis } = setup();
    addresses.ownRows.mockResolvedValue([
      { address_id: 'ADDR-99', is_primary: false },
      { address_id: 'ADDR-101', is_primary: true },
    ]);

    expect(await service.saveAddress('PII-1', FIELDS, META)).toBe('ADDR-99');
    expect(addresses.update).toHaveBeenCalledWith('ADDR-99', {
      is_primary: true,
    });
    expect(piis.removeAddressRefs).toHaveBeenCalledWith('PII-1', ['ADDR-101']);
  });

  it('unlists its own id when a racer already removed its row', async () => {
    const { service, addresses, piis } = setup();
    // ADDR-101 is ours, already gone; two other racers' rows remain.
    addresses.ownRows.mockResolvedValue([
      { address_id: 'ADDR-99', is_primary: true },
      { address_id: 'ADDR-100', is_primary: true },
    ]);

    expect(await service.saveAddress('PII-1', FIELDS, META)).toBe('ADDR-99');
    expect(piis.removeAddressRefs).toHaveBeenCalledWith('PII-1', [
      'ADDR-100',
      'ADDR-101',
    ]);
  });
});

describe('PiiRepository', () => {
  const exec = <T>(value: T) => ({
    exec: () => Promise.resolve(value),
    lean: () => ({ exec: () => Promise.resolve(value) }),
  });

  it("writes a document slot only while empty or Vistaar's own", async () => {
    const updateOne = jest.fn(() => exec({ matchedCount: 0 }));
    const repo = new PiiRepository(
      { updateOne } as unknown as Model<PiiDocument>,
      {} as Model<AppCounterDocument>,
    );

    expect(await repo.setOwnDocument('PII-1', 'pan', { id: 'X' })).toBe(false);
    const [filter, update] = updateOne.mock.calls[0] as unknown as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(filter).toEqual({
      pii_id: 'PII-1',
      $or: [
        { 'documents.pan': { $exists: false } },
        { 'documents.pan': null },
        { 'documents.pan.source': 'vistaar' },
      ],
    });
    expect(update).toMatchObject({ $set: { 'documents.pan': { id: 'X' } } });
  });

  it('never upserts the shared piis counter', async () => {
    const findOneAndUpdate = jest.fn(() => exec(null));
    const repo = new PiiRepository(
      {} as Model<PiiDocument>,
      { findOneAndUpdate } as unknown as Model<AppCounterDocument>,
    );

    expect(await repo.nextPiiNumber()).toBeNull();
    const [, , options] = findOneAndUpdate.mock.calls[0] as unknown as [
      unknown,
      unknown,
      Record<string, unknown>,
    ];
    expect(options.upsert).toBeUndefined();
  });
});
