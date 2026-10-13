import type { OrderAddress, OrderStatusEntry } from './schemas/order.schema';

/** `orders_v2.source` on every order a Vistaar partner places. */
export const VISTAAR_ORDER_SOURCE = 'vistaar';

/**
 * The app's order states (`OrderStatus` in the Flutter app). Stockship has
 * ~50 raw `order_status` values, several of them spellings of the same stage
 * (`in transit` / `in_transit`), so the app gets these and the raw value
 * beside them.
 */
export const ORDER_STAGES = [
  'placed',
  'punched',
  'shipped',
  'delivered',
  'cancelled',
  'returned',
] as const;
export type OrderStage = (typeof ORDER_STAGES)[number];

/**
 * Where each raw status sits on the tracking line: 0 placed, 1 confirmed at
 * the warehouse, 2 shipped, 3 out for delivery, 4 delivered. Cancelled and
 * returned are off the line.
 *
 * Taken from the values in `orders_v2` on 2026-10-12. A status not listed
 * here reads as `placed`: a new stage Stockship adds must not hide an order.
 */
/** Cancelled and returned are not steps on the line. */
const OFF_LINE = -1;

const RAW_STATUS: Record<string, { stage: OrderStage; step: number }> = {
  created: { stage: 'placed', step: 0 },
  pending: { stage: 'placed', step: 0 },
  processing: { stage: 'placed', step: 0 },
  failed: { stage: 'placed', step: 0 },
  blocked: { stage: 'placed', step: 0 },
  pseudo: { stage: 'placed', step: 0 },
  split: { stage: 'placed', step: 0 },
  nsz: { stage: 'placed', step: 0 },
  non_servicable_zone: { stage: 'placed', step: 0 },
  ready_to_confirm: { stage: 'placed', step: 0 },
  ready_to_check: { stage: 'placed', step: 0 },

  confirmed: { stage: 'punched', step: 1 },
  outbound_pending: { stage: 'punched', step: 1 },
  ready_to_outbound: { stage: 'punched', step: 1 },
  picklist_assigned: { stage: 'punched', step: 1 },
  ready_to_pick: { stage: 'punched', step: 1 },
  ready_to_pack: { stage: 'punched', step: 1 },
  packed: { stage: 'punched', step: 1 },
  ready_to_rack: { stage: 'punched', step: 1 },
  racked: { stage: 'punched', step: 1 },
  ready_to_book: { stage: 'punched', step: 1 },
  booked: { stage: 'punched', step: 1 },
  booking_cancelled: { stage: 'punched', step: 1 },
  ready_to_manifest: { stage: 'punched', step: 1 },
  ready_to_dispatch: { stage: 'punched', step: 1 },

  dispatched: { stage: 'shipped', step: 2 },
  'in transit': { stage: 'shipped', step: 2 },
  in_transit: { stage: 'shipped', step: 2 },
  ndr: { stage: 'shipped', step: 2 },
  out_for_delivery: { stage: 'shipped', step: 3 },

  delivered: { stage: 'delivered', step: 4 },

  cancel: { stage: 'cancelled', step: OFF_LINE },
  cancelled: { stage: 'cancelled', step: OFF_LINE },
  destroy: { stage: 'cancelled', step: OFF_LINE },
  destroyed: { stage: 'cancelled', step: OFF_LINE },
  lost: { stage: 'cancelled', step: OFF_LINE },
  merged: { stage: 'cancelled', step: OFF_LINE },

  rto: { stage: 'returned', step: OFF_LINE },
  rto_initiated: { stage: 'returned', step: OFF_LINE },
  'rto in transit': { stage: 'returned', step: OFF_LINE },
  rto_in_transit: { stage: 'returned', step: OFF_LINE },
  rto_intransit: { stage: 'returned', step: OFF_LINE },
  'rto received': { stage: 'returned', step: OFF_LINE },
  rto_received: { stage: 'returned', step: OFF_LINE },
  rto_delivered: { stage: 'returned', step: OFF_LINE },
  partially_rto: { stage: 'returned', step: OFF_LINE },
};

const normalise = (status: string | null | undefined): string =>
  (status ?? '').trim().toLowerCase();

