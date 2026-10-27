import {
  maskPhone,
  pageOf,
  PoolBuilder,
  stockshipStatus,
  storesOnMap,
  type StoreCandidate,
} from './radar.domain';

const candidate = (over: Partial<StoreCandidate>): StoreCandidate => ({
  id: 'FR-100',
  status: 'active',
  city: 'Raisen',
  state: 'Madhya Pradesh',
  address: 'Raisen',
  pincode: '464551',
  phone: null,
  point: { lat: 23.330111, lng: 77.7842511 },
  created_at: new Date('2025-05-05'),
  ...over,
});

describe('maskPhone', () => {
  it('keeps the first two and last two digits of a ten-digit mobile', () => {
    expect(maskPhone('9876543210')).toBe('98******10');
    expect(maskPhone('+91 98765 43210')).toBe('98******10');
  });

  it('gives null for no usable number', () => {
    expect(maskPhone(null)).toBeNull();
    expect(maskPhone('12345')).toBeNull();
  });
});

describe('stockshipStatus', () => {
  it('reads a franchise by its warehouse', () => {
    expect(stockshipStatus(null)).toBe('setup_pending');
    expect(stockshipStatus({ isActive: false })).toBe('inactive');
    expect(stockshipStatus({ isActive: true })).toBe('active');
    expect(stockshipStatus({})).toBe('active');
  });
});

describe('storesOnMap', () => {
  const noCentre = () => null;

  it('keeps the original when a later record copies its spot', () => {
    const spots = storesOnMap(
      [
        candidate({ id: 'FR-101', created_at: new Date('2025-05-14') }),
        candidate({ id: 'FR-100' }),
      ],
      noCentre,
    );
    expect(spots.map((s) => s.id)).toEqual(['FR-100']);
  });

  it('shows only active franchises', () => {
    const spots = storesOnMap(
      [
        candidate({
          id: 'FR-102',
          status: 'setup_pending',
          point: { lat: 23.2, lng: 77.4 },
        }),
        candidate({
          id: 'FR-103',
          status: 'inactive',
          point: { lat: 22.7, lng: 75.8 },
        }),
        candidate({}),
      ],
      noCentre,
    );
    expect(spots.map((s) => s.id)).toEqual(['FR-100']);
  });

  it("places a store without a point at its pincode's centre, as approximate", () => {
    const spots = storesOnMap(
      [candidate({ id: 'FR-104', point: null, pincode: '462022' })],
      (pin) => (pin === '462022' ? { lat: 23.27, lng: 77.45 } : null),
    );
    expect(spots).toEqual([
      expect.objectContaining({
        id: 'FR-104',
        lat: 23.27,
        lng: 77.45,
        exact: false,
      }),
    ]);
    expect(
      storesOnMap([candidate({ point: null, pincode: null })], noCentre),
    ).toEqual([]);
  });

  it('keeps two real stores a few hundred metres apart', () => {
    const spots = storesOnMap(
      [
        candidate({}),
        candidate({ id: 'FR-105', point: { lat: 23.333, lng: 77.7842511 } }),
      ],
      noCentre,
    );
    expect(spots).toHaveLength(2);
  });
});

describe('PoolBuilder', () => {
  it('files each pincode as the database ordered it, skipping bad pincodes and ids', () => {
    const b = new PoolBuilder();
    b.add('kkd_leads', { pin: '462002', ids: ['PII-B', 'PII-A', 'PII,X'] });
    b.add('kkd_leads', { pin: '46200', ids: ['PII-C'] });
    b.add('kkd_leads', { pin: '462003', ids: [] });
    const book = b.finish(new Set());
    expect([...book.kkd_leads]).toEqual([
      ['462002', { n: 2, ids: 'PII-B,PII-A' }],
    ]);
  });

  it('leaves out held farmers and shows a customer as the customer only', () => {
    const b = new PoolBuilder();
    b.add('kkd_leads', {
      pin: '462001',
      ids: ['PII-A', 'PII-HELD', 'PII-CUST'],
    });
    b.add('org_customers', { pin: '462009', ids: ['PII-CUST', 'PII-HELD2'] });
    const book = b.finish(new Set(['PII-HELD', 'PII-HELD2']));
    expect(book.kkd_leads.get('462001')).toEqual({ n: 1, ids: 'PII-A' });
    expect(book.org_customers.get('462009')).toEqual({
      n: 1,
      ids: 'PII-CUST',
    });
  });

  it('drops a pincode left empty', () => {
    const b = new PoolBuilder();
    b.add('kkd_leads', { pin: '462001', ids: ['PII-HELD'] });
    expect(b.finish(new Set(['PII-HELD'])).kkd_leads.size).toBe(0);
  });
});

describe('pageOf', () => {
  it('slices a filed list', () => {
    const filed = { n: 3, ids: 'A,B,C' };
    expect(pageOf(filed, 1, 1)).toEqual(['B']);
    expect(pageOf(filed, 3, 50)).toEqual([]);
    expect(pageOf(undefined, 0, 50)).toEqual([]);
  });
});
