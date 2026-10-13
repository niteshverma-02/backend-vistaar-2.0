import type { ConfigService } from '@nestjs/config';

import type { Env } from '@config/env.schema';

import { B2bCatalogClient, B2bUnauthorizedError } from './b2b-catalog.client';

const config = {
  get: (key: string) =>
    key === 'B2B_API_URL' ? 'https://b2b.test/api/v1' : 'MKTP-1',
} as unknown as ConfigService<Env, true>;

const ok = () =>
  new Response(JSON.stringify({ success: true, data: [], total_pages: 1 }), {
    status: 200,
  });

const timeout = () =>
  Object.assign(new Error('The operation was aborted due to timeout'), {
    name: 'TimeoutError',
  });

describe('B2bCatalogClient.fetchAll', () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  it('asks a timed-out page once more instead of failing the cart', async () => {
    fetchMock.mockRejectedValueOnce(timeout()).mockResolvedValueOnce(ok());
    await expect(new B2bCatalogClient(config).fetchAll('t')).resolves.toEqual(
      [],
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a 5xx, but gives up after the second try', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 502 }));
    await expect(new B2bCatalogClient(config).fetchAll('t')).rejects.toThrow(
      '502',
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never retries a refused token', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 401 }));
    await expect(
      new B2bCatalogClient(config).fetchAll('t'),
    ).rejects.toBeInstanceOf(B2bUnauthorizedError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
