import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { serviceUnavailable } from '@common/errors/api-error';
import type { Env } from '@config/env.schema';

import type { CatalogVariant } from '../catalog.domain';
import {
  B2bCatalogClient,
  B2bUnauthorizedError,
} from '../providers/b2b-catalog.client';

/**
 * How old a catalogue may get, while the B2B API is failing, before carts stop
 * being priced from it. Prices change rarely; a quarter hour of an outage is
 * better served from memory than as a broken Shop.
 */
const MAX_STALE_MS = 15 * 60_000;

interface Snapshot {
  bySku: ReadonlyMap<string, CatalogVariant>;
  fetchedAt: number;
}

/**
 * The marketplace catalogue, held in memory per instance.
 *
 * Every cart call needs prices, and at millions of partners that cannot be one
 * B2B request per cart call — so the catalogue (a few hundred products) is
 * fetched once and shared:
 *
 * - **Fresh** (younger than the TTL): answered from memory.
 * - **Stale**: answered from memory at once, refreshed in the background —
 *   no partner waits on the refresh.
 * - **Missing, or too stale to trust**: the caller waits for a fetch.
 *
 * Concurrent misses share one in-flight fetch, so a cold instance under load
 * sends the B2B API one request, not one per waiting partner.
 *
 * B2B wants a signed-in agent's token, and there is no long-lived one: a
 * fetch borrows the token of the request that triggered it. Assumes the
 * marketplace prices every agent the same (true of MKTP-1 today) — if B2B
 * ever prices per agent, this cache must be keyed by agent.
 */
@Injectable()
export class CatalogService {
  private readonly logger = new Logger(CatalogService.name);
  private readonly ttlMs: number;
  private snapshot: Snapshot | null = null;
  private inFlight: Promise<Snapshot> | null = null;

  constructor(
    private readonly client: B2bCatalogClient,
    config: ConfigService<Env, true>,
  ) {
    this.ttlMs =
      config.get('CATALOG_CACHE_TTL_SECONDS', { infer: true }) * 1000;
  }

  /** The variants for these skus; a sku not in the marketplace is absent. */
  async variants(
    skus: Iterable<string>,
    token: string,
  ): Promise<Map<string, CatalogVariant>> {
    const { bySku } = await this.current(token);
    const found = new Map<string, CatalogVariant>();

    for (const sku of skus) {
      const variant = bySku.get(sku);
      if (variant) found.set(sku, variant);
    }

    return found;
  }

  /** One variant, or `null` when the sku is not sold in this marketplace. */
  async variant(sku: string, token: string): Promise<CatalogVariant | null> {
    const { bySku } = await this.current(token);
    return bySku.get(sku) ?? null;
  }

  private async current(token: string): Promise<Snapshot> {
    const snapshot = this.snapshot;
    const age = snapshot ? Date.now() - snapshot.fetchedAt : Infinity;

    if (snapshot && age < this.ttlMs) return snapshot;

    if (snapshot && age < MAX_STALE_MS) {
      // Background refresh; its failure is logged inside `refresh()`.
      this.refresh(token).catch(() => undefined);
      return snapshot;
    }

    try {
      return await this.refresh(token);
    } catch (error) {
      // The app renews its token on a 401 and retries; a 503 would not.
      if (error instanceof B2bUnauthorizedError) {
        throw new UnauthorizedException(
          'You have been signed out. Please log in again.',
        );
      }
      throw serviceUnavailable(
        'CATALOG_UNAVAILABLE',
        'Products could not be loaded right now. Please try again in a minute.',
      );
    }
  }

  private refresh(token: string): Promise<Snapshot> {
    this.inFlight ??= this.client
      .fetchAll(token)
      .then((variants) => {
        const snapshot: Snapshot = {
          bySku: new Map(variants.map((v) => [v.sku, v])),
          fetchedAt: Date.now(),
        };
        this.snapshot = snapshot;
        return snapshot;
      })
      .catch((error: unknown) => {
        this.logger.warn(
          `B2B catalogue refresh failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        throw error;
      })
      .finally(() => {
        this.inFlight = null;
      });

    return this.inFlight;
  }
}
