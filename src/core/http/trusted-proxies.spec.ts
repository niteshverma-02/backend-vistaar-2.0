import Fastify from 'fastify';

import { TRUSTED_PROXIES } from './trusted-proxies';

describe('trusted proxies', () => {
  const app = Fastify({ trustProxy: TRUSTED_PROXIES });
  app.get('/ip', (req) => ({ ip: req.ip }));
  afterAll(() => app.close());

  const ipFor = async (remote: string, forwarded: string) =>
    (
      await app.inject({
        url: '/ip',
        remoteAddress: remote,
        headers: { 'x-forwarded-for': forwarded },
      })
    ).json<{ ip: string }>().ip;

  it('finds the caller behind Cloudflare and Render, ignoring what the caller wrote', async () => {
    // caller-written, real caller (added by Cloudflare), Cloudflare edge (added by Render)
    expect(await ipFor('10.0.3.7', '1.2.3.4, 49.36.10.20, 172.70.1.1')).toBe(
      '49.36.10.20',
    );
  });

  it('finds the caller behind one private load balancer (AWS)', async () => {
    expect(await ipFor('10.0.3.7', '9.9.9.9, 49.36.10.20')).toBe('49.36.10.20');
  });

  it('never believes the header from a public caller connecting directly', async () => {
    expect(await ipFor('49.36.10.20', '1.2.3.4')).toBe('49.36.10.20');
  });
});
