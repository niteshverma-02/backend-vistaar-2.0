import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';

import {
  ProductFactsRepository,
  type ProductFact,
} from '../repositories/product-facts.repository';

export type { ProductFact } from '../repositories/product-facts.repository';

/** Prices and GST change a few times a year; a new pack shows within the hour. */
const REFRESH_MS = 60 * 60 * 1000;
const RETRY_MS = 60 * 1000;

/**
 * The catalogue's facts per sku — GST rate, category, name, picture, pack
 * size — held in memory (~2 MB): commission needs the GST of every line of
 * every order and the order screens a name for every line, and a lookup per
 * request would be thousands of reads a minute at scale. Warmed at boot; a stale copy answers while the next one loads.
 * When it cannot load at all, `facts()` is empty and callers fall back.
 */
@Injectable()
export class ProductFactsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ProductFactsService.name);
  private book: Map<string, ProductFact> | null = null;
  private loadedAt = 0;
  private failedAt = 0;
  private loading: Promise<void> | null = null;

  constructor(private readonly products: ProductFactsRepository) {}

  onApplicationBootstrap(): void {
    void this.refresh();
  }

  async facts(): Promise<ReadonlyMap<string, ProductFact>> {
    if (this.book && Date.now() - this.loadedAt < REFRESH_MS) return this.book;
    if (this.book) {
      void this.refresh(); // stale-while-revalidate
      return this.book;
    }
    if (Date.now() - this.failedAt >= RETRY_MS) await this.refresh();
    return this.book ?? new Map();
  }

  private refresh(): Promise<void> {
    this.loading ??= this.load().finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  private async load(): Promise<void> {
    try {
      this.book = await this.products.all();
      this.loadedAt = Date.now();
    } catch (error) {
      this.failedAt = Date.now();
      this.logger.warn(
        `Product facts not loaded: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
