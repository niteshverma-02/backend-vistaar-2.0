import {
  completeError,
  countsOf,
  duplicatePhone,
  mergeAttendees,
  type Attendee,
} from './meetings.domain';

function attendee(overrides: Partial<Attendee> = {}): Attendee {
  return {
    phone: '9876500001',
    name: 'Ramesh',
    village: 'Rampur',
    pii_id: null,
    invited: false,
    present: false,
    walk_in: true,
    lead_captured: false,
    ...overrides,
  };
}

describe('mergeAttendees', () => {
  it("keeps the server's link that a resend drops, and takes the rest from the sender", () => {
    const stored = [
      attendee({ pii_id: 'PII-9', lead_captured: true, present: false }),
    ];
    const { lead_captured: _l, ...stale } = attendee({
      name: 'Ramesh K',
      present: true,
    });
    const fresh = attendee({ phone: '9876500002', pii_id: 'PII-2' });
    const { lead_captured: _f, ...freshSent } = fresh;

    const [kept, added] = mergeAttendees(stored, [stale, freshSent]);

    expect(kept).toMatchObject({
      pii_id: 'PII-9',
      lead_captured: true,
      name: 'Ramesh K',
      present: true,
    });
    expect(added).toMatchObject({ pii_id: 'PII-2', lead_captured: false });
  });
});

describe('countsOf', () => {
  it('counts invited, present and captured separately', () => {
    expect(
      countsOf([
        attendee({ invited: true, present: true }),
        attendee({ invited: true }),
        attendee({ present: true, lead_captured: true }),
      ]),
    ).toEqual({ invited: 2, present: 2, leads: 1 });
  });
});

describe('completeError', () => {
  it('needs one farmer present, and never completes a closed meeting', () => {
    expect(completeError('scheduled', [attendee()])).not.toBeNull();
    expect(completeError('scheduled', [attendee({ present: true })])).toBe(
      null,
    );
    const present = [attendee({ present: true })];
    expect(completeError('cancelled', present)).not.toBeNull();
    expect(completeError('completed', present)).not.toBeNull();
  });
});

describe('duplicatePhone', () => {
  it('names the first repeated phone, or null', () => {
    expect(
      duplicatePhone([{ phone: '1' }, { phone: '2' }, { phone: '1' }]),
    ).toBe('1');
    expect(duplicatePhone([{ phone: '1' }, { phone: '2' }])).toBeNull();
  });
});
