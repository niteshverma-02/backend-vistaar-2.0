import type { ConfigService } from '@nestjs/config';

import type { Env } from '@config/env.schema';

import {
  CustomerPassError,
  KoSalesCustomerClient,
} from './ko-sales-customer.client';

const KEY = 'kp.vistaar.Xk29abcdefghijklmnopqrstuvwxyz0123456789ABCD';

const configWith = (key: string) =>
  ({
    get: (k: string) =>
      ({
        B2B_API_URL: 'https://ko-sales.test/api/v1/',
        KATYAYANI_PLATFORM_KEY: key,
      })[k],
  }) as unknown as ConfigService<Env, true>;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status });

const PAIR = {
  access_token: 'eyJ.a.b',
  token_type: 'Bearer',
  expires_in: 3600,
  refresh_token: 'hFZIfA3azat4UqflvWWDRQ.k8Fq',
  refresh_expires_in: 2592000,
  pii_id: 'PII-54018',
  is_new_customer: false,
};

describe('KoSalesCustomerClient', () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  it('is off without a platform key', () => {
    expect(new KoSalesCustomerClient(configWith('')).enabled).toBe(false);
    expect(new KoSalesCustomerClient(configWith(KEY)).enabled).toBe(true);
  });

  it('asks for a temp code with the key, then spends it on a pass pair', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { temp_code: 'tc-1', expires_in: 120 }))
      .mockResolvedValueOnce(json(200, PAIR));

    const pair = await new KoSalesCustomerClient(configWith(KEY)).open(
      '9876543210',
      { device_id: 'dev-1', device_name: 'Redmi Note 12' },
    );

    expect(pair).toEqual({
      access_token: 'eyJ.a.b',
      refresh_token: 'hFZIfA3azat4UqflvWWDRQ.k8Fq',
      expires_in: 3600,
      refresh_expires_in: 2592000,
      pii_id: 'PII-54018',
      is_new_customer: false,
    });
    const [codeUrl, codeInit] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(codeUrl).toBe(
      'https://ko-sales.test/api/v1/customer/auth/temp-code',
    );
    expect(codeInit.headers).toMatchObject({ 'x-platform-key': KEY });
    expect(JSON.parse(codeInit.body as string)).toEqual({
      phone: '9876543210',
    });

    const [tokenUrl, tokenInit] = fetchMock.mock.calls[1] as [
      string,
      RequestInit,
    ];
    expect(tokenUrl).toBe('https://ko-sales.test/api/v1/customer/auth/token');
    // The key goes to temp-code only.
    expect(tokenInit.headers).not.toHaveProperty('x-platform-key');
    expect(JSON.parse(tokenInit.body as string)).toEqual({
      grant_type: 'temp_code',
      platform: 'vistaar',
      phone: '9876543210',
      temp_code: 'tc-1',
      device_id: 'dev-1',
      device_name: 'Redmi Note 12',
    });
  });

  it.each([
    [401, {}, 'key_refused'],
    [403, {}, 'platform_off'],
    [429, {}, 'busy'],
    [
      404,
      { message: 'Cannot POST /api/v1/customer/auth/temp-code' },
      'unavailable',
    ],
    [502, {}, 'unavailable'],
  ])('temp-code HTTP %i → %s', async (status, body, reason) => {
    fetchMock.mockResolvedValueOnce(json(status, body));
    await expect(
      new KoSalesCustomerClient(configWith(KEY)).open('9876543210', {}),
    ).rejects.toMatchObject({ reason, status });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [401, { message: 'Multiple accounts use this phone' }, 'duplicate_pii'],
    [
      401,
      { message: 'Customer session required — please log in.' },
      'code_refused',
    ],
    [400, { message: ['otp: otp must be 4-8 digits'] }, 'unavailable'],
  ])('token HTTP %i %j → %s', async (status, body, reason) => {
    fetchMock
      .mockResolvedValueOnce(json(200, { temp_code: 'tc-1', expires_in: 120 }))
      .mockResolvedValueOnce(json(status, body));
    await expect(
      new KoSalesCustomerClient(configWith(KEY)).open('9876543210', {}),
    ).rejects.toMatchObject({ reason });
  });

  it('treats no answer as unavailable', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    const error: unknown = await new KoSalesCustomerClient(configWith(KEY))
      .open('9876543210', {})
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CustomerPassError);
    expect(error).toMatchObject({ reason: 'unavailable', status: null });
  });

  it('refuses a token answer without the pass fields', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { temp_code: 'tc-1' }))
      .mockResolvedValueOnce(json(200, { access_token: 'only' }));
    await expect(
      new KoSalesCustomerClient(configWith(KEY)).open('9876543210', {}),
    ).rejects.toMatchObject({ reason: 'unavailable' });
  });

  it('logs out without throwing when ko-sales is down', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(
      new KoSalesCustomerClient(configWith(KEY)).logout('rt'),
    ).resolves.toBeUndefined();
  });
});
