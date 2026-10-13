import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '@config/env.schema';

import {
  variantsFromMarketplaceItem,
  type CatalogVariant,
} from '../catalog.domain';

const PATH = '/marketplace-products/v2';

/**
 * 100, not more: above it the B2B API still answers but leaves `avl_qty` off
 * every pack, and a pack with no stock figure cannot be added to a cart.
 * (Checked against MKTP-1, 2026-10-08: limit 100 → stock, limit 200 → none.)
 */
const PAGE_SIZE = 100;

/**
 * Past this one page attempt is given up. A full 100-pack page with stock has
 * been seen to take over 10 s from B2B on a cold start, so 10 s alone turned a
 * slow answer into a 503 on the partner's cart.
 */
const REQUEST_TIMEOUT_MS = 15_000;

/** A page that timed out or hit a 5xx is asked once more before the fetch fails. */
const PAGE_ATTEMPTS = 2;
const RETRY_DELAY_MS = 300;

/** B2B refused the agent's token — expired or signed out. */
export class B2bUnauthorizedError extends Error {}

/** A failure another try may not repeat: timeout, dropped connection, 5xx. */
class B2bTransientError extends Error {}

const isTransient = (error: unknown): boolean =>
  error instanceof B2bTransientError ||
  // fetch: TimeoutError / AbortError from the signal, TypeError on a network failure.
  (error instanceof Error &&
    (error.name === 'TimeoutError' ||
      error.name === 'AbortError' ||
      error.name === 'TypeError'));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Reads the marketplace catalogue from the B2B Sales API — the same endpoint
 * and marketplace the app's Shop lists, so a price the partner sees is the
 * price the cart charges.
 */
@Injectable()
export class B2bCatalogClient {
  private readonly baseUrl: string;
  private readonly marketplaceCode: string;

  constructor(config: ConfigService<Env, true>) {
    this.baseUrl = config
      .get('B2B_API_URL', { infer: true })
      .replace(/\/+$/, '');
    this.marketplaceCode = config.get('B2B_MARKETPLACE_CODE', { infer: true });
  }

  /**
   * Every priced pack in the marketplace, read with the calling agent's
   * token. Throws on any failed page.
   */
  async fetchAll(token: string): Promise<CatalogVariant[]> {
    const first = await this.pageWithRetry(1, token);

    // Remaining pages in parallel: a partial catalogue would price some
    // lines and 404 the rest, so it is all pages or an error.
    const rest = await Promise.all(
      Array.from({ length: Math.max(0, first.totalPages - 1) }, (_, i) =>
        this.pageWithRetry(i + 2, token),
      ),
    );

    return [first, ...rest].flatMap((p) => p.variants);
  }

  /** One page, tried again once when B2B was slow or briefly down. */
  private async pageWithRetry(
    page: number,
    token: string,
  ): Promise<{ variants: CatalogVariant[]; totalPages: number }> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.page(page, token);
      } catch (error) {
        if (attempt >= PAGE_ATTEMPTS || !isTransient(error)) throw error;
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  private async page(
    page: number,
    token: string,
  ): Promise<{ variants: CatalogVariant[]; totalPages: number }> {
    const url = new URL(`${this.baseUrl}${PATH}`);
    url.searchParams.set('marketplace_code', this.marketplaceCode);
    url.searchParams.set('page', String(page));
    url.searchParams.set('limit', String(PAGE_SIZE));

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (response.status === 401) {
      throw new B2bUnauthorizedError('B2B refused the agent token');
    }

    if (!response.ok) {
      const message = `B2B catalogue page ${page} answered ${response.status}`;
      throw response.status >= 500
        ? new B2bTransientError(message)
        : new Error(message);
    }

    const body = (await response.json()) as {
      success?: unknown;
      data?: unknown;
      total_pages?: unknown;
    };

    if (body.success !== true || !Array.isArray(body.data)) {
      throw new Error(`B2B catalogue page ${page} was not a success payload`);
    }

    return {
      variants: body.data.flatMap(variantsFromMarketplaceItem),
      totalPages: Math.max(1, Math.trunc(Number(body.total_pages)) || 1),
    };
  }
}
