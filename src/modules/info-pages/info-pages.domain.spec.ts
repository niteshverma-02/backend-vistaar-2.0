import {
  contentProblems,
  isOpenAt,
  unknownPlaceholders,
  type ContactUsContent,
  type OfficeHours,
} from './info-pages.domain';

const HOURS: OfficeHours = {
  days: [1, 2, 3, 4, 5, 6],
  opens: '10:00',
  closes: '19:00',
  label: 'Mon – Sat, 10 AM – 7 PM',
};

// 2026-10-13 is a Tuesday; IST = UTC + 5:30.
const ist = (date: string, time: string) =>
  new Date(`${date}T${time}:00+05:30`);

describe('isOpenAt', () => {
  it('is open from the opening minute', () => {
    expect(isOpenAt(HOURS, ist('2026-10-13', '10:00'))).toBe(true);
  });

  it('is closed at the closing minute', () => {
    expect(isOpenAt(HOURS, ist('2026-10-13', '19:00'))).toBe(false);
  });

  it('reads the IST day, not the UTC one', () => {
    // Monday 00:30 IST is still Sunday in UTC.
    expect(
      isOpenAt({ ...HOURS, opens: '00:00' }, ist('2026-10-12', '00:30')),
    ).toBe(true);
  });

  it('is closed on a day not listed', () => {
    expect(isOpenAt(HOURS, ist('2026-10-18', '12:00'))).toBe(false);
  });
});

describe('unknownPlaceholders', () => {
  it('lets the app-filled tokens through and names the rest, once', () => {
    const content = {
      a: 'Minimum {min_withdrawal}',
      b: ['within {grievance_sla_hours} hours', '{name} and {name}'],
    };
    expect(unknownPlaceholders(content)).toEqual(['name']);
  });
});

describe('contentProblems', () => {
  const contact = (hours: Partial<OfficeHours>): ContactUsContent =>
    ({ hours: { ...HOURS, ...hours } }) as ContactUsContent;

  it('refuses hours that close before they open', () => {
    expect(contentProblems('contact_us', contact({ closes: '09:00' }))).toEqual(
      ['The closing time must be after the opening time.'],
    );
  });

  it('refuses a working day listed twice', () => {
    expect(
      contentProblems('contact_us', contact({ days: [1, 1] })),
    ).toHaveLength(1);
  });
});
