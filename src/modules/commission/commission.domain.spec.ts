import {
  buildBook,
  defaultPlan,
  lineBases,
  nextSlab,
  planSlabs,
  quarterMonths,
  quarterOf,
  slabFor,
  slabsProblem,
  tdsOf,
  type BookContext,
  type OrderFact,
  type PlanInEffect,
  type SavedPlans,
} from './commission.domain';

const DAY = 24 * 3600 * 1000;
const NOW = new Date('2026-10-20T06:30:00Z'); // 20 Oct, noon IST
const SLABS = defaultPlan('vistaar_agent').slabs; // 5 / 7 / 10 at 50K / 1L

function fact(overrides: Partial<OrderFact> = {}): OrderFact {
  return {
    order_id: 'KSK-1',
    placed_at: new Date('2026-10-01T06:30:00Z'),
    pii_id: 'PII-1',
    customer_name: 'Ramesh Patel',
    order_status: 'created',
    // ₹10,500 with GST at 5% = ₹10,000 base.
    lines: [{ sku: 'K-5', qty: 1, total: 10_500, free: false }],
    deduction: 0,
    delivered_at: null,
    off_at: null,
    ...overrides,
  };
}

function ctx(overrides: Partial<BookContext> = {}): BookContext {
  return {
    now: NOW,
    selfPiiId: 'PII-9',
    returnWindowDays: 7,
    planFor: () => defaultPlan('vistaar_agent'),
    gstOf: (sku) => (sku === 'K-18' ? 18 : 5),
    payouts: [],
    open: 0,
    ...overrides,
  };
}

const delivered = (daysAgo: number) => ({
  order_status: 'delivered',
  delivered_at: new Date(NOW.getTime() - daysAgo * DAY),
});

describe('slabs', () => {
  it('accepts the PRD plans and refuses gaps, overlaps and an open middle', () => {
    expect(slabsProblem(SLABS)).toBeNull();
    expect(slabsProblem([])).toMatch(/1 to 10/);
    expect(
      slabsProblem([
        { from: 0, to: 50_000, rate: 5 },
        { from: 60_000, to: null, rate: 7 },
      ]),
    ).toMatch(/must start where/);
    expect(slabsProblem([{ from: 0, to: 50_000, rate: 5 }])).toMatch(
      /no upper limit/,
    );
    expect(slabsProblem([{ from: 100, to: null, rate: 5 }])).toMatch(/₹0/);
    for (const rate of [1.1, 2.55, 8.2, 0.29, 99.99])
      expect(slabsProblem([{ from: 0, to: null, rate }])).toBeNull();
    expect(slabsProblem([{ from: 0, to: null, rate: 7.555 }])).toMatch(
      /two decimals/,
    );
  });

  it('places sales in a slab (from included, to excluded) and names the next one', () => {
    expect(slabFor(SLABS, 49_999).rate).toBe(5);
    expect(slabFor(SLABS, 50_000).rate).toBe(7);
    expect(slabFor(SLABS, 2_00_000).rate).toBe(10);
    expect(nextSlab(SLABS, 62_000)).toEqual({ rate: 10, gap: 38_000 });
    expect(nextSlab(SLABS, 1_00_000)).toBeNull();
  });

  it('gives a cohort HO added later the "other" rates, as a draft', () => {
    expect(defaultPlan('new_cohort')).toMatchObject({
      draft: true,
      slabs: defaultPlan('other').slabs,
    });
  });
});

describe('lineBases', () => {
  it('takes discount and coins off by value, then each line’s own GST out', () => {
    const lines = lineBases(
      {
        lines: [
          { sku: 'K-5', qty: 1, total: 1_050, free: false },
          { sku: 'K-18', qty: 2, total: 1_180, free: false },
          { sku: 'K-5', qty: 1, total: 0, free: true },
        ],
        deduction: 223, // 10% of 2,230
      },
      (sku) => (sku === 'K-18' ? 18 : 5),
    );
    expect(lines.map((l) => Math.round(l.base))).toEqual([900, 900]);
  });

  it('is nothing when the discount covers the order', () => {
    expect(
      lineBases({ lines: fact().lines, deduction: 20_000 }, () => 5)[0].base,
    ).toBe(0);
  });
});

