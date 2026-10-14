import { todayOf, type TodaySources } from './today.domain';

// 2026-10-14 15:00 IST
const NOW = new Date('2026-10-14T09:30:00Z');
/** `hh`:00 IST on 2026-10-`day`. */
const ist = (day: number, hh: number) =>
  new Date(Date.UTC(2026, 9, day, hh) - 5.5 * 3600_000);

const lead = (pii: string, followUp: Date | null) => ({
  pii_id: pii,
  name: pii,
  phone: '6000000101',
  crops: ['Wheat'],
  acreage: 5,
  expected_value: 1000,
  stage: 'contacted',
  next_follow_up: followUp,
});

const cart = (id: string, updated: Date, extra = {}) => ({
  id,
  pii_id: 'PII-1',
  customer_name: 'Ramesh',
  contact_number: '6000000101',
  item_count: 2,
  subtotal: 900,
  reminder_sent: false,
  updated_at: updated,
  ...extra,
});

const event = (id: string, starts: Date, registered = true) => ({
  id,
  title: id,
  type: 'kisan_mela',
  starts_at: starts,
  location: 'Bhopal',
  registered,
});

const order = (id: string, status: string, created: Date) => ({
  id,
  customer_id: 'PII-1',
  customer_name: 'Ramesh',
  total: 500,
  payment_mode: 'cod',
  order_status: status,
  created_at: created,
});

const none: TodaySources = { dueLeads: [], carts: [], events: [], orders: [] };

describe('todayOf', () => {
  it('lists follow-ups first, most overdue first; overdue is urgent', () => {
    const view = todayOf(
      {
        ...none,
        dueLeads: [lead('PII-T', ist(14, 9)), lead('PII-O', ist(12, 10))],
      },
      NOW,
    );
    expect(view.items.map((t) => [t.ref_id, t.urgent])).toEqual([
      ['PII-O', true],
      ['PII-T', false],
    ]);
    expect(view.items[0]).toMatchObject({ type: 'follow_up', overdue_days: 2 });
    expect(view.items[1]).toMatchObject({ overdue_days: 0 });
  });

  it('reminds of carts for a farmer only, not reminded yet; 3 idle days is urgent', () => {
    const view = todayOf(
      {
        ...none,
        carts: [
          cart('DFT-1', ist(13, 12)),
          cart('DFT-2', ist(10, 12)),
          cart('DFT-3', ist(10, 12), { reminder_sent: true }),
          cart('DFT-4', ist(10, 12), { pii_id: null, customer_name: null }),
        ],
      },
      NOW,
    );
    expect(view.items.map((t) => [t.ref_id, t.urgent])).toEqual([
      ['DFT-2', true],
      ['DFT-1', false],
    ]);
    expect(view.items[0]).toMatchObject({ idle_days: 4 });
  });

  it('shows events with a seat today (urgent) or tomorrow, nothing later', () => {
    const view = todayOf(
      {
        ...none,
        events: [
          event('E-TODAY', ist(14, 18)),
          event('E-TOMORROW', ist(15, 10)),
          event('E-LATER', ist(16, 10)),
          event('E-NO-SEAT', ist(14, 18), false),
        ],
      },
      NOW,
    );
    expect(view.items.map((t) => [t.ref_id, t.urgent])).toEqual([
      ['E-TODAY', true],
      ['E-TOMORROW', false],
    ]);
  });

  it('lists orders waiting for the warehouse, oldest first, not failed ones', () => {
    const view = todayOf(
      {
        ...none,
        orders: [
          order('KSK-2', 'pending', ist(14, 9)),
          order('KSK-1', 'created', ist(12, 9)),
          order('KSK-X', 'failed', ist(11, 9)),
        ],
      },
      NOW,
    );
    expect(view.items.map((t) => t.ref_id)).toEqual(['KSK-1', 'KSK-2']);
  });

  it('keeps the app’s order across kinds and counts each', () => {
    const view = todayOf(
      {
        dueLeads: [lead('PII-T', ist(14, 9))],
        carts: [cart('DFT-1', ist(13, 12))],
        events: [event('E-TODAY', ist(14, 18))],
        orders: [order('KSK-1', 'created', ist(12, 9))],
      },
      NOW,
    );
    expect(view.items.map((t) => t.type)).toEqual([
      'follow_up',
      'saved_cart',
      'event',
      'order_to_confirm',
    ]);
    expect(view).toMatchObject({
      count: 4,
      counts: { follow_up: 1, saved_cart: 1, event: 1, order_to_confirm: 1 },
    });
  });
});
