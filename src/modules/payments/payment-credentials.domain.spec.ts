import {
  approvalRefusal,
  mask,
  defaultMode,
  splitFields,
} from './payment-credentials.domain';

const RZP = { key_id: 'rzp_test_AbCdEf123456' };
const PE = {
  client_id: 'TESTCLIENT',
  client_version: '1',
  client_secret: 'abcd-1234-efgh-5678',
};

describe('splitFields', () => {
  it('splits ids from secrets', () => {
    expect(splitFields('phonepe', PE)).toEqual({
      ok: {
        public_fields: { client_id: PE.client_id, client_version: '1' },
        secrets: { client_secret: PE.client_secret },
      },
    });
  });

  it('has no Cashfree field to take — KO Utils holds its keys', () => {
    expect(splitFields('cashfree', { app_id: 'TEST1234567890' })).toEqual({
      errors: ['"app_id" is not a cashfree field.'],
    });
  });

  it('takes a Razorpay Key ID alone — KO Utils holds the secret', () => {
    expect(splitFields('razorpay', RZP)).toEqual({
      ok: { public_fields: { key_id: RZP.key_id }, secrets: {} },
    });
  });

  it('refuses a Razorpay secret: the Key ID is the only field', () => {
    const out = splitFields('razorpay', { ...RZP, key_secret: 'x' });
    expect(out).toEqual({ errors: ['"key_secret" is not a razorpay field.'] });
  });

  it('refuses a pasted value with a newline', () => {
    const out = splitFields('razorpay', { key_id: `${RZP.key_id}\n` });
    expect('errors' in out && out.errors).toEqual([
      expect.stringMatching(/Key ID does not look right/),
    ]);
  });

  it('still requires the Key ID, and every field of the other gateways', () => {
    expect(splitFields('razorpay', {})).toEqual({
      errors: ['Please enter the Key ID.'],
    });
    expect(
      'errors' in splitFields('phonepe', { client_id: PE.client_id }),
    ).toBe(true);
  });

  it('takes a live Razorpay key as well as a test one', () => {
    expect(
      splitFields('razorpay', { key_id: 'rzp_live_AbCdEf123456' }),
    ).toHaveProperty('ok');
  });

  it('takes PhonePe fields', () => {
    expect(
      splitFields('phonepe', {
        client_id: 'TESTCLIENT',
        client_version: '1',
        client_secret: 'abcd-1234-efgh-5678',
      }),
    ).toHaveProperty('ok');
  });
});

describe('defaultMode', () => {
  it('starts on live in production, test everywhere else', () => {
    expect(defaultMode(true)).toBe('live');
    expect(defaultMode(false)).toBe('test');
  });
});

describe('mask', () => {
  it('shows only the last four', () => {
    expect(mask('AbCdEfGh12345678ZZ')).toBe('••••78ZZ');
  });
});

describe('approvalRefusal', () => {
  const now = new Date('2026-10-14T10:00:00Z');
  const base = {
    status: 'pending' as const,
    submitted_by: 'a@katyayaniorganics.com',
    expires_at: new Date('2026-10-15T10:00:00Z'),
    test_ok: true,
  };

  it('lets a second admin approve a checked set', () => {
    expect(approvalRefusal(base, 'b@katyayaniorganics.com', now)).toBeNull();
  });

  it('never lets the submitter approve, whatever the case of the email', () => {
    expect(approvalRefusal(base, 'A@Katyayaniorganics.com', now)).toBe(
      'same_person',
    );
  });

  it.each([
    [{ status: 'active' as const }, 'not_pending'],
    [{ expires_at: now }, 'expired'],
    [{ test_ok: false }, 'not_tested'],
    [{ test_ok: null }, 'not_tested'],
  ])('%j → %s', (change, refusal) => {
    expect(
      approvalRefusal({ ...base, ...change }, 'b@katyayaniorganics.com', now),
    ).toBe(refusal);
  });
});