describe('buildBook', () => {
  it('is pending from placing at this month’s rate, confirmed 7 days after delivery', () => {
    const book = buildBook(
      [
        fact({ order_id: 'A' }),
        fact({ order_id: 'B', ...delivered(3) }),
        fact({ order_id: 'C', ...delivered(8) }),
      ],
      ctx(),
    );
    const by = new Map(book.rows.map((r) => [r.order_id, r]));
    expect(by.get('A')).toMatchObject({
      status: 'pending',
      order_value: 10_000,
      rate: 5,
      amount: 500,
      confirms_at: null,
    });
    expect(by.get('B')).toMatchObject({ status: 'pending' });
    expect(by.get('C')?.status).toBe('confirmed');
    expect(by.get('C')?.confirmed_at).toEqual(by.get('C')?.confirms_at);
    expect(book.current).toMatchObject({
      month: '2026-10',
      sales: 20_000,
      rate: 5,
      next_slab: { rate: 7, gap: 30_000 },
    });
  });

  it('pays the whole month at the slab it reaches (retro)', () => {
    const book = buildBook(
      [
        fact({ order_id: 'A', ...delivered(15) }),
        fact({
          order_id: 'B',
          ...delivered(2),
          lines: [{ sku: 'K-5', qty: 1, total: 52_500, free: false }],
        }),
      ],
      ctx(),
    );
    // 10,000 + 50,000 = 60,000 delivered in October → 7% on both.
    expect(book.rows.map((r) => [r.order_id, r.rate, r.amount])).toEqual([
      ['B', 7, 3_500],
      ['A', 7, 700],
    ]);
  });

  it('reverses an order cancelled or returned inside the window, but not after it', () => {
    const book = buildBook(
      [
        fact({ order_id: 'A', order_status: 'cancelled' }),
        fact({
          order_id: 'B',
          order_status: 'rto_delivered',
          delivered_at: new Date(NOW.getTime() - 10 * DAY),
          off_at: new Date(NOW.getTime() - 6 * DAY),
        }),
        fact({
          order_id: 'C',
          order_status: 'rto_delivered',
          delivered_at: new Date(NOW.getTime() - 10 * DAY),
          off_at: new Date(NOW.getTime() - 1 * DAY),
        }),
      ],
      ctx(),
    );
    const by = new Map(book.rows.map((r) => [r.order_id, r]));
    expect(by.get('A')).toMatchObject({
      status: 'reversed',
      reversed_reason: 'cancelled',
    });
    expect(by.get('B')).toMatchObject({
      status: 'reversed',
      reversed_reason: 'returned',
    });
    // Returned on day 9 after delivery: confirmed is final.
    expect(by.get('C')?.status).toBe('confirmed');
    // A reversed order is not a delivered sale.
    expect(book.month('2026-10').sales).toBe(10_000);
    expect(book.totals.reversed).toEqual({ count: 2, amount: 1_000 });
  });

  it('labels shop stock as self, with no customer', () => {
    const [row] = buildBook([fact({ pii_id: 'PII-9' })], ctx()).rows;
    expect(row).toMatchObject({
      pii_id: null,
      customer_name: 'Self (shop stock)',
    });
  });

  it('covers confirmed orders oldest first with payouts, and owes the rest', () => {
    const book = buildBook(
      [
        fact({ order_id: 'A', ...delivered(20) }),
        fact({ order_id: 'B', ...delivered(10) }),
        fact({ order_id: 'C', ...delivered(9) }),
      ],
      ctx({
        payouts: [
          { id: 'WD-1', amount: 500, paid_at: new Date('2026-10-12') },
          // After B confirmed (17 Oct), before C (18 Oct noon IST).
          { id: 'WD-2', amount: 300, paid_at: new Date('2026-10-18') },
        ],
        open: 200,
      }),
    );
    const by = new Map(book.rows.map((r) => [r.order_id, r]));
    expect(by.get('A')).toMatchObject({
      status: 'paid',
      withdrawal_id: 'WD-1',
      paid_amount: 500,
    });
    expect(by.get('B')).toMatchObject({
      status: 'confirmed',
      paid_amount: 300,
    });
    expect(by.get('C')).toMatchObject({ status: 'confirmed', paid_amount: 0 });
    expect(book).toMatchObject({ earned: 1_500, paid: 800, withdrawable: 500 });
    expect(book.totals.confirmed).toEqual({ count: 2, amount: 700 });
    expect(book.totals.paid).toEqual({ count: 1, amount: 800 });
  });

  it('adds no gig money with no credits: the same book as without them', () => {
    const facts = [
      fact({ order_id: 'A', ...delivered(20) }),
      fact({ order_id: 'B', ...delivered(10) }),
      fact({ order_id: 'C' }),
    ];
    const payouts = [
      { id: 'WD-1', amount: 500, paid_at: new Date('2026-10-12') },
      { id: 'WD-2', amount: 300, paid_at: new Date('2026-10-15') },
    ];
    const { month: _before, ...before } = buildBook(
      facts,
      ctx({ payouts, open: 200 }),
    );
    const { month: _after, ...after } = buildBook(
      facts,
      ctx({ payouts, open: 200, gigCredits: [] }),
    );
    expect(after).toEqual(before);
    expect(after.gig_earned).toBe(0);
  });

  it('adds approved gigs to earned and covers them in time order, never moving an order paid before', () => {
    // A confirms 13 days ago (delivered 20), B 3 days ago (delivered 10).
    const facts = [
      fact({ order_id: 'A', ...delivered(20) }),
      fact({ order_id: 'B', ...delivered(10) }),
    ];
    const gigCredits = [
      // Approved the instant A confirmed: A goes first.
      {
        id: 'GIG-1',
        amount: 250,
        approved_at: new Date(NOW.getTime() - 13 * DAY),
      },
      {
        id: 'GIG-2',
        amount: 250,
        approved_at: new Date(NOW.getTime() - 1 * DAY),
      },
    ];
    const payouts = [
      { id: 'WD-1', amount: 500, paid_at: new Date('2026-10-12') },
      { id: 'WD-2', amount: 250, paid_at: new Date('2026-10-15') },
    ];
    const book = buildBook(facts, ctx({ payouts, gigCredits }));
    const by = new Map(book.rows.map((r) => [r.order_id, r]));
    expect(by.get('A')).toMatchObject({
      status: 'paid',
      withdrawal_id: 'WD-1',
      paid_amount: 500,
    });
    // WD-2 paid GIG-1, approved before B confirmed.
    expect(by.get('B')).toMatchObject({ status: 'confirmed', paid_amount: 0 });
    expect(book.rows).toHaveLength(2);
    expect(book).toMatchObject({
      gig_earned: 500,
      earned: 1_500,
      paid: 750,
      withdrawable: 750,
    });
    expect(book.totals.confirmed).toEqual({ count: 1, amount: 750 });
    expect(book.totals.paid).toEqual({ count: 1, amount: 750 });
  });

  it('owes a top-up when the month’s rate rises after a payout, and takes nothing back when it falls', () => {
    const paidOne = {
      // Paid once A confirmed (17 Oct).
      payouts: [{ id: 'WD-1', amount: 500, paid_at: new Date('2026-10-18') }],
    };
    const rising = buildBook(
      [
        fact({ order_id: 'A', ...delivered(10) }),
        fact({
          order_id: 'B',
          ...delivered(1),
          lines: [{ sku: 'K-5', qty: 1, total: 52_500, free: false }],
        }),
      ],
      ctx(paidOne),
    );
    // A was paid at 5% (₹500); October now earns 7% → ₹200 more on A.
    expect(rising.withdrawable).toBe(200);

    const falling = buildBook([fact({ order_id: 'A', ...delivered(10) })], {
      ...ctx(paidOne),
      planFor: () => ({
        ...defaultPlan('x'),
        slabs: [{ from: 0, to: null, rate: 2 }],
      }),
    });
    expect(falling.withdrawable).toBe(0);
    expect(falling.totals.confirmed.amount).toBe(0);
  });

  it('never nets a payout that ran ahead from a later order, nor marks it paid by that payout', () => {
    const at = (d: string) => new Date(`${d}T06:30:00Z`);
    const facts = [
      // ₹40,000 + ₹10,000 in September reach 7%: A earns ₹2,800, paid by WD-1.
      fact({
        order_id: 'A',
        order_status: 'delivered',
        delivered_at: at('2026-09-20'),
        lines: [{ sku: 'K-5', qty: 1, total: 42_000, free: false }],
      }),
      // B is returned inside its window after WD-1: September falls to 5%, A to ₹2,000.
      fact({
        order_id: 'B',
        order_status: 'rto_delivered',
        delivered_at: at('2026-09-25'),
        off_at: at('2026-09-30'),
      }),
      // C confirms 12 Oct, after WD-1.
      fact({
        order_id: 'C',
        order_status: 'delivered',
        delivered_at: at('2026-10-05'),
      }),
    ];
    const book = buildBook(
      facts,
      ctx({
        payouts: [{ id: 'WD-1', amount: 2_800, paid_at: at('2026-09-28') }],
      }),
    );
    const by = new Map(book.rows.map((r) => [r.order_id, r]));
    expect(by.get('A')).toMatchObject({
      amount: 2_000,
      status: 'paid',
      withdrawal_id: 'WD-1',
    });
    expect(by.get('C')).toMatchObject({
      amount: 500,
      status: 'confirmed',
      paid_amount: 0,
      withdrawal_id: null,
    });
    expect(book).toMatchObject({
      earned: 2_500,
      paid: 2_800,
      withdrawable: 500,
    });
    expect(book.totals.confirmed).toEqual({ count: 1, amount: 500 });
  });

  it('a back-dated payment date still covers what was confirmed when it was approved', () => {
    const at = (d: string) => new Date(`${d}T06:30:00Z`);
    // A confirms 27 Sep; HO approves 28 Sep but enters the bank date as 25 Sep.
    const facts = [
      fact({
        order_id: 'A',
        order_status: 'delivered',
        delivered_at: at('2026-09-20'),
      }),
    ];
    const { earned } = buildBook(facts, ctx());
    const payout = { id: 'WD-1', amount: earned, paid_at: at('2026-09-25') };
    expect(buildBook(facts, ctx({ payouts: [payout] })).withdrawable).toBe(
      earned,
    );
    const book = buildBook(
      facts,
      ctx({ payouts: [{ ...payout, covers_to: at('2026-09-28') }] }),
    );
    expect(book.rows[0]).toMatchObject({
      status: 'paid',
      withdrawal_id: 'WD-1',
    });
    expect(book.withdrawable).toBe(0);
  });

  it('rates a month on the plan in effect then', () => {
    const book = buildBook(
      [
        fact({
          order_id: 'S',
          placed_at: new Date('2026-09-01T06:30:00Z'),
          delivered_at: new Date('2026-09-05T06:30:00Z'),
          order_status: 'delivered',
        }),
      ],
      ctx({
        planFor: (m) =>
          m < '2026-10'
            ? { ...defaultPlan('x'), slabs: [{ from: 0, to: null, rate: 3 }] }
            : defaultPlan('vistaar_agent'),
      }),
    );
    expect(book.rows[0]).toMatchObject({ rate: 3, amount: 300 });
    expect(book.current.rate).toBe(5);
  });
});

