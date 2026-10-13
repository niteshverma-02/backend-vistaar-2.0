import {
  festivalStatus,
  festivalTextError,
  ownsImage,
  signatureOf,
  statsRange,
  storyImageError,
  type StoryConfig,
  completeColors,
  designImageError,
  designWarnings,
  templateTextsError,
  readReceipt,
  receiptStem,
} from './stories.domain';

const config = (headline = 'Humic Acid'): StoryConfig => ({
  template: 'product',
  lang: 'en',
  theme: 'green',
  fields: {
    emoji: '🌾',
    headline,
    body: 'Stronger roots',
    detail1: '',
    detail2: 'Wheat',
    detail3: '1 kg',
    price: '499',
    mrp: '650',
    stars: 5,
  },
  show_whatsapp: true,
  photo_mode: 'inset',
});

const UUID = '2b1f3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

describe('signatureOf', () => {
  it('is the same for the same story and photo', () => {
    expect(signatureOf(config(), null)).toBe(signatureOf(config(), null));
  });

  it('changes with the text or the photo', () => {
    const base = signatureOf(config(), null);
    expect(signatureOf(config('Zinc'), null)).not.toBe(base);
    expect(signatureOf(config(), 'vistaar/stories/VST-1/x.png')).not.toBe(base);
  });
});

describe('ownsImage', () => {
  it("accepts only the caller's own folder", () => {
    const path = `vistaar/stories/VST-000001/${UUID}.png`;
    expect(ownsImage('VST-000001', path)).toBe(true);
    expect(ownsImage('VST-000002', path)).toBe(false);
  });

  it('refuses a prefix trick and other folders', () => {
    expect(ownsImage('VST-1', `vistaar/stories/VST-10/${UUID}.png`)).toBe(
      false,
    );
    expect(ownsImage('VST-1', `KO-documents/PII-1/selfie/${UUID}.png`)).toBe(
      false,
    );
  });
});

describe('storyImageError', () => {
  it('takes a 1080 × 1920 render and refuses a square one', () => {
    expect(storyImageError('render', 1080, 1920)).toBeNull();
    expect(storyImageError('render', 1080, 1080)).toMatch(/must be tall/);
    expect(storyImageError('render', 300, 533)).toMatch(/wide/);
  });

  it('takes any reasonable photo', () => {
    expect(storyImageError('photo', 1600, 1200)).toBeNull();
    expect(storyImageError('photo', 100, 1200)).toMatch(/at least/);
    expect(storyImageError('photo', 6000, 4000)).toMatch(/too large/);
  });
});

describe('festivalTextError', () => {
  it('needs English and both lines in every language', () => {
    expect(festivalTextError({ hi: { headline: 'a', body: 'b' } })).toBe(
      'Please add the greeting in English.',
    );
    expect(
      festivalTextError({
        en: { headline: 'Happy Diwali', body: 'Joy' },
        hi: { headline: 'दीपावली', body: ' ' },
      }),
    ).toBe('The Hindi greeting needs both a headline and a message.');
    expect(
      festivalTextError({ en: { headline: 'Happy Diwali', body: 'Joy' } }),
    ).toBeNull();
  });
});

describe('festivalStatus', () => {
  const now = new Date('2026-10-12T10:00:00Z');
  const at = (iso: string) => new Date(iso);

  it.each([
    [{ is_active: false, starts_at: null, ends_at: null }, 'inactive'],
    [
      { is_active: true, starts_at: null, ends_at: at('2026-10-01') },
      'expired',
    ],
    [
      { is_active: true, starts_at: at('2026-10-20'), ends_at: null },
      'scheduled',
    ],
    [{ is_active: true, starts_at: at('2026-10-01'), ends_at: null }, 'live'],
  ] as const)('%o → %s', (f, status) => {
    expect(festivalStatus(f, now)).toBe(status);
  });
});

describe('statsRange', () => {
  it('defaults to the last 30 days', () => {
    expect(statsRange(undefined, undefined, '2026-10-12')).toEqual({
      from: '2026-09-13',
      to: '2026-10-12',
    });
  });

  it('refuses a reversed or too long range', () => {
    expect(statsRange('2026-10-12', '2026-10-01', '2026-10-12')).toHaveProperty(
      'error',
    );
    expect(statsRange('2026-01-01', '2026-10-12', '2026-10-12')).toHaveProperty(
      'error',
    );
  });
});

