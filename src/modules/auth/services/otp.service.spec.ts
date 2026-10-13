import type { ConfigService } from '@nestjs/config';

import type { Env } from '@config/env.schema';

import type { OtpAttemptRepository } from '../repositories/otp-attempt.repository';
import { OtpService, verdictOf } from './otp.service';

describe('verdictOf', () => {
  it.each([
    [true, { otp_verified: true }, 'verified'],
    [true, { data: { otp_verified: true } }, 'verified'],
    [true, { message: 'OTP verified successfully' }, 'verified'],
    [true, { message: 'OTP verified success', type: 'success' }, 'status_only'],
    [false, { message: 'OTP verified successfully' }, 'refused'],
    [true, null, 'status_only'],
    [true, { otp_verified: false }, 'refused'],
    [true, { otp_verified: 'true' }, 'refused'],
    [true, { data: { otp_verified: false } }, 'refused'],
    [true, { error: 'OTP verification failed' }, 'refused'],
    [true, { type: 'error', message: 'OTP not match' }, 'refused'],
    [true, { data: { type: 'error', message: 'OTP expired' } }, 'refused'],
    [
      false,
      {
        error: 'OTP verification failed',
        data: { message: 'Mobile no. already verified', type: 'error' },
      },
      'refused',
    ],
    [false, { otp_verified: true }, 'refused'],
    [false, null, 'refused'],
  ])('ok=%s %j → %s', (ok, body, expected) => {
    expect(verdictOf(ok, body)).toBe(expected);
  });
});

describe('OtpService limits', () => {
  const config = {
    get: (key: string) =>
      ({
        OTP_API_URL: 'https://otp.example',
        OTP_TIMEOUT_MS: 1000,
        OTP_TEST_NUMBERS: '',
        OTP_TEST_CODE: undefined,
      })[key],
  } as unknown as ConfigService<Env, true>;

  it('refuses before calling the SMS service once the shared count is full', async () => {
    const attempts = {
      take: jest.fn().mockResolvedValue(120),
      reset: jest.fn(),
    };
    const service = new OtpService(
      config,
      attempts as unknown as OtpAttemptRepository,
    );
    await expect(service.send('9876543210', '91', false)).rejects.toMatchObject(
      {
        response: { error: 'OTP_LIMIT' },
      },
    );
    await expect(
      service.verify('9876543210', '91', '1234'),
    ).rejects.toMatchObject({ response: { error: 'OTP_LIMIT' } });
    expect(attempts.take).toHaveBeenCalledWith(
      'send:9876543210',
      3,
      600_000,
      expect.any(Date),
    );
    expect(attempts.take).toHaveBeenCalledWith(
      'verify:9876543210',
      5,
      600_000,
      expect.any(Date),
    );
  });
});