/** The app's stage for a raw `order_status`. */
export function stageOf(status: string | null | undefined): OrderStage {
  return RAW_STATUS[normalise(status)]?.stage ?? 'placed';
}

/** Every raw `order_status` that reads as `stage` — the `$in` of a filter. */
export function statusesFor(stage: OrderStage): string[] {
  return Object.keys(RAW_STATUS).filter((s) => RAW_STATUS[s].stage === stage);
}

export interface TrackingStep {
  status: string;
  description: string;
  timestamp: Date | null;
  completed: boolean;
}

/** The app's `initialTrackingSteps`, in order. */
const LINE: ReadonlyArray<{ status: string; description: string }> = [
  { status: 'Order placed', description: 'Order received by Katyayani' },
  { status: 'Confirmed', description: 'Order punched at warehouse' },
  { status: 'Shipped', description: 'Handed to courier' },
  { status: 'Out for delivery', description: 'With delivery partner' },
  { status: 'Delivered', description: 'Delivered to customer' },
];

const OFF_LINE_STEP: Partial<Record<OrderStage, TrackingStep['status']>> = {
  cancelled: 'Cancelled',
  returned: 'Returned',
};

/**
 * The tracking line from `order_status_map`. A step is done when the order
 * reached it or anything past it; its time is the first time the order
 * entered it (`null` when Stockship jumped over it). A cancelled or returned
 * order keeps the steps it reached and ends on that state.
 */
export function trackingSteps(
  status: string | null | undefined,
  history: OrderStatusEntry[] | null | undefined,
  placedAt: Date | null | undefined,
): TrackingStep[] {
  const entries = history ?? [];
  const firstAt: (Date | null)[] = LINE.map(() => null);
  let reached = 0;

  for (const entry of entries) {
    const step = RAW_STATUS[normalise(entry.stage_name)]?.step ?? 0;
    if (step < 0) continue;
    reached = Math.max(reached, step);
    firstAt[step] ??= entry.timestamp ?? null;
  }

  const current = RAW_STATUS[normalise(status)];
  if (current && current.step >= 0) reached = Math.max(reached, current.step);
  firstAt[0] ??= placedAt ?? null;

  const steps: TrackingStep[] = LINE.map((s, i) => ({
    ...s,
    timestamp: i <= reached ? firstAt[i] : null,
    completed: i <= reached,
  }));

  const off = OFF_LINE_STEP[stageOf(status)];
  if (!off) return steps;

  const offAt =
    [...entries]
      .reverse()
      .find((e) => stageOf(e.stage_name) === stageOf(status))?.timestamp ??
    null;

  return [
    ...steps.filter((s) => s.completed),
    {
      status: off,
      description:
        off === 'Cancelled'
          ? 'Order cancelled'
          : 'Returned to Katyayani by the courier',
      timestamp: offAt,
      completed: true,
    },
  ];
}

/** One line for the app: `address1, address2, city, state pincode`. */
export function addressLine(address: OrderAddress | null | undefined): string {
  if (!address) return '';
  const tail = [address.state, address.pincode].filter(Boolean).join(' ');
  return [
    address.address1,
    address.address2,
    address.address3,
    address.city,
    tail,
  ]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(', ');
}

/** `first last`, or `first` when the two are the same (they often are). */
export function personName(
  first: string | null | undefined,
  last: string | null | undefined,
): string {
  const a = (first ?? '').trim();
  const b = (last ?? '').trim();
  return a.toLowerCase() === b.toLowerCase() || !b ? a : `${a} ${b}`.trim();
}

/** `250 ML`, or `250 ML × 5` for a multi-pack. */
export function sizeLabel(
  variant: { value?: string | number; uom?: string } | null | undefined,
  packs: string | number | null | undefined,
): string {
  const base = [variant?.value, variant?.uom]
    .filter((p) => p !== undefined && p !== null && p !== '')
    .join(' ');
  const n = Number(packs);
  return Number.isFinite(n) && n > 1 ? `${base} × ${n}` : base;
}

/**
 * The first URL in `hero_image`. Some `products_v2` rows hold two URLs run
 * together with no separator; the second one would 404.
 */
export function firstUrl(value: string | null | undefined): string | null {
  const first = (value ?? '').split(/(?=https?:\/\/)/)[0]?.trim();
  return first ? first : null;
}
