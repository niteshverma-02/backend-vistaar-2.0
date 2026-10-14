import {
  DAY_MS,
  istDayStart,
  istDaysBetween,
} from '@common/utils/ist-day.util';

/**
 * Home's "Today's tasks" (PRD H5; Lovable TodayTasks.tsx): what the partner
 * should do now, read from the records it is about. Pure rules — the service
 * only fetches.
 */

/** In the app's order: follow-ups, saved carts, events, orders. */
export const TASK_TYPES = [
  'follow_up',
  'saved_cart',
  'event',
  'order_to_confirm',
] as const;
export type TaskType = (typeof TASK_TYPES)[number];

/** A saved cart idle this many days is urgent (Lovable). */
export const CART_URGENT_DAYS = 3;

/** Raw statuses read as "placed" that are not a live order to confirm. */
const NOT_AN_ORDER: ReadonlySet<string> = new Set(['failed', 'pseudo']);

interface TaskBase {
  /** The record's id — what the app opens. */
  ref_id: string;
  urgent: boolean;
  /** The time the task is about (follow-up, cart change, event start, order). */
  at: Date;
}

export interface FollowUpTask extends TaskBase {
  type: 'follow_up';
  /** 0 = due today. */
  overdue_days: number;
  lead: {
    pii_id: string;
    name: string;
    phone: string;
    crops: string[];
    acreage: number;
    expected_value: number | null;
    stage: string;
  };
}

export interface SavedCartTask extends TaskBase {
  type: 'saved_cart';
  idle_days: number;
  cart: {
    id: string;
    pii_id: string | null;
    customer_name: string | null;
    contact_number: string | null;
    item_count: number;
    subtotal: number;
  };
}

export interface EventTask extends TaskBase {
  type: 'event';
  event: {
    id: string;
    title: string;
    type: string;
    starts_at: Date;
    location: string;
  };
}

export interface OrderTask extends TaskBase {
  type: 'order_to_confirm';
  order: {
    id: string;
    customer_id: string | null;
    customer_name: string;
    total: number;
    payment_mode: string;
    order_status: string;
  };
}

export type TodayTask = FollowUpTask | SavedCartTask | EventTask | OrderTask;

export interface TodayView {
  count: number;
  counts: Record<TaskType, number>;
  items: TodayTask[];
}

/** What the service hands over, already the partner's own. */
export interface TodaySources {
  /** Open leads with a follow-up today or earlier. */
  dueLeads: {
    pii_id: string;
    name: string;
    phone: string;
    crops: string[];
    acreage: number;
    expected_value: number | null;
    stage: string;
    next_follow_up: Date | null;
  }[];
  /** Open saved carts. */
  carts: {
    id: string;
    pii_id: string | null;
    customer_name: string | null;
    contact_number: string | null;
    item_count: number;
    subtotal: number;
    reminder_sent: boolean;
    updated_at: Date;
  }[];
  /** Events not started yet, visible to the partner. */
  events: {
    id: string;
    title: string;
    type: string;
    starts_at: Date;
    location: string;
    registered: boolean;
  }[];
  /** Orders still at the "placed" stage. */
  orders: {
    id: string;
    customer_id: string | null;
    customer_name: string;
    total: number;
    payment_mode: string;
    order_status: string;
    created_at: Date;
  }[];
}

const byAt = (a: TaskBase, b: TaskBase) => a.at.getTime() - b.at.getTime();

export function followUpTasks(
  leads: TodaySources['dueLeads'],
  now: Date,
): FollowUpTask[] {
  return leads
    .filter((l) => l.next_follow_up)
    .map((l) => {
      const at = l.next_follow_up as Date;
      const overdue = Math.max(0, istDaysBetween(at, now));
      const { next_follow_up: _at, ...lead } = l;
      return {
        type: 'follow_up' as const,
        ref_id: l.pii_id,
        urgent: overdue > 0,
        at,
        overdue_days: overdue,
        lead,
      };
    })
    .sort(byAt);
}

/** Carts for a farmer, not reminded yet; shop stock has nobody to remind. */
export function savedCartTasks(
  carts: TodaySources['carts'],
  now: Date,
): SavedCartTask[] {
  return carts
    .filter((c) => !c.reminder_sent && (c.pii_id || c.customer_name))
    .map((c) => {
      const idle = Math.max(0, istDaysBetween(c.updated_at, now));
      const { reminder_sent: _sent, updated_at, ...cart } = c;
      return {
        type: 'saved_cart' as const,
        ref_id: c.id,
        urgent: idle >= CART_URGENT_DAYS,
        at: updated_at,
        idle_days: idle,
        cart,
      };
    })
    .sort(byAt);
}

/** Events the partner holds a seat at, today or tomorrow (IST). */
export function eventTasks(
  events: TodaySources['events'],
  now: Date,
): EventTask[] {
  const until = istDayStart(now).getTime() + 2 * DAY_MS;
  return events
    .filter((e) => e.registered && e.starts_at.getTime() < until)
    .map((e) => {
      const { registered: _r, ...event } = e;
      return {
        type: 'event' as const,
        ref_id: e.id,
        urgent: istDaysBetween(now, e.starts_at) === 0,
        at: e.starts_at,
        event,
      };
    })
    .sort(byAt);
}

/** Orders placed and not yet confirmed at the warehouse — oldest first. */
export function orderTasks(orders: TodaySources['orders']): OrderTask[] {
  return orders
    .filter((o) => !NOT_AN_ORDER.has(o.order_status.trim().toLowerCase()))
    .map((o) => {
      const { created_at, ...order } = o;
      return {
        type: 'order_to_confirm' as const,
        ref_id: o.id,
        urgent: false,
        at: created_at,
        order,
      };
    })
    .sort(byAt);
}

export function todayOf(sources: TodaySources, now: Date): TodayView {
  const groups: Record<TaskType, TodayTask[]> = {
    follow_up: followUpTasks(sources.dueLeads, now),
    saved_cart: savedCartTasks(sources.carts, now),
    event: eventTasks(sources.events, now),
    order_to_confirm: orderTasks(sources.orders),
  };
  const items = TASK_TYPES.flatMap((t) => groups[t]);
  return {
    count: items.length,
    counts: {
      follow_up: groups.follow_up.length,
      saved_cart: groups.saved_cart.length,
      event: groups.event.length,
      order_to_confirm: groups.order_to_confirm.length,
    },
    items,
  };
}
