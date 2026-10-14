import {
  DEFAULT_NPS_REASONS,
  cleanReasons,
  followUpDueAt,
  istRange,
  npsBucket,
  npsScore,
  productKey,
  withDefaults,
} from './feedback.domain';

describe('npsBucket', () => {
  it.each([
    [0, 'detractor'],
    [6, 'detractor'],
    [7, 'passive'],
    [8, 'passive'],
    [9, 'promoter'],
    [10, 'promoter'],
  ])('%i is a %s', (score, bucket) => {
    expect(npsBucket(score)).toBe(bucket);
  });
});

describe('npsScore', () => {
  it('is % promoters minus % detractors', () => {
    expect(npsScore({ detractor: 1, passive: 2, promoter: 5 })).toBe(50);
  });

  it('is null with no answers', () => {
    expect(npsScore({ detractor: 0, passive: 0, promoter: 0 })).toBeNull();
  });
});

describe('followUpDueAt', () => {
  it('is the end of the second working day after, in IST', () => {
    // Mon 12 Oct 2026, 10:00 IST → end of Wed 14 Oct IST.
    expect(followUpDueAt(new Date('2026-10-12T04:30:00Z'))).toEqual(
      new Date('2026-10-14T18:29:59.999Z'),
    );
  });

  it('skips Sunday', () => {
    // Sat 17 Oct 2026 → Mon 19, Tue 20.
    expect(followUpDueAt(new Date('2026-10-17T06:00:00Z'))).toEqual(
      new Date('2026-10-20T18:29:59.999Z'),
    );
  });

  it('counts from the IST day, not the UTC one', () => {
    // 23:00 IST Fri 16 Oct is still Friday in IST → Sat 17, Mon 19.
    expect(followUpDueAt(new Date('2026-10-16T17:30:00Z'))).toEqual(
      new Date('2026-10-19T18:29:59.999Z'),
    );
  });
});

describe('cleanReasons', () => {
  it('trims and drops blanks and repeats, keeping the first spelling', () => {
    expect(
      cleanReasons([' Late delivery ', '', 'late delivery', 'Price too high']),
    ).toEqual(['Late delivery', 'Price too high']);
  });

  it('is empty when nothing was picked', () => {
    expect(cleanReasons(undefined)).toEqual([]);
  });
});

describe('productKey', () => {
  it('groups the same ask however it was typed', () => {
    expect(productKey(' Emamectin  Benzoate 5% sg')).toBe(
      productKey('emamectin benzoate 5% SG'),
    );
  });
});

describe('istRange', () => {
  it('covers whole IST days, both ends included', () => {
    expect(istRange('2026-10-01', '2026-10-14')).toEqual({
      start: new Date('2026-09-30T18:30:00Z'),
      end: new Date('2026-10-14T18:30:00Z'),
    });
  });

  it('refuses a backwards range and one over a year', () => {
    expect(istRange('2026-10-14', '2026-10-01')).toBeNull();
    expect(istRange('2025-01-01', '2026-10-14')).toBeNull();
  });
});

describe('withDefaults', () => {
  it("is the app's own copy when HO never saved any", () => {
    expect(withDefaults(null)).toEqual(DEFAULT_NPS_REASONS);
  });

  it('keeps a saved group and falls back for a broken one', () => {
    const r = withDefaults({
      promoter: { question: 'Best part?', chips: ['Easy app'] },
      passive: { question: 'x', chips: 'not a list' },
    });
    expect(r.promoter).toEqual({ question: 'Best part?', chips: ['Easy app'] });
    expect(r.passive).toEqual(DEFAULT_NPS_REASONS.passive);
  });
});
