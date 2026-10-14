import {
  isCounted,
  markTimes,
  BUSINESS_STATUSES,
  addressLine,
  firstUrl,
  personName,
  sizeLabel,
  stageOf,
  statusesFor,
  trackingSteps,
} from './orders.domain';

const at = (h: number) => new Date(Date.UTC(2026, 9, 12, h));

describe('stageOf', () => {
  it.each([
    ['created', 'placed'],
    ['confirmed', 'punched'],
    ['ready_to_dispatch', 'punched'],
    ['in transit', 'shipped'],
    ['In_Transit', 'shipped'],
    ['out_for_delivery', 'shipped'],
    ['delivered', 'delivered'],
    ['cancel', 'cancelled'],
    ['rto_intransit', 'returned'],
  ])('%s → %s', (raw, stage) => {
    expect(stageOf(raw)).toBe(stage);
  });

  it('reads an unknown or missing status as placed, so the order stays visible', () => {
    expect(stageOf('status_99')).toBe('placed');
    expect(stageOf(undefined)).toBe('placed');
  });
});

describe('statusesFor', () => {
  it('gives every spelling of a stage, for the $in', () => {
    expect(statusesFor('shipped')).toEqual(
      expect.arrayContaining(['in transit', 'in_transit', 'out_for_delivery']),
    );
    expect(statusesFor('delivered')).toEqual(['delivered']);
  });
});

describe('trackingSteps', () => {
  it('marks steps done up to where the order is, with first-entry times', () => {
    const steps = trackingSteps(
      'in_transit',
      [
        { stage_name: 'created', timestamp: at(1) },
        { stage_name: 'confirmed', timestamp: at(2) },
        { stage_name: 'packed', timestamp: at(3) },
        { stage_name: 'dispatched', timestamp: at(4) },
        { stage_name: 'in_transit', timestamp: at(5) },
      ],
      at(0),
    );

    expect(steps.map((s) => s.completed)).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
    expect(steps[0].timestamp).toEqual(at(1));
    expect(steps[1].timestamp).toEqual(at(2));
    expect(steps[2].timestamp).toEqual(at(4));
    expect(steps[3].timestamp).toBeNull();
  });

  it('falls back to the order date when the history is empty', () => {
    const steps = trackingSteps('created', [], at(0));
    expect(steps[0]).toMatchObject({ completed: true, timestamp: at(0) });
    expect(steps.filter((s) => s.completed)).toHaveLength(1);
  });

  it('counts a jumped-over step as done, with no time', () => {
    const steps = trackingSteps(
      'delivered',
      [
        { stage_name: 'created', timestamp: at(1) },
        { stage_name: 'delivered', timestamp: at(9) },
      ],
      at(0),
    );
    expect(steps.every((s) => s.completed)).toBe(true);
    expect(steps[2].timestamp).toBeNull();
    expect(steps[4].timestamp).toEqual(at(9));
  });

  it('ends a cancelled order on Cancelled, after the steps it reached', () => {
    const steps = trackingSteps(
      'cancelled',
      [
        { stage_name: 'created', timestamp: at(1) },
        { stage_name: 'confirmed', timestamp: at(2) },
        { stage_name: 'cancelled', timestamp: at(3) },
      ],
      at(0),
    );
    expect(steps.map((s) => s.status)).toEqual([
      'Order placed',
      'Confirmed',
      'Cancelled',
    ]);
    expect(steps[2]).toMatchObject({ completed: true, timestamp: at(3) });
  });
});

describe('formatting', () => {
  it('addressLine skips empty parts', () => {
    expect(
      addressLine({
        address1: '7/40/1 Bc colony',
        address2: '',
        city: 'Kanaganapalle',
        state: 'ANDHRA PRADESH',
        pincode: '515641',
      }),
    ).toBe('7/40/1 Bc colony, Kanaganapalle, ANDHRA PRADESH 515641');
    expect(addressLine(undefined)).toBe('');
  });

  it('personName drops a last name that repeats the first', () => {
    expect(personName('Mohan', 'mohan')).toBe('Mohan');
    expect(personName('Mohan', 'Rao')).toBe('Mohan Rao');
    expect(personName('Mohan', undefined)).toBe('Mohan');
  });

  it('sizeLabel adds the pack count only for a multi-pack', () => {
    expect(sizeLabel({ value: '250', uom: 'ML' }, '1')).toBe('250 ML');
    expect(sizeLabel({ value: 1, uom: 'L' }, 5)).toBe('1 L × 5');
    expect(sizeLabel(undefined, undefined)).toBe('');
  });

  it('firstUrl splits two URLs run together', () => {
    expect(firstUrl('https://a.com/x.webp?w=1https://a.com/x.webp')).toBe(
      'https://a.com/x.webp?w=1',
    );
    expect(firstUrl('')).toBeNull();
    expect(firstUrl(undefined)).toBeNull();
  });
});

describe('customer business', () => {
  it('counts business only from confirmed orders that were not returned', () => {
    expect(BUSINESS_STATUSES).toEqual(
      expect.arrayContaining(['confirmed', 'in_transit', 'delivered']),
    );
    expect(BUSINESS_STATUSES).not.toContain('rto');
    expect(BUSINESS_STATUSES).not.toContain('cancelled');
    expect(BUSINESS_STATUSES).not.toContain('pending');
  });
});

describe('markTimes', () => {
  const at = (iso: string) => new Date(iso);

  it('dates delivery and a return from the first entry into each', () => {
    expect(
      markTimes(
        [
          { stage_name: 'Delivered', timestamp: at('2026-10-05T10:00:00Z') },
          { stage_name: 'delivered', timestamp: at('2026-10-06T10:00:00Z') },
          {
            stage_name: 'rto_initiated',
            timestamp: at('2026-10-09T10:00:00Z'),
          },
        ],
        'rto_delivered',
        at('2026-10-10T10:00:00Z'),
      ),
    ).toEqual({
      delivered_at: at('2026-10-05T10:00:00Z'),
      off_at: at('2026-10-09T10:00:00Z'),
    });
  });

  it('takes the last status time when Stockship jumped straight to it', () => {
    const last = at('2026-10-07T10:00:00Z');
    expect(markTimes([], 'delivered', last)).toEqual({
      delivered_at: last,
      off_at: null,
    });
    expect(markTimes([], 'cancelled', last).off_at).toEqual(last);
    expect(markTimes([], 'in_transit', last)).toEqual({
      delivered_at: null,
      off_at: null,
    });
  });

  it('leaves split parents, merged orders and non-orders out of the count', () => {
    for (const s of ['split', 'merged', 'failed', 'pseudo', ' Split '])
      expect(isCounted(s)).toBe(false);
    expect(isCounted('delivered')).toBe(true);
  });
});
