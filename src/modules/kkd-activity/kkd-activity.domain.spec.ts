import {
  activitiesOf,
  filterActivities,
  indexFarmers,
  ownerOf,
  storeBookOf,
  storeOfOrder,
  storesWithin,
  summaryOf,
  type ActivitySources,
  type FarmerOrderRow,
  type FarmerRef,
  type ProductLabel,
} from './kkd-activity.domain';

const SINCE = new Date('2026-05-01T00:00:00Z');
const AFTER = new Date('2026-06-10T06:00:00Z');
const BEFORE = new Date('2026-04-10T06:00:00Z');

const FARMERS: FarmerRef[] = [
  { pii_id: 'PII-1', name: 'Ramesh', phone: '+91 98260 00001', since: SINCE },
  { pii_id: 'PII-2', name: 'Suresh', phone: '9826000002', since: SINCE },
];
const INDEX = indexFarmers(FARMERS);

const BOOK = storeBookOf({
  franchises: [
    {
      franchiseId: 'FR-100',
      city: 'Raisen',
      email: 'Raisen.Store@example.com',
      coordinates: [77.78, 23.33],
      warehouse_id: '681080d0b9311cc5685ed4c6',
    },
  ],
  v2: [{ franchise_id: 'FR-102', city: 'Bhopal' }],
  logins: [{ email: 'pos1@example.com', franchiseId: 'FR-100' }],
});

const PRODUCTS = new Map<string, ProductLabel>([
  [
    'SKU-1',
    { name: 'Zinc EDTA 12%', variant: { value: 250, uom: 'G' }, item_qty: 1 },
  ],
]);

const empty = (): ActivitySources => ({
  orders: [],
  posOrders: [],
  walkins: [],
  prescriptions: [],
  events: [],
});

const order = (o: Partial<FarmerOrderRow>): FarmerOrderRow => ({
  order_id: 'KSK-1',
  date: AFTER,
  pii_id: 'PII-1',
  marketplace: 'MKTP-3',
  order_status: 'delivered',
  total_amount: 499.6,
  items: [{ sku: 'SKU-1', qty: 2 }],
  ...o,
});

describe('ownerOf', () => {
  it('matches by pii_id first, else by the mobile in any format', () => {
    expect(ownerOf(INDEX, 'PII-2', '9826000001')?.pii_id).toBe('PII-2');
    expect(ownerOf(INDEX, 'PII-404', '919826000001')?.pii_id).toBe('PII-1');
    expect(ownerOf(INDEX, null, '9000000000')).toBeNull();
  });
});

describe('storeOfOrder', () => {
  it('finds the store by POS login, then by warehouse', () => {
    expect(storeOfOrder(order({ created_by: 'POS1@example.com ' }), BOOK)).toBe(
      'FR-100',
    );
    expect(
      storeOfOrder(order({ warehouse_id: '681080d0b9311cc5685ed4c6' }), BOOK),
    ).toBe('FR-100');
    expect(storeOfOrder(order({ warehouse_id: 'WH-9' }), BOOK)).toBeNull();
  });

  it('never counts a company order filed on a store', () => {
    expect(
      storeOfOrder(
        order({
          sub_source: 'founder_office',
          warehouse_id: '681080d0b9311cc5685ed4c6',
        }),
        BOOK,
      ),
    ).toBeNull();
  });
});

describe('storeBookOf', () => {
  it('names a store as the Nearby radar does, keeps v2 stores without a map point', () => {
    expect(BOOK.stores.get('FR-100')).toMatchObject({
      name: 'Katyayani Krishi Kendra · Raisen',
      lat: 23.33,
      lng: 77.78,
    });
    expect(BOOK.stores.get('FR-102')).toMatchObject({
      name: 'Katyayani Krishi Kendra · Bhopal',
      lat: null,
    });
    expect(BOOK.byLogin.get('raisen.store@example.com')).toBe('FR-100');
  });
});

