import { haversineKm } from '@common/utils/geo.util';
import { istDate, istMonthKey } from '@common/utils/ist-day.util';
import { normalizeMobile } from '@common/utils/phone.util';
import { isCounted, sizeLabel, stageOf } from '@modules/orders/orders.domain';

/**
 * KKD & App activity (PRD C8 / AD16): what the farmers a partner holds do on
 * their own — at a Katyayani Krishi Kendra store and on the Katyayani app or
 * website — so the partner knows whom to call or visit. Read-only, from the
 * other apps' records; commission is never paid on it (follow-up only, TL).
 */

/** The app's `KkdActivityType` wire values. */
export const KKD_ACTIVITY_TYPES = [
  'walk_in',
  'store_order',
  'advisory',
  'app_open',
  'app_cart',
  'app_order',
] as const;
export type KkdActivityType = (typeof KKD_ACTIVITY_TYPES)[number];

export const KKD_CHANNELS = ['store', 'app'] as const;
export type KkdChannel = (typeof KKD_CHANNELS)[number];

/** Farmers' own app / website orders (the TL's scope: MKTP-2, 3 and 4 only). */
export const APP_MARKETPLACES: Readonly<Record<string, string>> = {
  'MKTP-2': 'Katyayani website',
  'MKTP-3': 'Katyayani app',
};
/** Franchise / KKD store orders in StockShip. */
export const STORE_MARKETPLACE = 'MKTP-4';
/** MKTP-4 also files company orders under a store's warehouse; they are not store sales. */
export const COMPANY_SUB_SOURCE = 'founder_office';
/** How far from the partner's registration point a store is shown (TL). */
export const STORE_RADIUS_KM = 50;
/** The KKD app's events in `kkd_events` that become activity. */
export const APP_OPEN_EVENT = 'APP_LAUNCH';
export const APP_CART_EVENT = 'Cart Abandoned';
/** A walk-in HO turned down was a wrong entry, not a visit. */
const REJECTED_WALKIN = 'rejected';
const STORE_FALLBACK = 'Katyayani Krishi Kendra';

export interface KkdActivity {
  /** Stable per record: `order:<order_id>`, `walk_in:<id>`, `advisory:<id>`, `app_cart:<id>`, `app_open:<pii_id>:<IST day>`. */
  id: string;
  type: KkdActivityType;
  channel: KkdChannel;
  customer_id: string;
  customer_name: string;
  store_id: string | null;
  /** The store's name for a store row; the app / website for an app order; `null` otherwise. */
  store: string | null;
  date: Date;
  /** ₹, whole; orders and carts only. */
  amount: number | null;
  /** `Name 250 ML ×2` per line. */
  items: string[];
  note: string | null;
  order_id: string | null;
}

/** A farmer the partner holds and the start of the hold — activity before it is not theirs to see. */
export interface FarmerRef {
  pii_id: string;
  name: string;
  phone: string;
  since: Date;
}

export interface FarmerIndex {
  byPii: ReadonlyMap<string, FarmerRef>;
  byPhone: ReadonlyMap<string, FarmerRef>;
}

export interface StoreInfo {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  phone: string | null;
  /** Only stores with a map point are placed in the 50 km list. */
  lat: number | null;
  lng: number | null;
}

export interface StoreBook {
  stores: ReadonlyMap<string, StoreInfo>;
  /** `warehouses._id` (as a string) → store id. */
  byWarehouse: ReadonlyMap<string, string>;
  /** The store's own email or a POS login, lower case → store id. */
  byLogin: ReadonlyMap<string, string>;
}

/** A catalogue line: name and pack size by `sku`. */
export interface ProductLabel {
  name: string | null;
  variant: { value?: string | number; uom?: string } | null;
  item_qty: string | number | null;
}

