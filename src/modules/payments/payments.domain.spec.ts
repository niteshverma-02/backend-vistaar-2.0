import { isShownTo, orderError, textError } from './payments.domain';

describe('isShownTo', () => {
  it('hides an option that is off, whatever its cohorts', () => {
    expect(isShownTo({ is_active: false, cohorts: [] }, 'shop')).toBe(false);
  });

  it('shows an option with no cohorts to every partner, one without a cohort too', () => {
    expect(isShownTo({ is_active: true, cohorts: [] }, 'shop')).toBe(true);
    expect(isShownTo({ is_active: true, cohorts: [] }, null)).toBe(true);
  });

  it('shows a targeted option only to its cohorts', () => {
    const option = { is_active: true, cohorts: ['shop'] };
    expect(isShownTo(option, 'shop')).toBe(true);
    expect(isShownTo(option, 'farmer_leader')).toBe(false);
    expect(isShownTo(option, null)).toBe(false);
  });
});

describe('textError', () => {
  it('accepts plain text', () => {
    expect(textError('label', 'Razorpay')).toBeNull();
    expect(textError('hint', '')).toBeNull();
  });

  it('refuses an empty name', () => {
    expect(textError('label', '')).toMatch(/name/);
  });

  it.each(['Pay at https://x.in', 'www.pay.in', '<b>Pay</b>'])(
    'refuses a link or markup: %s',
    (text) => {
      expect(textError('hint', text)).toMatch(/links/);
    },
  );

  it('refuses text over the limit', () => {
    expect(textError('label', 'x'.repeat(41))).toMatch(/40/);
    expect(textError('hint', 'x'.repeat(81))).toMatch(/80/);
  });
});

describe('orderError', () => {
  it('accepts every option once', () => {
    expect(orderError(['phonepe', 'razorpay', 'cashfree'])).toBeNull();
  });

  it.each([
    [['razorpay', 'cashfree']],
    [['razorpay', 'razorpay', 'cashfree']],
    [['razorpay', 'cashfree', 'paytm']],
  ])('refuses %j', (ids) => {
    expect(orderError(ids)).not.toBeNull();
  });
});
