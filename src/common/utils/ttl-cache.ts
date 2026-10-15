/**
 * A per-process cache of loaded values that expire after `ttlMs`.
 *
 * Callers asking for the same key while it loads share one load: the app
 * opens Home, Wallet and Orders together, and all three need the same
 * partner's book — one database read answers them. A failed load is not
 * kept. At `max` keys the oldest goes first (insertion order), so memory is
 * bounded however many partners call.
 */
export class TtlCache<V> {
  private readonly entries = new Map<
    string,
    { at: number; value: Promise<V> }
  >();

  constructor(
    private readonly ttlMs: number,
    private readonly max: number,
  ) {}

  get(key: string, load: () => Promise<V>): Promise<V> {
    const hit = this.entries.get(key);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.value;
    if (hit) this.entries.delete(key);

    const value = load();
    this.entries.set(key, { at: Date.now(), value });
    value.catch(() => {
      if (this.entries.get(key)?.value === value) this.entries.delete(key);
    });
    while (this.entries.size > this.max) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    return value;
  }

  /** The value if it is cached and fresh — never loads, never stores. */
  peek(key: string): Promise<V> | undefined {
    const hit = this.entries.get(key);
    return hit && Date.now() - hit.at < this.ttlMs ? hit.value : undefined;
  }

  /** Forget a key, so the next `get` loads it again. */
  delete(key: string): void {
    this.entries.delete(key);
  }

  get size(): number {
    return this.entries.size;
  }
}
