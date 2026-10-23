import { DAY_MS, istDayStart } from '@common/utils/ist-day.util';
import { money, type CatalogVariant } from '@modules/catalog/catalog.domain';

/**
 * Cart rules, ported from the app's `Cart` entity (React AppContext) so the
 * server agrees with what the partner saw on the phone: quantities are capped
 * at the stock on hand, never rejected for exceeding it.
 */

/** Keeps one cart document far below Mongo's 16 MB, whatever a client sends. */
export const MAX_LINES = 100;
export const MAX_QUANTITY = 9_999;

/** A stored line — `CartLine` in the schema, B2B's shape. */
export interface CartLineData {
  product_id: string;
  sku: string;
  product_name: string;
  product_image?: string;
  price: number;
  quantity: number;
  total: number;
  gst: number;
  moq: number;
  packaging_size: string;
  packaging_type: string;
  uom: string;
  requested_weight: number;
  item_type: string;
  packaging_sku: string | null;
  is_custom_packaging: boolean;
}

export type CartChangeFailure =
  'OUT_OF_STOCK' | 'CART_LIMIT_REACHED' | 'NOT_IN_CART';

export type CartChange =
  | { ok: true; lines: CartLineData[] }
  | { ok: false; reason: CartChangeFailure };

/**
 * A line priced from the catalogue as it is now, filled the way B2B fills its
 * own carts' lines (no custom packaging, `item_type: 'bulk'`).
 */
export function lineFrom(
  variant: CatalogVariant,
  quantity: number,
): CartLineData {
  return {
    product_id: variant.product_id,
    sku: variant.sku,
    product_name: variant.product_name,
    ...(variant.product_image ? { product_image: variant.product_image } : {}),
    price: variant.price,
    quantity,
    total: money(variant.price * quantity),
    gst: variant.gst,
    moq: variant.moq,
    packaging_size: variant.packaging_size,
    packaging_type: '',
    uom: variant.uom,
    requested_weight: 0,
    item_type: 'bulk',
    packaging_sku: null,
    is_custom_packaging: false,
  };
}

function cap(quantity: number, variant: CatalogVariant): number {
  return Math.min(quantity, variant.available_qty, MAX_QUANTITY);
}

/**
 * AppContext `addToCart`: adds to the line already there, capped at stock.
 * Nothing left to add (out of stock) is a failure the app can toast.
 */
export function addItem(
  lines: readonly CartLineData[],
  variant: CatalogVariant,
  quantity: number,
): CartChange {
  const index = lines.findIndex((l) => l.sku === variant.sku);
  const existing = index === -1 ? 0 : lines[index].quantity;
  const capped = cap(existing + quantity, variant);

  if (capped <= 0) return { ok: false, reason: 'OUT_OF_STOCK' };

  if (index === -1) {
    if (lines.length >= MAX_LINES) {
      return { ok: false, reason: 'CART_LIMIT_REACHED' };
    }
    return { ok: true, lines: [...lines, lineFrom(variant, capped)] };
  }

  const next = [...lines];
  next[index] = lineFrom(variant, capped);
  return { ok: true, lines: next };
}

/**
 * AppContext `updateCartQuantity`: 0 or less removes the line; anything else
 * is capped at stock. A pack no longer sold (`variant` null) can only go.
 */
export function setQuantity(
  lines: readonly CartLineData[],
  sku: string,
  quantity: number,
  variant: CatalogVariant | null,
): CartChange {
  const index = lines.findIndex((l) => l.sku === sku);

  if (index === -1) return { ok: false, reason: 'NOT_IN_CART' };
  if (quantity <= 0) return removeItem(lines, sku);

  const capped = variant ? cap(quantity, variant) : 0;
  if (!variant || capped <= 0) return { ok: false, reason: 'OUT_OF_STOCK' };

  const next = [...lines];
  next[index] = lineFrom(variant, capped);
  return { ok: true, lines: next };
}

/** AppContext `removeFromCart`. Removing what is not there is not an error. */
export function removeItem(
  lines: readonly CartLineData[],
  sku: string,
): CartChange {
  return { ok: true, lines: lines.filter((l) => l.sku !== sku) };
}

/**
 * Lines brought back from elsewhere (a draft order), re-priced and re-capped
 * at today's stock. Packs no longer sold or out of stock are left out — the
 * app's own restore skips a product it cannot find the same way.
 */
export function restoreLines(
  saved: readonly { sku: string; quantity: number }[],
  catalog: ReadonlyMap<string, CatalogVariant>,
): CartLineData[] {
  let lines: CartLineData[] = [];

  for (const line of saved) {
    const variant = catalog.get(line.sku);
    if (!variant) continue;

    const change = addItem(lines, variant, line.quantity);
    if (change.ok) lines = change.lines;
  }

  return lines;
}

export interface CartTotals {
  item_count: number;
  subtotal: number;
}

export function totalsOf(lines: readonly CartLineData[]): CartTotals {
  return {
    item_count: lines.reduce((sum, l) => sum + l.quantity, 0),
    subtotal: money(lines.reduce((sum, l) => sum + l.total, 0)),
  };
}

export interface PricedLine extends CartLineData {
  /** Not stored — B2B's lines carry no MRP; read from the catalogue. */
  mrp: number;
  /** The app's pack label; the stored `packaging_size` when delisted. */
  size_label: string;
  available_qty: number;
  /** Sold and in stock for the quantity in the cart. */
  available: boolean;
  /** The dealer price moved since the line was written. */
  price_changed: boolean;
}

/**
 * The stored lines re-priced from the catalogue as it is now. Stored prices
 * are a snapshot; what the partner is shown — and what checkout charges — is
 * always the live price, with flags saying what moved.
 */
export function priceLines(
  lines: readonly CartLineData[],
  catalog: ReadonlyMap<string, CatalogVariant>,
): PricedLine[] {
  return lines.map((line) => {
    const variant = catalog.get(line.sku);

    if (!variant) {
      return {
        ...line,
        mrp: 0,
        size_label: `${line.packaging_size} ${line.uom}`.trim(),
        available_qty: 0,
        available: false,
        price_changed: false,
      };
    }

    return {
      ...lineFrom(variant, line.quantity),
      mrp: variant.mrp,
      size_label: variant.size_label,
      available_qty: variant.available_qty,
      available: line.quantity <= variant.available_qty,
      price_changed: variant.price !== line.price,
    };
  });
}

/** HO's carts card: a cart nobody touched for this many IST days is stale. */
export const STALE_CART_DAYS = 7;

/**
 * Carts last touched before this instant are stale: idle `STALE_CART_DAYS`
 * IST calendar days or more, as Today counts a saved cart's idle days — so
 * one touched yesterday evening is 1 day idle, not 0.
 */
export function staleBefore(now: Date): Date {
  return new Date(istDayStart(now).getTime() - (STALE_CART_DAYS - 1) * DAY_MS);
}
