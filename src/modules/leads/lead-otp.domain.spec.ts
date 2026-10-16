import {
  LEAD_OTP_TTL_MS,
  leadOtpKey,
  readLeadOtp,
  signLeadOtp,
} from './lead-otp.domain';

const key = leadOtpKey('a-test-secret-of-at-least-32-characters');
const AT = new Date('2026-10-16T10:00:00Z');
const ME = { agent_id: 'VST-000006', phone: '9876543210' };
const { otp_token, expires_at } = signLeadOtp(key, { ...ME, verified_at: AT });
const later = (ms: number) => new Date(AT.getTime() + ms);

describe('lead OTP token', () => {
  it('is good for this partner and mobile for 15 minutes, and carries when', () => {
    expect(expires_at).toEqual(later(LEAD_OTP_TTL_MS));
    expect(readLeadOtp(key, otp_token, ME, later(LEAD_OTP_TTL_MS - 1))).toEqual(
      { ok: true, verified_at: AT },
    );
    // The partner id is compared without case, as tokens carry it.
    expect(
      readLeadOtp(key, otp_token, { ...ME, agent_id: 'vst-000006' }, AT).ok,
    ).toBe(true);
  });

  it.each([
    ['expired', ME, later(LEAD_OTP_TTL_MS)],
    ['mismatch', { ...ME, agent_id: 'VST-000007' }, AT],
    ['mismatch', { ...ME, phone: '9876500000' }, AT],
  ] as const)('refuses: %s', (reason, expect_, now) => {
    expect(readLeadOtp(key, otp_token, expect_, now)).toEqual({
      ok: false,
      reason,
    });
  });

  it('refuses a token signed with another key, or altered', () => {
    const other = leadOtpKey('another-secret-of-at-least-32-characters');
    expect(readLeadOtp(other, otp_token, ME, AT)).toEqual({
      ok: false,
      reason: 'signature',
    });
    const [body, mac] = otp_token.split('.');
    const forged = Buffer.from(
      Buffer.from(body, 'base64url')
        .toString()
        .replace('9876543210', '9000000000'),
    ).toString('base64url');
    expect(
      readLeadOtp(key, `${forged}.${mac}`, { ...ME, phone: '9000000000' }, AT),
    ).toEqual({ ok: false, reason: 'signature' });
    expect(readLeadOtp(key, 'not-a-token', ME, AT)).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });
});