describe('completeColors', () => {
  it('fills the optional colours the way the bundled designs are built', () => {
    const out = completeColors({
      bg_from: '#1d5a26',
      bg_to: '#3F8F3A',
      text: '#FFFFFF',
      accent: '#F6C945',
    });
    expect(out).toEqual({
      colors: {
        bg_from: '#1D5A26',
        bg_to: '#3F8F3A',
        text: '#FFFFFF',
        subtext: '#FFFFFFD1',
        accent: '#F6C945',
        accent_text: '#1D5A26',
        soft: '#FFFFFF29',
        deco: '#FFFFFF12',
        avatar: '#1D5A26',
      },
    });
  });

  it('refuses a missing, unknown or malformed colour', () => {
    expect(completeColors({ bg_from: '#000000' })).toEqual({
      error: 'Please choose the background (bottom) colour.',
    });
    const base = {
      bg_from: '#000000',
      bg_to: '#000000',
      text: '#FFFFFF',
      accent: '#FFFF00',
    };
    expect(completeColors({ ...base, accent: 'yellow' })).toEqual({
      error:
        'The highlight colour is not valid. Use a colour code, for example #1D5A26.',
    });
    expect(
      completeColors({ ...base, glow: '#FFFFFF' } as Record<string, string>),
    ).toEqual({ error: 'One of the colours is not part of a design.' });
  });
});

describe('designWarnings', () => {
  const colors = completeColors({
    bg_from: '#F9D449',
    bg_to: '#F29A1F',
    text: '#FFFFFF',
    accent: '#1D5A26',
    accent_text: '#FFFFFF',
  });
  if ('error' in colors) throw new Error(colors.error);

  it('warns about white text on yellow, but not over art', () => {
    expect(designWarnings(colors.colors, false)).toHaveLength(2);
    expect(designWarnings(colors.colors, true)).toEqual([]);
  });
});

describe('designImageError', () => {
  it('takes 9:16 art 720–2160 px wide', () => {
    expect(designImageError(1080, 1920)).toBeNull();
    expect(designImageError(1080, 1080)).toContain('must be tall');
    expect(designImageError(540, 960)).toContain('720');
  });
});

describe('templateTextsError', () => {
  it('needs en, a kicker per language, and only the languages the app draws', () => {
    expect(
      templateTextsError({ en: { kicker: 'Special offer', cta: '' } }),
    ).toBeNull();
    expect(templateTextsError({ hi: { kicker: 'ऑफ़र', cta: '' } })).toBe(
      'Please add the card words in English.',
    );
    expect(templateTextsError({ en: { kicker: ' ', cta: '' } })).toBe(
      'Please add the English top line of the card.',
    );
    expect(
      templateTextsError({
        en: { kicker: 'Offer', cta: '' },
        ta: { kicker: 'x', cta: '' },
      }),
    ).toBe('Card words can only be in English or Hindi.');
  });
});

describe('upload receipts', () => {
  const folder = 'vistaar/stories/VST-000001';
  const id = '2b1f3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
  const r = {
    kind: 'photo' as const,
    width: 1600,
    height: 1200,
    issuedAt: 1_791_871_000_000,
  };

  it('round-trips, and the path still passes ownsImage', () => {
    const path = `${folder}/${receiptStem(folder, id, r, 's')}.jpg`;
    expect(readReceipt(path, 's')).toEqual(r);
    expect(ownsImage('VST-000001', path)).toBe(true);
  });

  it('refuses another secret, another folder or an edited size', () => {
    const stem = receiptStem(folder, id, r, 's');
    expect(readReceipt(`${folder}/${stem}.jpg`, 'x')).toBeNull();
    expect(
      readReceipt(`vistaar/stories/VST-000002/${stem}.jpg`, 's'),
    ).toBeNull();
    expect(
      readReceipt(
        `${folder}/${stem.replace('1600x1200', '1601x1200')}.jpg`,
        's',
      ),
    ).toBeNull();
    expect(readReceipt(`${folder}/${id}.jpg`, 's')).toBeNull();
  });
});
