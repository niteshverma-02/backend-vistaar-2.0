import { Injectable, Logger } from '@nestjs/common';

import type { PartnerRef } from '@common/auth/current-partner.decorator';
import type { LocationDto } from '@common/dto/location.dto';
import { conflict, notFound } from '@common/errors/api-error';
import { KeyedSerialQueue } from '@common/utils/keyed-serial-queue';
import type { CatalogVariant } from '@modules/catalog/catalog.domain';
import { CatalogService } from '@modules/catalog/services/catalog.service';
import { LeadsService } from '@modules/leads/services/leads.service';

import { AgentsService } from '@modules/agents/services/agents.service';
import {
  addItem,
  MAX_LINES,
  priceLines,
  removeItem,
  restoreLines,
  setQuantity,
  totalsOf,
  type CartChange,
  type CartLineData,
} from '../cart.domain';
import type {
  AddCartItemDto,
  SetCartCustomerDto,
} from '../dto/cart-request.dto';
import type { CartView } from '../dto/cart-view.dto';
import {
  CartRepository,
  type CartWrite,
} from '../repositories/cart.repository';
import type { CartRecord } from '../schemas/cart.schema';

/**
 * Compare-and-set attempts before a write gives up. Within one instance a
 * partner's writes are already queued, so a conflict means a request for the
 * same cart landed on another instance — a retry or two settles it.
 */
const MAX_WRITE_ATTEMPTS = 6;

/**
 * Upper bound of the random pause before retry n (× n), so instances that
 * lost a race together do not re-read and collide again in step.
 */
const RETRY_JITTER_MS = 15;

/** A write as a change makes it: `pii_id: null` = the partner's own stock. */
type PendingWrite = Omit<CartWrite, 'pii_id'> & { pii_id: string | null };

type ActiveChange = (current: CartRecord | null) => PendingWrite;

@Injectable()
export class CartService {
  /** One partner's cart writes, one at a time, on this instance. */
  private readonly writes = new KeyedSerialQueue();
  private readonly logger = new Logger(CartService.name);

  constructor(
    private readonly carts: CartRepository,
    private readonly leads: LeadsService,
    private readonly catalog: CatalogService,
    private readonly agents: AgentsService,
  ) {}

  /** Building an order is for approved partners; reading or emptying a cart is not refused. */
  private canOrder(partner: PartnerRef): Promise<unknown> {
    return this.agents.requireWorkingPartner(partner.agent_id, 'place orders');
  }

  async get(partner: PartnerRef, token: string): Promise<CartView> {
    return this.view(
      await this.carts.findActive(partner.agent_id),
      partner,
      token,
    );
  }

  async addItem(
    partner: PartnerRef,
    token: string,
    dto: AddCartItemDto,
  ): Promise<CartView> {
    await this.canOrder(partner);
    const variant = await this.sellable(dto.sku, token);

    return this.mutate(partner, token, (current) =>
      writeOf(
        applied(addItem(current?.items ?? [], variant, dto.quantity)),
        current?.pii_id,
      ),
    );
  }

  async updateItem(
    partner: PartnerRef,
    token: string,
    sku: string,
    quantity: number,
  ): Promise<CartView> {
    await this.canOrder(partner);
    const variant =
      quantity > 0 ? await this.catalog.variant(sku, token) : null;

    return this.mutate(partner, token, (current) =>
      writeOf(
        applied(setQuantity(current?.items ?? [], sku, quantity, variant)),
        current?.pii_id,
      ),
    );
  }

  removeItem(
    partner: PartnerRef,
    token: string,
    sku: string,
  ): Promise<CartView> {
    return this.mutate(partner, token, (current) =>
      writeOf(applied(removeItem(current?.items ?? [], sku)), current?.pii_id),
    );
  }

  async setCustomer(
    partner: PartnerRef,
    token: string,
    dto: SetCartCustomerDto,
  ): Promise<CartView> {
    await this.canOrder(partner);
    await this.requireCustomer(partner, dto.pii_id);

    const view = await this.mutate(partner, token, (current) =>
      writeOf(current?.items ?? [], dto.pii_id),
    );
    if (dto.pii_id && dto.pii_id !== partner.pii_id && dto.location) {
      await this.noteWhere(partner.agent_id, dto.pii_id, dto.location);
    }
    return view;
  }