export interface FarmerOrderRow {
  order_id: string;
  date?: Date | null;
  created_at?: Date | null;
  pii_id?: string | null;
  marketplace?: string | null;
  sub_source?: string | null;
  created_by?: string | null;
  warehouse_id?: string | null;
  order_status?: string | null;
  total_amount?: number | null;
  items: { sku?: string; qty?: number }[];
}

export interface PosOrderRow {
  order_id: string;
  franchise_id?: string | null;
  order_date?: Date | null;
  pii_id?: string | null;
  phone?: string | null;
  amount?: number | null;
  in_stockship?: boolean | null;
  items: { product?: string; sku?: string; quantity?: number }[];
}

export interface WalkinRow {
  _id: string;
  franchise_id?: string | null;
  walked_in_at?: Date | null;
  pii_id?: string | null;
  phone?: string | null;
  status?: string | null;
  notes?: string | null;
  crop?: string | null;
}

export interface PrescriptionRow {
  _id: string;
  rx_id?: string | null;
  franchise_id?: string | null;
  rx_date?: Date | null;
  pii_id?: string | null;
  phone?: string | null;
  crop?: string | null;
  problem?: string | null;
  solution?: string | null;
  products?: { name?: string; sku?: string }[] | null;
}

export interface KkdEventRow {
  _id: string;
  user_id?: string | null;
  event_name?: string | null;
  created_at?: Date | null;
  total_price?: number | null;
  items?: { name?: string; quantity?: number }[] | null;
}

export interface ActivitySources {
  orders: FarmerOrderRow[];
  posOrders: PosOrderRow[];
  walkins: WalkinRow[];
  prescriptions: PrescriptionRow[];
  events: KkdEventRow[];
}

/** `franchises` (StockShip): the stores with a map point and a warehouse. */
export interface FranchiseRow {
  franchiseId: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | number | null;
  contact?: string | number | null;
  email?: string | null;
  /** GeoJSON `[lng, lat]`. */
  coordinates?: number[] | null;
  warehouse_id?: string | null;
}

