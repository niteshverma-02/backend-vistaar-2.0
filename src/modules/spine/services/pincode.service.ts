import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';

import { haversineKm } from '@common/utils/geo.util';

import {
  PincodeRepository,
  type PincodeInfo,
  type PincodeRow,
} from '../repositories/pincode.repository';

export type { PincodeInfo } from '../repositories/pincode.repository';

/** Pincodes do not move; a daily refresh picks up India Post additions. */
const REFRESH_MS = 24 * 60 * 60 * 1000;
/** After a failed load, wait this long before trying the whole book again. */
const RETRY_MS = 60 * 1000;
/**
 * A pincode's point further than this from its district's centre is wrong:
 * ~13% of the book's points are (2026-10-14 — e.g. Dewas 455001 sits near
 * Bhopal, 130 km off). Districts are rarely wider than this.
 */
export const MAX_FROM_DISTRICT_KM = 60;

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

/**
 * Each pincode's centre, trusted: its own point when it lies near its
 * district's median centre, else the district's centre — a farmer may then
 * be a district off, never 300 km off. Computed once per book load.
 */
export function withTrustedCentres(rows: PincodeRow[]): PincodeRow[] {
  const points = new Map<string, { lats: number[]; lngs: number[] }>();
  const keyOf = (r: PincodeRow) => `${r.state ?? ''}|${r.district ?? ''}`;
  for (const r of rows) {
    if (r.lat == null || r.lng == null || !r.district) continue;
    const p = points.get(keyOf(r)) ?? { lats: [], lngs: [] };
    p.lats.push(r.lat);
    p.lngs.push(r.lng);
    points.set(keyOf(r), p);
  }
  const centres = new Map(
    [...points].map(([key, p]) => [
      key,
      { lat: median(p.lats), lng: median(p.lngs) },
    ]),
  );
  return rows.map((r) => {
    const district = r.district ? centres.get(keyOf(r)) : undefined;
    const own =
      r.lat != null &&
      r.lng != null &&
      (!district ||
        haversineKm(r.lat, r.lng, district.lat, district.lng) <=
          MAX_FROM_DISTRICT_KM);
    if (own) return r;
    return district
      ? { ...r, lat: district.lat, lng: district.lng }
      : { ...r, lat: null, lng: null };
  });
}

/**
 * Pincode → state, district and centre, from ko-sales' India Post book
 * (`pincode_map_v2`). The whole book (~19,400 rows, ~2.4 MB) is held in
 * memory — one read a day per process instead of a collection scan per
 * lookup (the collection has no index on `pincode`). Warmed at boot; a stale
 * book keeps answering while the next one loads; if the book cannot load,
 * single lookups go to the database.
 */
@Injectable()
export class PincodeService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PincodeService.name);
  private book: Map<string, PincodeRow> | null = null;
  private loadedAt = 0;
  private failedAt = 0;
  private loading: Promise<void> | null = null;

  constructor(private readonly pincodes: PincodeRepository) {}

  onApplicationBootstrap(): void {
    void this.refresh();
  }

  async lookup(pincode: string): Promise<PincodeInfo | null> {
    if (!/^\d{6}$/.test(pincode)) return null;
    const book = await this.current();
    if (!book) return this.pincodes.find(pincode);
    const row = book.get(pincode);
    if (!row) return null;
    const { lat: _lat, lng: _lng, ...info } = row;
    return info;
  }

  /** The pincode area's centre, or `null` (unknown pincode, or no point). */
  async centre(
    pincode: string | null | undefined,
  ): Promise<{ lat: number; lng: number } | null> {
    if (!pincode || !/^\d{6}$/.test(pincode)) return null;
    const row = (await this.current())?.get(pincode);
    return row?.lat != null && row.lng != null
      ? { lat: row.lat, lng: row.lng }
      : null;
  }

  private async current(): Promise<Map<string, PincodeRow> | null> {
    if (this.book && Date.now() - this.loadedAt < REFRESH_MS) return this.book;
    if (this.book) {
      void this.refresh(); // stale-while-revalidate
      return this.book;
    }
    if (Date.now() - this.failedAt < RETRY_MS) return null;
    await this.refresh();
    return this.book;
  }

  private refresh(): Promise<void> {
    this.loading ??= this.load().finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  private async load(): Promise<void> {
    try {
      const rows = withTrustedCentres(await this.pincodes.all());
      this.book = new Map(rows.map((r) => [r.pincode, r]));
      this.loadedAt = Date.now();
    } catch (error) {
      this.failedAt = Date.now();
      this.logger.warn(
        `Pincode book not loaded: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
