import {
  BANNER_IMAGE_PATTERN,
  LINK_PATTERN,
  contentError,
  imageSizeError,
  isShownTo,
  statusOf,
  windowError,
  type BannerWindow,
} from './banners.domain';

const NOW = new Date('2026-10-12T12:00:00Z');
const before = new Date('2026-10-01T00:00:00Z');
const after = new Date('2026-10-20T00:00:00Z');

const window = (overrides: Partial<BannerWindow> = {}): BannerWindow => ({
  is_active: true,
  starts_at: null,
  ends_at: null,
  ...overrides,
});

describe('statusOf', () => {
  it.each([
    ['open-ended', window(), 'live'],
    [
      'inside its window',
      window({ starts_at: before, ends_at: after }),
      'live',
    ],
    ['not started', window({ starts_at: after }), 'scheduled'],
    ['ended', window({ ends_at: before }), 'expired'],
    ['ending exactly now', window({ ends_at: NOW }), 'expired'],
    ['starting exactly now', window({ starts_at: NOW }), 'live'],
    [
      'switched off, even inside its window',
      window({ is_active: false }),
      'inactive',
    ],
  ])('%s → %s', (_, banner, expected) => {
    expect(statusOf(banner, NOW)).toBe(expected);
  });
});

describe('isShownTo', () => {
  const everyone = { ...window(), cohorts: [] };
  const agentsOnly = { ...window(), cohorts: ['vistaar_agent'] };

  it('shows an untargeted banner to every partner, cohort or not', () => {
    expect(isShownTo(everyone, 'consultant', NOW)).toBe(true);
    expect(isShownTo(everyone, null, NOW)).toBe(true);
  });

  it('shows a targeted banner only to its cohorts', () => {
    expect(isShownTo(agentsOnly, 'vistaar_agent', NOW)).toBe(true);
    expect(isShownTo(agentsOnly, 'consultant', NOW)).toBe(false);
  });

  it('hides a targeted banner from a partner who has not picked a cohort', () => {
    expect(isShownTo(agentsOnly, null, NOW)).toBe(false);
  });

  it('never shows a banner that is not live', () => {
    expect(isShownTo({ ...everyone, starts_at: after }, 'x', NOW)).toBe(false);
    expect(isShownTo({ ...everyone, is_active: false }, 'x', NOW)).toBe(false);
  });
});

describe('windowError', () => {
  it('accepts an open or ordered window', () => {
    expect(windowError(null, null)).toBeNull();
    expect(windowError(before, null)).toBeNull();
    expect(windowError(null, before)).toBeNull();
    expect(windowError(before, after)).toBeNull();
  });

  it('refuses an end at or before the start', () => {
    expect(windowError(after, before)).toMatch(/end date/);
    expect(windowError(before, before)).toMatch(/end date/);
  });
});

describe('LINK_PATTERN', () => {
  it.each(['/products', '/events', '/products/p8', '/shop?cat=bio_stimulants'])(
    'accepts in-app route %s',
    (link) => expect(LINK_PATTERN.test(link)).toBe(true),
  );

  it.each([
    'https://example.com',
    'products',
    'javascript:alert(1)',
    '/products onclick',
    '',
  ])('refuses %s', (link) => expect(LINK_PATTERN.test(link)).toBe(false));
});

describe('contentError', () => {
  const text = { subtitle: { en: '12 Oct' }, cta: { en: 'Register' } };

  it('accepts a text banner with subtitle and button', () => {
    expect(contentError({ image_path: null, ...text })).toBeNull();
  });

  it('accepts an image banner with no text at all', () => {
    expect(
      contentError({
        image_path: 'vistaar/banners/x.png',
        subtitle: null,
        cta: null,
      }),
    ).toBeNull();
  });

  it.each([
    ['no subtitle', { ...text, subtitle: null }, /English subtitle/],
    ['a blank button', { ...text, cta: { en: '  ' } }, /button text/],
    ['Hindi only', { ...text, cta: { hi: 'रजिस्टर' } }, /button text/],
  ])('refuses a text banner with %s', (_, content, message) => {
    expect(contentError({ image_path: null, ...content })).toMatch(message);
  });
});

describe('imageSizeError', () => {
  it.each([
    [1200, 500],
    [600, 250],
    [1000, 417],
    [2400, 1000],
  ])('accepts %i × %i', (w, h) => {
    expect(imageSizeError(w, h)).toBeNull();
  });

  it.each([
    [599, 250, /at least 600 pixels wide/],
    [1200, 400, /at this width: 1200 × 500 pixels/],
    [1080, 1080, /2\.4 times as wide/],
    [1080, 1920, /2\.4 times as wide/],
    [2000, 400, /2\.4 times as wide/],
  ])('refuses %i × %i', (w, h, message) => {
    expect(imageSizeError(w, h)).toMatch(message);
  });
});

describe('BANNER_IMAGE_PATTERN', () => {
  it('accepts only paths this service wrote', () => {
    const id = '2b1f3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
    expect(BANNER_IMAGE_PATTERN.test(`vistaar/banners/${id}.webp`)).toBe(true);
    expect(BANNER_IMAGE_PATTERN.test(`KO-documents/PII-1/pan/${id}.jpg`)).toBe(
      false,
    );
    expect(BANNER_IMAGE_PATTERN.test(`vistaar/banners/../${id}.jpg`)).toBe(
      false,
    );
  });
});
