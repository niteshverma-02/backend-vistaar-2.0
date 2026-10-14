import {
  approvalRefusal,
  mask,
  modeAllowed,
  splitFields,
} from './payment-credentials.domain';

const RZP = {
  key_id: 'rzp_test_AbCdEf123456',
  key_secret: 'AbCdEfGh12345678ZZ',
  webhook_secret: 'whsec-9f8e7d',
};

describe('splitFields', () => {
  it('splits ids from secrets', () => {
    const out = splitFields('razorpay', 'test', RZP);

    expect(out).toEqual({
      ok: {
        public_fields: { key_id: RZP.key_id },
        secrets: {
          key_secret: RZP.key_secret,
          webhook_secret: RZP.webhook_secret,
        },
      },
    });
  });

  it('refuses an unknown field instead of dropping it', () => {
    const out = splitFields('razorpay', 'test', { ...RZP, keysecret: 'x' });
    expect(out).toEqual({ errors: ['"keysecret" is not a razorpay field.'] });
  });

  it('refuses a missing secret and a pasted value with a newline', () => {
    const out = splitFields('razorpay', 'test', {
      key_id: RZP.key_id,
      key_secret: `${RZP.key_secret}\n`,
    });
    expect('errors' in out && out.errors).toEqual([
      expect.stringMatching(/Key secret does not look right/),
      'Please enter the Webhook secret.',
    ]);
  });

  it('refuses a live Razorpay key under test mode', () => {
    const out = splitFields('razorpay', 'test', {
      ...RZP,
      key_id: 'rzp_live_AbCdEf123456',
    });
    expect('errors' in out && out.errors[0]).toMatch(/live Key ID/);
  });

  it('takes PhonePe and Cashfree fields', () => {
    expect(
      splitFields('phonepe', 'test', {
        client_id: 'TESTCLIENT',
        client_version: '1',
        client_secret: 'abcd-1234-efgh-5678',
      }),
    ).toHaveProperty('ok');
    expect(
      splitFields('cashfree', 'test', {
        app_id: 'TEST1234567890',
        secret_key: 'cfsk_ma_test_abcdef1234567890',
      }),
    ).toHaveProperty('ok');
  });
});

describe('modeAllowed', () => {
  it('production takes only live keys, every other server only test keys', () => {
    expect(modeAllowed('live', true)).toBeNull();
    expect(modeAllowed('test', true)).toMatch(/live/);
    expect(modeAllowed('test', false)).toBeNull();
    expect(modeAllowed('live', false)).toMatch(/test/);
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