describe('activitiesOf', () => {
  it('turns an app order into an app_order with catalogue lines and whole rupees', () => {
    const [a] = activitiesOf(
      { ...empty(), orders: [order({})] },
      INDEX,
      BOOK,
      PRODUCTS,
    );
    expect(a).toMatchObject({
      id: 'order:KSK-1',
      type: 'app_order',
      channel: 'app',
      customer_id: 'PII-1',
      customer_name: 'Ramesh',
      store: 'Katyayani app',
      amount: 500,
      items: ['Zinc EDTA 12% 250 G ×2'],
    });
  });

  it('keeps a store order only when it was sold at a store', () => {
    const items = activitiesOf(
      {
        ...empty(),
        orders: [
          order({
            order_id: 'FKO-1',
            marketplace: 'MKTP-4',
            warehouse_id: '681080d0b9311cc5685ed4c6',
          }),
          order({ order_id: 'FKO-2', marketplace: 'MKTP-4' }),
          order({
            order_id: 'FKO-3',
            marketplace: 'MKTP-4',
            sub_source: 'founder_office',
            warehouse_id: '681080d0b9311cc5685ed4c6',
          }),
        ],
      },
      INDEX,
      BOOK,
      PRODUCTS,
    );
    expect(items.map((a) => a.id)).toEqual(['order:FKO-1']);
    expect(items[0]).toMatchObject({
      type: 'store_order',
      store_id: 'FR-100',
      store: 'Katyayani Krishi Kendra · Raisen',
    });
  });

  it('leaves out what happened before the hold, other farmers and non-sales', () => {
    const items = activitiesOf(
      {
        ...empty(),
        orders: [
          order({ order_id: 'A', date: BEFORE }),
          order({ order_id: 'B', pii_id: 'PII-999' }),
          order({ order_id: 'C', order_status: 'cancelled' }),
          order({ order_id: 'D', order_status: 'split' }),
          order({ order_id: 'E', order_status: 'rto' }),
          order({ order_id: 'F', marketplace: 'MKTP-5' }),
        ],
      },
      INDEX,
      BOOK,
      PRODUCTS,
    );
    expect(items).toEqual([]);
  });

  it('shows a POS archive order once, and only when StockShip does not have it', () => {
    const items = activitiesOf(
      {
        ...empty(),
        orders: [
          order({
            order_id: 'FKO-7',
            marketplace: 'MKTP-4',
            warehouse_id: '681080d0b9311cc5685ed4c6',
          }),
        ],
        posOrders: [
          {
            order_id: 'FKO-7',
            franchise_id: 'FR-100',
            order_date: AFTER,
            phone: '9826000001',
            amount: 100,
            in_stockship: false,
            items: [],
          },
          {
            order_id: 'KFR-8',
            franchise_id: 'FR-100',
            order_date: AFTER,
            phone: '9826000002',
            amount: 250,
            in_stockship: false,
            items: [{ product: 'Neem Oil', quantity: 3 }],
          },
          {
            order_id: 'KFR-9',
            franchise_id: 'FR-100',
            order_date: AFTER,
            pii_id: 'PII-1',
            amount: 90,
            in_stockship: true,
            items: [],
          },
        ],
      },
      INDEX,
      BOOK,
      PRODUCTS,
    );
    expect(items.map((a) => a.id).sort()).toEqual([
      'order:FKO-7',
      'order:KFR-8',
    ]);
    expect(items.find((a) => a.id === 'order:KFR-8')).toMatchObject({
      customer_id: 'PII-2',
      items: ['Neem Oil ×3'],
      amount: 250,
    });
  });

  it('maps walk-ins (not rejected ones) and crop advice', () => {
    const items = activitiesOf(
      {
        ...empty(),
        walkins: [
          {
            _id: 'w1',
            franchise_id: 'FR-102',
            walked_in_at: AFTER,
            phone: '9826000001',
            status: 'converted',
            notes: ' asked for urea ',
          },
          {
            _id: 'w2',
            franchise_id: 'FR-100',
            walked_in_at: AFTER,
            pii_id: 'PII-1',
            status: 'rejected',
          },
        ],
        prescriptions: [
          {
            _id: 'x',
            rx_id: 'RX-1',
            franchise_id: 'FR-100',
            rx_date: AFTER,
            pii_id: 'PII-2',
            crop: 'Soybean',
            problem: 'Yellow leaves',
            solution: null,
            products: [{ name: 'Zinc EDTA' }, { sku: 'S-2' }],
          },
        ],
      },
      INDEX,
      BOOK,
      PRODUCTS,
    );
    expect(items.map((a) => a.id).sort()).toEqual([
      'advisory:RX-1',
      'walk_in:w1',
    ]);
    expect(items.find((a) => a.type === 'walk_in')).toMatchObject({
      store: 'Katyayani Krishi Kendra · Bhopal',
      note: 'asked for urea',
    });
    expect(items.find((a) => a.type === 'advisory')).toMatchObject({
      note: 'Soybean — Yellow leaves',
      items: ['Zinc EDTA'],
    });
  });

  it('keeps one app open per farmer per IST day, and maps abandoned carts', () => {
    const items = activitiesOf(
      {
        ...empty(),
        events: [
          {
            _id: 'e1',
            user_id: '9826000001',
            event_name: 'APP_LAUNCH',
            created_at: new Date('2026-06-10T19:00:00Z'), // 00:30 IST, 11 June
          },
          {
            _id: 'e2',
            user_id: '9826000001',
            event_name: 'APP_LAUNCH',
            created_at: new Date('2026-06-11T10:00:00Z'),
          },
          {
            _id: 'e3',
            user_id: '9826000001',
            event_name: 'APP_LAUNCH',
            created_at: new Date('2026-06-10T10:00:00Z'),
          },
          {
            _id: 'e4',
            user_id: '9826000002',
            event_name: 'Cart Abandoned',
            created_at: AFTER,
            total_price: 1299,
            items: [{ name: 'Humic Acid', quantity: 2 }],
          },
        ],
      },
      INDEX,
      BOOK,
      PRODUCTS,
    );
    expect(items.map((a) => a.id)).toEqual([
      'app_open:PII-1:2026-06-11',
      'app_open:PII-1:2026-06-10',
      'app_cart:e4',
    ]);
    expect(items[0].date).toEqual(new Date('2026-06-11T10:00:00Z'));
    expect(items[2]).toMatchObject({
      customer_id: 'PII-2',
      amount: 1299,
      items: ['Humic Acid ×2'],
    });
  });

  it('respects each farmer’s own hold start', () => {
    const index = indexFarmers([
      { ...FARMERS[0], since: new Date('2026-07-01T00:00:00Z') },
    ]);
    expect(
      activitiesOf({ ...empty(), orders: [order({})] }, index, BOOK, PRODUCTS),
    ).toEqual([]);
  });
});

