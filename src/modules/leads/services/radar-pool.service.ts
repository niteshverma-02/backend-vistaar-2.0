import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '@config/env.schema';

import {
  pageOf,
  PoolBuilder,
  type PoolBook,
  type PoolLayer,
} from '../radar.domain';
import { RadarPoolRepository } from '../repositories/radar-pool.repository';
import { VistaarLeadsRepository } from '../repositories/vistaar-leads.repository';

/** KKD leads and org customers change by the day; an hour-old count is fine on a map. */
const REBUILD_MS = 60 * 60 * 1000;
/** After a failed build, wait this long before reading the database again. */
const RETRY_MS = 5 * 60 * 1000;
/** Workers of one box start together; spread their first build over this. */
const WARM_SPREAD_MS = 60 * 1000;

export interface PoolCounts {
  kkd_leads: number;
  org_customers: number;
}

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * The radar's pincode pools: who is filed under each pincode — KKD leads
 * nobody holds, and org customers — held in memory (~6 MB) and rebuilt once an
 * hour, so a radar request never counts the org's collections (no pincode
 * index there; a live count over a 15 km ring took 0.9–2.6 s on main). Each
 * process builds its own copy: no table is written. A stale copy keeps
 * answering while the next one builds.
 */
@Injectable()
export class RadarPoolService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(RadarPoolService.name);
  private readonly enabled: boolean;
  private book: PoolBook | null = null;
  private builtAt: Date | null = null;
  private failedAt = 0;
  private building: Promise<void> | null = null;
  private warmTimer: NodeJS.Timeout | null = null;
  private hourlyTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly pools: RadarPoolRepository,
    private readonly leads: VistaarLeadsRepository,
    config: ConfigService<Env, true>,
  ) {
    this.enabled = config.get('RADAR_POOLS_ENABLED', { infer: true });
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) return;
    this.warmTimer = setTimeout(
      () => void this.refresh(),
      Math.random() * WARM_SPREAD_MS,
    );
    // Covers a process that gets no radar traffic; `fresh()` covers one that
    // slept through its timer.
    this.hourlyTimer = setInterval(() => void this.refresh(), REBUILD_MS);
    // Never what keeps the process alive.
    this.warmTimer.unref();
    this.hourlyTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.warmTimer) clearTimeout(this.warmTimer);
    if (this.hourlyTimer) clearInterval(this.hourlyTimer);
    this.warmTimer = this.hourlyTimer = null;
  }

  /** What the pools hold for these pincodes. Never waits for a build. */
  countsFor(pins: readonly string[]): {
    ready: boolean;
    built_at: Date | null;
    counts: Map<string, PoolCounts>;
  } {
    const book = this.fresh();
    const counts = new Map<string, PoolCounts>();
    if (book) {
      for (const pin of pins) {
        const kkd = book.kkd_leads.get(pin)?.n ?? 0;
        const customers = book.org_customers.get(pin)?.n ?? 0;
        if (kkd || customers) {
          counts.set(pin, { kkd_leads: kkd, org_customers: customers });
        }
      }
    }
    return { ready: book !== null, built_at: this.builtAt, counts };
  }

  /** One page of a pincode's people, newest first; waits for the first build. */
  async page(
    layer: PoolLayer,
    pin: string,
    skip: number,
    limit: number,
  ): Promise<{ ids: string[]; total: number }> {
    if (!this.enabled) return { ids: [], total: 0 };
    if (!this.book && Date.now() - this.failedAt > RETRY_MS) {
      await this.refresh();
    }
    const filed = this.fresh()?.[layer].get(pin);
    return { ids: pageOf(filed, skip, limit), total: filed?.n ?? 0 };
  }

  private fresh(): PoolBook | null {
    if (!this.enabled) return null;
    const stale =
      !this.builtAt || Date.now() - this.builtAt.getTime() > REBUILD_MS;
    if (stale && Date.now() - this.failedAt > RETRY_MS) void this.refresh();
    return this.book;
  }

  private refresh(): Promise<void> {
    this.building ??= this.build().finally(() => {
      this.building = null;
    });
    return this.building;
  }

  /** One collection at a time; the database groups, so ~32k rows cross the wire. */
  private async build(): Promise<void> {
    const started = Date.now();
    try {
      const builder = new PoolBuilder();
      for await (const row of this.pools.customersByPincode()) {
        builder.add('org_customers', row);
      }
      for await (const row of this.pools.kkdByPincode()) {
        builder.add('kkd_leads', row);
      }
      const book = builder.finish(await this.leads.heldPiis());
      this.book = book;
      this.builtAt = new Date();
      this.logger.log(
        `Radar pools built in ${Date.now() - started} ms: KKD leads in ${book.kkd_leads.size} pincodes, org customers in ${book.org_customers.size}`,
      );
    } catch (error) {
      this.failedAt = Date.now();
      this.logger.warn(`Radar pools not built: ${message(error)}`);
    }
  }
}
