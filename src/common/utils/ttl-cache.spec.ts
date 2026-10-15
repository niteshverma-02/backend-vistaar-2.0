import { TtlCache } from './ttl-cache';

describe('TtlCache', () => {
  afterEach(() => jest.useRealTimers());

  it('shares one load between callers, then loads again once expired', async () => {
    jest.useFakeTimers();
    const cache = new TtlCache<number>(1_000, 10);
    let loads = 0;
    const load = () => Promise.resolve(++loads);

    const [a, b] = await Promise.all([
      cache.get('k', load),
      cache.get('k', load),
    ]);
    expect([a, b, loads]).toEqual([1, 1, 1]);

    jest.advanceTimersByTime(1_001);
    await expect(cache.get('k', load)).resolves.toBe(2);
  });

  it('does not keep a failed load', async () => {
    const cache = new TtlCache<number>(60_000, 10);
    await expect(
      cache.get('k', () => Promise.reject(new Error('down'))),
    ).rejects.toThrow('down');
    await expect(cache.get('k', () => Promise.resolve(7))).resolves.toBe(7);
  });

  it('drops the oldest key past its size, and forgets on delete', async () => {
    const cache = new TtlCache<string>(60_000, 2);
    await cache.get('a', () => Promise.resolve('a'));
    await cache.get('b', () => Promise.resolve('b'));
    await cache.get('c', () => Promise.resolve('c'));
    expect(cache.size).toBe(2);
    await expect(cache.get('a', () => Promise.resolve('a2'))).resolves.toBe(
      'a2',
    );

    cache.delete('c');
    await expect(cache.get('c', () => Promise.resolve('c2'))).resolves.toBe(
      'c2',
    );
  });

  it('peeks at a fresh value without loading or storing', async () => {
    const cache = new TtlCache<number>(60_000, 10);
    expect(cache.peek('k')).toBeUndefined();
    expect(cache.size).toBe(0);
    await cache.get('k', () => Promise.resolve(5));
    await expect(cache.peek('k')).resolves.toBe(5);
  });
});
