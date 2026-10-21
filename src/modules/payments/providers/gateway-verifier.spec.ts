import { GatewayVerifier } from './gateway-verifier';

describe('GatewayVerifier — Razorpay', () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  const reply = (status: number) =>
    fetchMock.mockResolvedValue({ status, ok: status < 300 });

  it('checks a Key ID alone on the public preferences call, with no auth', async () => {
    reply(200);

    const out = await new GatewayVerifier().verify('razorpay', 'live', {
      key_id: 'rzp_live_AbCdEf123456',
    });

    expect(out.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://api.razorpay.com/v1/preferences?key_id=rzp_live_AbCdEf123456',
    );
    expect(init.headers).toBeUndefined();
  });

  it('reports a Key ID Razorpay does not know', async () => {
    reply(400);
    const out = await new GatewayVerifier().verify('razorpay', 'test', {
      key_id: 'rzp_test_AbCdEf123456',
    });
    expect(out.ok).toBe(false);
    expect(out.message).toMatch(/refused/);
  });
});