  /** Where the farmer may be, from ordering for them — never fails the cart. */
  private async noteWhere(
    agentId: string,
    piiId: string,
    location: LocationDto,
  ): Promise<void> {
    try {
      await this.leads.recordLocation(agentId, piiId, location);
    } catch (error) {
      this.logger.warn(
        `Location for ${piiId} not kept: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** AppContext `clearCart()`: empties the lines and clears the customer. */
  clear(partner: PartnerRef, token: string): Promise<CartView> {
    return this.mutate(partner, token, () => writeOf([], null));
  }

  /**
   * The cart becomes these lines, for this customer — a draft order being
   * resumed. Re-priced and re-capped at today's stock; what is no longer
   * sold is left out.
   */
  async replace(
    partner: PartnerRef,
    token: string,
    lines: readonly { sku: string; quantity: number }[],
    piiId: string | null,
  ): Promise<CartView> {
    await this.canOrder(partner);
    await this.requireCustomer(partner, piiId);

    const catalog = await this.catalog.variants(
      lines.map((l) => l.sku),
      token,
    );
    const restored = restoreLines(lines, catalog);

    return this.mutate(partner, token, () => writeOf(restored, piiId));
  }

  /**
   * A cart, and the draft saved from it, may only be for the partner's own
   * stock or a farmer they hold in Leads: a draft copies the customer's name
   * and phone from `piis` and hands them back, so an unchecked `PII-n` would
   * read any person in the org's records. Unknown and not-theirs answer the
   * same 404, so the check reveals nothing about who exists.
   */
  async requireCustomer(
    partner: PartnerRef,
    piiId: string | null | undefined,
  ): Promise<void> {
    if (!piiId || piiId === partner.pii_id) return;
    if (await this.leads.holds(partner.agent_id, piiId)) return;
    throw notFound('This customer could not be found.');
  }

  // ── Internals ─────────────────────────────────────────────────────────

  /**
   * Read → change → write-if-unchanged. Queued per partner on this instance
   * (quick taps on one phone would otherwise lose writes to each other —
   * 6 of 20 in the beta smoke test), and guarded by the document's `__v`
   * across instances. No database locks or transactions: each write touches
   * one document, so carts scale with the partner count.
   */
  private mutate(
    partner: PartnerRef,
    token: string,
    change: ActiveChange,
  ): Promise<CartView> {
    return this.writes.run(partner.agent_id, () =>
      this.writeActive(partner, token, change),
    );
  }

  private async writeActive(
    partner: PartnerRef,
    token: string,
    change: ActiveChange,
  ): Promise<CartView> {
    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
      if (attempt > 0) await pause(Math.random() * RETRY_JITTER_MS * attempt);

      const current = await this.carts.findActive(partner.agent_id);
      const next = change(current);
      // Every row names a person, as B2B's do: shop stock is the partner's own.
      const stored: CartWrite = {
        ...next,
        pii_id: next.pii_id ?? partner.pii_id,
      };

      const written = current
        ? await this.carts.updateActive(partner.agent_id, current.__v, stored)
        : await this.carts.insertActive(partner.agent_id, stored);

      if (written) {
        return this.view({ ...stored, updated_at: new Date() }, partner, token);
      }
    }

    throw conflict(
      'CART_BUSY',
      'Your cart was changed on another device. Please try again.',
    );
  }

  /** A pack that is sold here, or 404. */
  private async sellable(sku: string, token: string): Promise<CatalogVariant> {
    const variant = await this.catalog.variant(sku, token);
    if (!variant) throw notFound('This product is no longer available.');
    return variant;
  }

  private async view(
    cart:
      | (Pick<CartRecord, 'items'> & {
          pii_id?: string | null;
          updated_at?: Date;
        })
      | null,
    partner: PartnerRef,
    token: string,
  ): Promise<CartView> {
    const piiId = customerOf(cart?.pii_id, partner);

    if (!cart || cart.items.length === 0) {
      return {
        pii_id: piiId,
        items: [],
        item_count: 0,
        subtotal: 0,
        has_issues: false,
        updated_at: cart?.updated_at ?? null,
      };
    }

    const catalog = await this.catalog.variants(
      cart.items.map((l) => l.sku),
      token,
    );
    const priced = priceLines(cart.items, catalog);
    const totals = totalsOf(priced);

    return {
      pii_id: piiId,
      items: priced.map((l) => ({
        sku: l.sku,
        product_id: l.product_id,
        product_name: l.product_name,
        product_image: l.product_image ?? null,
        size_label: l.size_label,
        price: l.price,
        mrp: l.mrp,
        quantity: l.quantity,
        line_total: l.total,
        available_qty: l.available_qty,
        available: l.available,
        price_changed: l.price_changed,
      })),
      item_count: totals.item_count,
      subtotal: totals.subtotal,
      has_issues: priced.some((l) => !l.available),
      updated_at: cart.updated_at ?? null,
    };
  }
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Domain failures as the HTTP errors the app branches on. */
function applied(change: CartChange): CartLineData[] {
  if (change.ok) return change.lines;

  switch (change.reason) {
    case 'OUT_OF_STOCK':
      throw conflict(
        'OUT_OF_STOCK',
        'Sorry, this product is out of stock right now.',
      );
    case 'CART_LIMIT_REACHED':
      throw conflict(
        'CART_LIMIT_REACHED',
        `Your cart is full (up to ${MAX_LINES} products). Please remove a product to add another.`,
      );
    case 'NOT_IN_CART':
      throw notFound(
        'This product is no longer in your cart. Please refresh your cart.',
      );
  }
}

/** The cart's customer for the app: `null` when it is the partner's own stock. */
function customerOf(
  piiId: string | null | undefined,
  partner: PartnerRef,
): string | null {
  return piiId && piiId !== partner.pii_id ? piiId : null;
}

function writeOf(
  lines: CartLineData[],
  piiId: string | null | undefined,
): PendingWrite {
  const { subtotal } = totalsOf(lines);

  return { items: lines, subtotal, total: subtotal, pii_id: piiId ?? null };
}
