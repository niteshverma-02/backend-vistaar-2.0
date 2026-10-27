import { haversineKm } from '@common/utils/geo.util';

/**
 * The radar's rules that need no database (PRD C9, remade 2026-10-27): which
 * franchise is a store on the map, and how farmers outside the partner's
 * book are filed by pincode. Those farmers carry no GPS of their own — only a
 * pincode — so they are counted per pincode, never drawn as dots.
 */

/** What the radar can show; `?layers=` picks some, all by default. */
export const RADAR_LAYERS = [
  'mine',
  'kkd_leads',
  'org_customers',
  'stores',
] as const;
export type RadarLayer = (typeof RADAR_LAYERS)[number];

/** The layers filed by pincode (no GPS on the record). */
export const POOL_LAYERS = ['kkd_leads', 'org_customers'] as const;
export type PoolLayer = (typeof POOL_LAYERS)[number];

/** The org's own farmer channels a partner may pick up: the KKD app and website. */
export const KKD_SOURCES = ['kkd_app', 'kkd_web'] as const;

export const isPincode = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{6}$/.test(v);

/**
 * A farmer the partner does not hold is shown with the mobile hidden:
 * `98******12`. The number itself reaches the partner only once the farmer
 * gives the OTP on "Add as lead". `null` when there is no usable number.
 */
export function maskPhone(phone: string | null | undefined): string | null {
  const digits = String(phone ?? '')
    .replace(/\D/g, '')
    .slice(-10);
  if (digits.length < 10) return null;
  return `${digits.slice(0, 2)}******${digits.slice(-2)}`;
}

// ── Stores ─────────────────────────────────────────────────────────────

/** One franchise from the offline franchise master, before the radar's rule. */
export interface StoreCandidate {
  id: string;
  /** The franchise master's status: `active` · `inactive` · `setup_pending`. */
  status: string;
  city: string | null;
  state: string | null;
  address: string | null;
  pincode: string | null;
  phone: string | null;
  /** HO's pin for the store, else StockShip's GPS; `null` = neither. */
  point: { lat: number; lng: number } | null;
  created_at: Date | null;
}

export interface StoreSpot {
  id: string;
  city: string | null;
  state: string | null;
  address: string | null;
  pincode: string | null;
  phone: string | null;
  lat: number;
  lng: number;
  /** `false` = placed at its pincode's centre (no pin, no GPS). */
  exact: boolean;
}

/**
 * Two records closer than this are one shop recorded twice — StockShip's
 * test franchise FR-101 copies FR-100's address and GPS exactly.
 */
export const SAME_SPOT_M = 50;

/**
 * StockShip's franchise status, as the franchise master reads it: the
 * warehouse decides whether a franchise trades (none yet = being set up).
 */
export function stockshipStatus(
  warehouse: { isActive?: boolean | null } | null | undefined,
): string {
  if (!warehouse) return 'setup_pending';
  return warehouse.isActive === false ? 'inactive' : 'active';
}

/**
 * The stores on the map: active franchises only; each at HO's pin, else
 * StockShip's GPS, else its pincode's centre (`exact: false`); and where two
 * records sit on one spot, only the older one — the original store, not a
 * later copy. No franchise id is named anywhere: new stores appear the day
 * the franchise master calls them active.
 */
export function storesOnMap(
  candidates: readonly StoreCandidate[],
  pincodeCentre: (
    pincode: string | null,
  ) => { lat: number; lng: number } | null,
): StoreSpot[] {
  const oldestFirst = candidates
    .filter((c) => c.status === 'active')
    .sort(
      (a, b) =>
        (a.created_at?.getTime() ?? Number.MAX_SAFE_INTEGER) -
          (b.created_at?.getTime() ?? Number.MAX_SAFE_INTEGER) ||
        a.id.localeCompare(b.id, 'en', { numeric: true }),
    );
  const kept: StoreSpot[] = [];
  for (const c of oldestFirst) {
    const centre = c.point ? null : pincodeCentre(c.pincode);
    const place = c.point ?? centre;
    if (!place) continue;
    const taken = kept.some(
      (k) =>
        haversineKm(k.lat, k.lng, place.lat, place.lng) * 1000 < SAME_SPOT_M,
    );
    if (taken) continue;
    kept.push({
      id: c.id,
      city: c.city,
      state: c.state,
      address: c.address,
      pincode: c.pincode,
      phone: c.phone,
      lat: place.lat,
      lng: place.lng,
      exact: c.point !== null,
    });
  }
  return kept;
}

// ── Pincode pools ──────────────────────────────────────────────────────

/** One pincode's people as the database files them: each person once, newest first. */
export interface PinPeople {
  pin: string;
  ids: string[];
}

/**
 * The people filed under one pincode, newest first, as one comma-joined
 * string — ~6 MB for every KKD lead and org customer in India, where an array
 * of strings would take several times that in every server process.
 */
export interface Filed {
  n: number;
  ids: string;
}

/** Pincode → the people filed there, per layer. */
export type PoolBook = Record<PoolLayer, Map<string, Filed>>;

/** One page of a pincode's people. */
export function pageOf(
  filed: Filed | undefined,
  skip: number,
  limit: number,
): string[] {
  if (!filed || !filed.ids) return [];
  return filed.ids.split(',').slice(skip, skip + limit);
}

/**
 * Builds the pools from the database's rows, one per pincode. `finish`
 * leaves out every farmer a partner holds (any row in the partner book — a
 * lapsed hold stays the partner's until someone takes over), and shows a KKD
 * lead who has become an org customer as the customer only.
 */
export class PoolBuilder {
  private readonly rows: Record<PoolLayer, PinPeople[]> = {
    kkd_leads: [],
    org_customers: [],
  };

  add(layer: PoolLayer, row: PinPeople): void {
    if (isPincode(row.pin) && row.ids.length) this.rows[layer].push(row);
  }

  finish(held: ReadonlySet<string>): PoolBook {
    const customers = new Set<string>();
    for (const row of this.rows.org_customers) {
      for (const id of row.ids) customers.add(id);
    }
    return {
      org_customers: file(this.rows.org_customers, (id) => held.has(id)),
      kkd_leads: file(
        this.rows.kkd_leads,
        (id) => held.has(id) || customers.has(id),
      ),
    };
  }
}

function file(
  rows: readonly PinPeople[],
  skip: (id: string) => boolean,
): Map<string, Filed> {
  const filed = new Map<string, Filed>();
  for (const row of rows) {
    // An id with a comma would split into two on a page read.
    const ids = row.ids.filter((id) => id && !id.includes(',') && !skip(id));
    if (ids.length) filed.set(row.pin, { n: ids.length, ids: ids.join(',') });
  }
  return filed;
}