/** `franchise_v2_franchises` (franchise HO portal): newer stores, no map point yet. */
export interface FranchiseV2Row {
  franchise_id: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface StoreDirectoryRows {
  franchises: FranchiseRow[];
  v2: FranchiseV2Row[];
  /** StockShip `employees` that are a store's POS logins. */
  logins: { email: string; franchiseId: string }[];
}

const text = (v: string | number | null | undefined): string | null => {
  const s = v == null ? '' : String(v).trim();
  return s || null;
};

/** The Nearby radar's name for a store, so both screens agree (warehouse names are internal). */
const cityName = (city: string | null | undefined) =>
  city?.trim() ? `${STORE_FALLBACK} · ${city.trim()}` : STORE_FALLBACK;

export function storeBookOf(rows: StoreDirectoryRows): StoreBook {
  const stores = new Map<string, StoreInfo>();
  const byWarehouse = new Map<string, string>();
  const byLogin = new Map<string, string>();
  for (const v of rows.v2) {
    stores.set(v.franchise_id, {
      id: v.franchise_id,
      name: cityName(v.city),
      address: text(v.address),
      city: text(v.city),
      state: text(v.state),
      pincode: text(v.pincode),
      phone: text(v.phone),
      lat: null,
      lng: null,
    });
    if (v.email) byLogin.set(v.email.trim().toLowerCase(), v.franchise_id);
  }
  // StockShip's row wins: it is the one with the map point and the warehouse.
  for (const f of rows.franchises) {
    const [lng, lat] = f.coordinates ?? [];
    const placed = Number.isFinite(lat) && Number.isFinite(lng);
    stores.set(f.franchiseId, {
      id: f.franchiseId,
      name: cityName(f.city),
      address: text(f.address),
      city: text(f.city),
      state: text(f.state),
      pincode: text(f.pincode),
      phone: text(f.contact),
      lat: placed ? lat : null,
      lng: placed ? lng : null,
    });
    if (f.warehouse_id) byWarehouse.set(f.warehouse_id, f.franchiseId);
    if (f.email) byLogin.set(f.email.trim().toLowerCase(), f.franchiseId);
  }
  for (const l of rows.logins) {
    byLogin.set(l.email.trim().toLowerCase(), l.franchiseId);
  }
  return { stores, byWarehouse, byLogin };
}

export function indexFarmers(farmers: readonly FarmerRef[]): FarmerIndex {
  const byPii = new Map<string, FarmerRef>();
  const byPhone = new Map<string, FarmerRef>();
  for (const f of farmers) {
    byPii.set(f.pii_id, f);
    const phone = normalizeMobile(f.phone);
    if (phone) byPhone.set(phone, f);
  }
  return { byPii, byPhone };
}

/** The partner's farmer a record is about: its `pii_id` first, else its mobile (TL: phone match allowed). */
export function ownerOf(
  index: FarmerIndex,
  piiId: string | null | undefined,
  phone: string | null | undefined,
): FarmerRef | null {
  const byPii = piiId ? index.byPii.get(piiId) : undefined;
  if (byPii) return byPii;
  const mobile = phone ? normalizeMobile(phone) : null;
  return (mobile && index.byPhone.get(mobile)) || null;
}

/**
 * The store an MKTP-4 order was sold at — StockShip keeps no franchise id on
 * it, so the franchise backend's rule is reused: the POS login that made it,
 * else the store's warehouse. Company orders filed on a store are left out.
 */
export function storeOfOrder(
  row: FarmerOrderRow,
  book: StoreBook,
): string | null {
  if (row.sub_source === COMPANY_SUB_SOURCE) return null;
  const login = row.created_by?.trim().toLowerCase();
  if (login) {
    const byLogin = book.byLogin.get(login);
    if (byLogin) return byLogin;
  }
  return row.warehouse_id
    ? (book.byWarehouse.get(row.warehouse_id) ?? null)
    : null;
}

/** A real sale: not a failed / split / merged row, not cancelled or returned. */
export function isSale(status: string | null | undefined): boolean {
  if (!isCounted(status)) return false;
  const stage = stageOf(status);
  return stage !== 'cancelled' && stage !== 'returned';
}

export function lineLabel(name: string, qty: number | undefined): string {
  return qty && qty > 1 ? `${name} ×${qty}` : name;
}

function catalogueLine(
  sku: string | undefined,
  qty: number | undefined,
  products: ReadonlyMap<string, ProductLabel>,
): string | null {
  if (!sku) return null;
  const fact = products.get(sku);
  const size = fact ? sizeLabel(fact.variant, fact.item_qty) : '';
  const name = [fact?.name ?? sku, size].filter(Boolean).join(' ');
  return lineLabel(name, qty);
}

const rupees = (n: number | null | undefined): number | null =>
  typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : null;

const storeName = (book: StoreBook, id: string | null | undefined) =>
  (id && book.stores.get(id)?.name) || (id ? STORE_FALLBACK : null);

const after = (date: Date | null | undefined, farmer: FarmerRef) =>
  !!date && date.getTime() >= farmer.since.getTime();

/**
 * Every source as one list, newest first. A row counts only when it is about
 * a farmer the partner holds and happened after the hold began; a store order
 * that is both in StockShip and in the old POS archive is shown once.
 */
export function activitiesOf(
  sources: ActivitySources,
  index: FarmerIndex,
  book: StoreBook,
  products: ReadonlyMap<string, ProductLabel>,
): KkdActivity[] {
  const out = new Map<string, KkdActivity>();
  const base = (farmer: FarmerRef) => ({
    customer_id: farmer.pii_id,
    customer_name: farmer.name,
  });

  for (const o of sources.orders) {
    const farmer = ownerOf(index, o.pii_id, null);
    const date = o.date ?? o.created_at ?? null;
    if (!farmer || !after(date, farmer) || !isSale(o.order_status)) continue;
    const items = o.items
      .map((i) => catalogueLine(i.sku, i.qty, products))
      .filter((l): l is string => !!l);
    const app = o.marketplace ? APP_MARKETPLACES[o.marketplace] : undefined;
    if (app) {
      out.set(`order:${o.order_id}`, {
        id: `order:${o.order_id}`,
        type: 'app_order',
        channel: 'app',
        ...base(farmer),
        store_id: null,
        store: app,
        date: date as Date,
        amount: rupees(o.total_amount),
        items,
        note: null,
        order_id: o.order_id,
      });
      continue;
    }
    if (o.marketplace !== STORE_MARKETPLACE) continue;
    const storeId = storeOfOrder(o, book);
    if (!storeId) continue;
    out.set(`order:${o.order_id}`, {
      id: `order:${o.order_id}`,
      type: 'store_order',
      channel: 'store',
      ...base(farmer),
      store_id: storeId,
      store: storeName(book, storeId),
      date: date as Date,
      amount: rupees(o.total_amount),
      items,
      note: null,
      order_id: o.order_id,
    });
  }

  for (const p of sources.posOrders) {
    // Pushed to StockShip already — that copy (above) is the one shown.
    if (p.in_stockship || out.has(`order:${p.order_id}`)) continue;
    const farmer = ownerOf(index, p.pii_id, p.phone);
    if (!farmer || !after(p.order_date, farmer)) continue;
    out.set(`order:${p.order_id}`, {
      id: `order:${p.order_id}`,
      type: 'store_order',
      channel: 'store',
      ...base(farmer),
      store_id: p.franchise_id ?? null,
      store: storeName(book, p.franchise_id),
      date: p.order_date as Date,
      amount: rupees(p.amount),
      items: p.items
        .filter((i) => i.product || i.sku)
        .map((i) => lineLabel(i.product || (i.sku as string), i.quantity)),
      note: null,
      order_id: p.order_id,
    });
  }

  for (const w of sources.walkins) {
    if (w.status === REJECTED_WALKIN) continue;
    const farmer = ownerOf(index, w.pii_id, w.phone);
    if (!farmer || !after(w.walked_in_at, farmer)) continue;
    out.set(`walk_in:${w._id}`, {
      id: `walk_in:${w._id}`,
      type: 'walk_in',
      channel: 'store',
      ...base(farmer),
      store_id: w.franchise_id ?? null,
      store: storeName(book, w.franchise_id),
      date: w.walked_in_at as Date,
      amount: null,
      items: [],
      note: w.notes?.trim() || null,
      order_id: null,
    });
  }

  for (const r of sources.prescriptions) {
    const farmer = ownerOf(index, r.pii_id, r.phone);
    if (!farmer || !after(r.rx_date, farmer)) continue;
    const id = `advisory:${r.rx_id ?? r._id}`;
    out.set(id, {
      id,
      type: 'advisory',
      channel: 'store',
      ...base(farmer),
      store_id: r.franchise_id ?? null,
      store: storeName(book, r.franchise_id),
      date: r.rx_date as Date,
      amount: null,
      items: (r.products ?? [])
        .map((p) => p.name?.trim())
        .filter((n): n is string => !!n),
      note:
        [r.crop, r.problem, r.solution]
          .map((s) => s?.trim())
          .filter(Boolean)
          .join(' — ') || null,
      order_id: null,
    });
  }

  for (const e of sources.events) {
    const farmer = ownerOf(index, null, e.user_id);
    if (!farmer || !after(e.created_at, farmer)) continue;
    const at = e.created_at as Date;
    if (e.event_name === APP_OPEN_EVENT) {
      // One app open per farmer per IST day — the app launches many times a day.
      const id = `app_open:${farmer.pii_id}:${istDate(at)}`;
      const seen = out.get(id);
      if (seen && seen.date >= at) continue;
      out.set(id, {
        id,
        type: 'app_open',
        channel: 'app',
        ...base(farmer),
        store_id: null,
        store: APP_MARKETPLACES['MKTP-3'],
        date: at,
        amount: null,
        items: [],
        note: null,
        order_id: null,
      });
    } else if (e.event_name === APP_CART_EVENT) {
      out.set(`app_cart:${e._id}`, {
        id: `app_cart:${e._id}`,
        type: 'app_cart',
        channel: 'app',
        ...base(farmer),
        store_id: null,
        store: APP_MARKETPLACES['MKTP-3'],
        date: at,
        amount: rupees(e.total_price),
        items: (e.items ?? [])
          .filter((i) => i.name)
          .map((i) => lineLabel(i.name as string, i.quantity)),
        note: null,
        order_id: null,
      });
    }
  }

  return [...out.values()].sort(
    (a, b) => b.date.getTime() - a.date.getTime() || a.id.localeCompare(b.id),
  );
}

export interface FeedFilter {
  customer?: string;
  channel?: KkdChannel;
  from?: Date | null;
  to?: Date | null;
}

export function filterActivities(
  items: readonly KkdActivity[],
  f: FeedFilter,
): KkdActivity[] {
  return items.filter(
    (a) =>
      (!f.customer || a.customer_id === f.customer) &&
      (!f.channel || a.channel === f.channel) &&
      (!f.from || a.date >= f.from) &&
      (!f.to || a.date < f.to),
  );
}

export interface MoneyTile {
  count: number;
  amount: number;
}

export interface KkdSummary {
  month: string;
  walk_ins: number;
  store_orders: MoneyTile;
  app_orders: MoneyTile;
  /** App carts not followed by an app order from that farmer — any month. */
  open_app_carts: MoneyTile;
}

const add = (t: MoneyTile, amount: number | null): MoneyTile => ({
  count: t.count + 1,
  amount: t.amount + (amount ?? 0),
});

/** The screen's four tiles for IST month `month` (`YYYY-MM`). */
export function summaryOf(
  items: readonly KkdActivity[],
  month: string,
): KkdSummary {
  const zero = (): MoneyTile => ({ count: 0, amount: 0 });
  const s: KkdSummary = {
    month,
    walk_ins: 0,
    store_orders: zero(),
    app_orders: zero(),
    open_app_carts: zero(),
  };
  const lastAppOrder = new Map<string, number>();
  for (const a of items) {
    if (a.type !== 'app_order') continue;
    const at = a.date.getTime();
    if (at > (lastAppOrder.get(a.customer_id) ?? 0)) {
      lastAppOrder.set(a.customer_id, at);
    }
  }
  for (const a of items) {
    const inMonth = istMonthKey(a.date) === month;
    if (a.type === 'walk_in' && inMonth) s.walk_ins += 1;
    else if (a.type === 'store_order' && inMonth) {
      s.store_orders = add(s.store_orders, a.amount);
    } else if (a.type === 'app_order' && inMonth) {
      s.app_orders = add(s.app_orders, a.amount);
    } else if (
      a.type === 'app_cart' &&
      (lastAppOrder.get(a.customer_id) ?? 0) <= a.date.getTime()
    ) {
      s.open_app_carts = add(s.open_app_carts, a.amount);
    }
  }
  return s;
}

export interface NearbyStore extends Omit<StoreInfo, 'lat' | 'lng'> {
  lat: number;
  lng: number;
  distance_km: number;
}

/** Stores with a map point within `km` of `centre`, nearest first. */
export function storesWithin(
  centre: { lat: number; lng: number },
  stores: Iterable<StoreInfo>,
  km: number,
): NearbyStore[] {
  const out: NearbyStore[] = [];
  for (const s of stores) {
    if (s.lat == null || s.lng == null) continue;
    const d = haversineKm(centre.lat, centre.lng, s.lat, s.lng);
    if (d <= km) {
      out.push({
        ...s,
        lat: s.lat,
        lng: s.lng,
        distance_km: Math.round(d * 10) / 10,
      });
    }
  }
  return out.sort((a, b) => a.distance_km - b.distance_km);
}