describe('filterActivities and summaryOf', () => {
  const items = activitiesOf(
    {
      ...empty(),
      orders: [
        order({ order_id: 'A1', date: new Date('2026-06-05T06:00:00Z') }),
        order({
          order_id: 'S1',
          marketplace: 'MKTP-4',
          warehouse_id: '681080d0b9311cc5685ed4c6',
          total_amount: 1000,
          date: new Date('2026-06-06T06:00:00Z'),
        }),
        order({ order_id: 'A2', date: new Date('2026-07-02T06:00:00Z') }),
      ],
      walkins: [
        {
          _id: 'w1',
          franchise_id: 'FR-100',
          walked_in_at: new Date('2026-06-30T19:00:00Z'), // 1 July IST
          pii_id: 'PII-2',
        },
      ],
      events: [
        {
          _id: 'c1',
          user_id: '9826000001',
          event_name: 'Cart Abandoned',
          created_at: new Date('2026-06-04T06:00:00Z'),
          total_price: 300,
        },
        {
          _id: 'c2',
          user_id: '9826000002',
          event_name: 'Cart Abandoned',
          created_at: new Date('2026-06-04T06:00:00Z'),
          total_price: 700,
        },
      ],
    },
    INDEX,
    BOOK,
    PRODUCTS,
  );

  it('filters by farmer, channel and IST range', () => {
    expect(
      filterActivities(items, { customer: 'PII-2' }).map((a) => a.id),
    ).toEqual(['walk_in:w1', 'app_cart:c2']);
    expect(
      filterActivities(items, { channel: 'store' }).map((a) => a.id),
    ).toEqual(['walk_in:w1', 'order:S1']);
    expect(
      filterActivities(items, {
        from: new Date('2026-06-05T00:00:00+05:30'),
        to: new Date('2026-06-07T00:00:00+05:30'),
      }).map((a) => a.id),
    ).toEqual(['order:S1', 'order:A1']);
  });

  it('counts the month’s tiles by IST month; a cart followed by an app order is not open', () => {
    expect(summaryOf(items, '2026-06')).toEqual({
      month: '2026-06',
      walk_ins: 0,
      store_orders: { count: 1, amount: 1000 },
      app_orders: { count: 1, amount: 500 },
      open_app_carts: { count: 1, amount: 700 },
    });
    expect(summaryOf(items, '2026-07')).toMatchObject({
      walk_ins: 1,
      app_orders: { count: 1, amount: 500 },
      store_orders: { count: 0, amount: 0 },
    });
  });
});

describe('storesWithin', () => {
  it('keeps placed stores within the radius, nearest first', () => {
    const near = storesWithin(
      { lat: 23.26, lng: 77.41 }, // Bhopal, ~38 km from the Raisen store
      BOOK.stores.values(),
      50,
    );
    expect(near.map((s) => s.id)).toEqual(['FR-100']);
    expect(near[0].distance_km).toBeGreaterThan(30);
    expect(near[0].distance_km).toBeLessThan(50);
    expect(
      storesWithin({ lat: 22.72, lng: 75.86 }, BOOK.stores.values(), 50),
    ).toEqual([]);
  });
});