describe('TDS and quarters', () => {
  it('deducts to the paisa', () => {
    expect(tdsOf(970, 2)).toEqual({ tds: 19.4, net: 950.6 });
    expect(tdsOf(1_001, 20)).toEqual({ tds: 200.2, net: 800.8 });
  });

  it('reads FY quarters from April', () => {
    expect(quarterMonths('FY2026-Q2')).toEqual([
      '2026-07',
      '2026-08',
      '2026-09',
    ]);
    expect(quarterMonths('FY2026-Q4')).toEqual([
      '2027-01',
      '2027-02',
      '2027-03',
    ]);
    expect(quarterOf('2026-04')).toBe('FY2026-Q1');
    expect(quarterOf('2026-12')).toBe('FY2026-Q3');
    expect(quarterOf('2027-03')).toBe('FY2026-Q4');
  });
});

describe('earning cohorts', () => {
  // In ec_paddy from 10 Oct; OLD was placed before that, NEW after.
  const stretches = [
    { cohort_id: 'ec_paddy', from: new Date('2026-10-10T00:00:00Z') },
  ];
  const OLD = fact({ order_id: 'OLD', ...delivered(3) });
  const NEW = fact({
    order_id: 'NEW',
    placed_at: new Date('2026-10-12T06:30:00Z'),
    ...delivered(2),
  });

  const plan = (
    cohort: string,
    from: string,
    terms: Partial<PlanInEffect> = {},
  ): PlanInEffect => ({
    cohort,
    plan_id: `${cohort}@${from}`,
    effective_from: from,
    kind: 'slabs',
    slabs: SLABS,
    min_order_value: null,
    notes: [],
    draft: false,
    ...terms,
  });
  const fixed = (rate: number) => ({
    kind: 'fixed' as const,
    slabs: [{ from: 0, to: null, rate }],
  });
  /** The latest saved plan of the cohort started by the month. */
  const savedOf =
    (...rows: PlanInEffect[]): SavedPlans =>
    (cohort, month) =>
      rows
        .filter((r) => r.cohort === cohort && r.effective_from! <= month)
        .sort((a, b) =>
          b.effective_from!.localeCompare(a.effective_from!),
        )[0] ?? null;
  const book = (...saved: PlanInEffect[]) =>
    buildBook(
      [OLD, NEW],
      ctx({ earning: { stretches, saved: savedOf(...saved) } }),
    );
  const row = (b: ReturnType<typeof book>, id: string) =>
    b.rows.find((r) => r.order_id === id)!;

  it('keeps the partner-type plan before the first earning cohort, and while no earning plan is saved', () => {
    const b = book();
    expect(row(b, 'OLD')).toMatchObject({
      rate: 5,
      cohort_id: null,
      plan_id: null,
    });
    expect(row(b, 'NEW')).toMatchObject({
      rate: 5,
      cohort_id: 'ec_paddy',
      plan_id: null,
      below_min_order: false,
    });
    // No earning context at all: exactly the old book.
    expect(buildBook([OLD, NEW], ctx()).rows.map((r) => r.amount)).toEqual(
      b.rows.map((r) => r.amount),
    );
  });

  it('earns the cohort’s plan of the month placed — fixed or slabs', () => {
    const f = book(plan('ec_paddy', '2026-10', fixed(8)));
    expect(row(f, 'NEW')).toMatchObject({
      rate: 8,
      amount: 800,
      plan_id: 'ec_paddy@2026-10',
    });
    expect(row(f, 'OLD').rate).toBe(5);

    // Slabs: 20,000 delivered in October → the first slab.
    const slabs = book(
      plan('ec_paddy', '2026-10', {
        slabs: [
          { from: 0, to: 75_000, rate: 6 },
          { from: 75_000, to: null, rate: 9 },
        ],
      }),
    );
    expect(row(slabs, 'NEW').rate).toBe(6);

    // A plan from November does not reach an order placed in October.
    expect(row(book(plan('ec_paddy', '2026-11', fixed(12))), 'NEW').rate).toBe(
      5,
    );
  });

  it('pays an order below the minimum at the default cohort’s plan', () => {
    const paddy = plan('ec_paddy', '2026-10', {
      ...fixed(8),
      min_order_value: 20_000,
    });
    expect(
      row(book(paddy, plan('ec_default', '2026-10', fixed(4))), 'NEW'),
    ).toMatchObject({
      rate: 4,
      cohort_id: 'ec_paddy',
      plan_id: 'ec_default@2026-10',
      below_min_order: true,
    });
    // No default plan saved: the partner-type plan.
    expect(row(book(paddy), 'NEW')).toMatchObject({
      rate: 5,
      plan_id: null,
      below_min_order: true,
    });
    // At the minimum: the cohort's own plan.
    expect(
      row(book({ ...paddy, min_order_value: 10_000 }), 'NEW'),
    ).toMatchObject({ rate: 8, below_min_order: false });
  });

  it('gives a cohort with no plan of its own the default cohort’s', () => {
    expect(
      row(book(plan('ec_default', '2026-10', fixed(6))), 'NEW'),
    ).toMatchObject({ rate: 6, plan_id: 'ec_default@2026-10' });
  });

  it('heads the month with the cohort now, and sums each order at its own rate', () => {
    const b = book(plan('ec_paddy', '2026-10', fixed(8)));
    expect(b.current).toMatchObject({
      rate: 8,
      sales: 20_000,
      next_slab: null,
      commission: 500 + 800,
    });
    // September ended before the first cohort: the partner-type plan.
    expect(b.month('2026-09').rate).toBe(5);
  });

  it('builds a plan’s slabs from its kind', () => {
    expect(planSlabs('fixed', { rate: 7.5 })).toEqual({
      slabs: [{ from: 0, to: null, rate: 7.5 }],
    });
    expect(planSlabs('fixed', {})).toEqual({
      error: expect.stringMatching(/needs its `rate`/) as unknown,
    });
    expect(planSlabs('fixed', { rate: 5, slabs: SLABS })).toHaveProperty(
      'error',
    );
    expect(planSlabs('fixed', { rate: 7.555 })).toEqual({
      error: expect.stringMatching(/^Use at most two decimals/) as unknown,
    });
    expect(planSlabs('slabs', { rate: 5 })).toHaveProperty('error');
    expect(planSlabs('slabs', {})).toHaveProperty('error');
    expect(planSlabs('slabs', { slabs: SLABS })).toEqual({ slabs: SLABS });
  });
});
