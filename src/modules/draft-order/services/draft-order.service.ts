import { Injectable } from '@nestjs/common';

import type { PartnerRef } from '@common/auth/current-partner.decorator';
import {
  conflict,
  notFound,
  serviceUnavailable,
} from '@common/errors/api-error';
import { PageResult } from '@common/http/page-result';
import { KeyedSerialQueue } from '@common/utils/keyed-serial-queue';
import type { CartView } from '@modules/cart/dto/cart-view.dto';
import { CartService } from '@modules/cart/services/cart.service';
import { CatalogService } from '@modules/catalog/services/catalog.service';

import {
  draftOrderId,
  formDataFor,
  grandTotalOf,
  itemCountOf,
  productsFrom,
  restorableLines,
  type DraftCustomer,
} from '../draft-order.domain';
import type { DraftOrdersQueryDto } from '../dto/draft-order-request.dto';
import type { DraftOrderView } from '../dto/draft-order-view.dto';
import { CustomerLookupRepository } from '../repositories/customer-lookup.repository';
import {
  DraftOrderRepository,
  type CustomerKey,
  type DraftWrite,
} from '../repositories/draft-order.repository';
import type { DraftOrderRecord } from '../schemas/draft-order.schema';

@Injectable()
export class DraftOrderService {
  /**
   * One partner's saves, one at a time, on this instance: two quick taps on
   * "save" would otherwise both find no draft and write two.
   */
  private readonly saves = new KeyedSerialQueue();

  constructor(
    private readonly drafts: DraftOrderRepository,
    private readonly customers: CustomerLookupRepository,
    private readonly cart: CartService,
    private readonly catalog: CatalogService,
  ) {}

  /**
   * Cart.tsx `saveForLater`: the active cart, at today's prices, saved for its
   * customer — one open draft per customer, so saving again replaces it. The
   * cart itself is left as it is, as on the phone.
   */
  save(partner: PartnerRef, token: string): Promise<DraftOrderView> {
    return this.saves.run(partner.agent_id, () =>
      this.writeDraft(partner, token),
    );
  }

  async list(
    partnerId: string,
    query: DraftOrdersQueryDto,
  ): Promise<PageResult<DraftOrderView>> {
    const [rows, total] = await this.drafts.list(
      partnerId,
      query.skip,
      query.limit,
    );
    return new PageResult(rows.map(draftView), total, query);
  }

  async get(partnerId: string, id: string): Promise<DraftOrderView> {
    return draftView(await this.found(this.drafts.findOne(partnerId, id)));
  }

  /**
   * SavedCarts `_resume`: the draft's lines replace the active cart, for the
   * draft's customer, re-capped at today's stock. The draft stays, as on the
   * phone, until it is ordered or deleted.
   */
  async restore(
    partner: PartnerRef,
    token: string,
    id: string,
  ): Promise<CartView> {
    const draft = await this.found(this.drafts.findOne(partner.agent_id, id));
    const piiId = await this.customers.piiIdFor(
      draft.contact_id,
      draft.contact_number,
    );

    return this.cart.replace(
      partner,
      token,
      restorableLines(draft.form_data?.products ?? []),
      piiId,
    );
  }

  async markReminderSent(
    partnerId: string,
    id: string,
  ): Promise<DraftOrderView> {
    return draftView(
      await this.found(this.drafts.markReminderSent(partnerId, id)),
    );
  }

  async delete(partnerId: string, id: string): Promise<{ deleted: true }> {
    if (!(await this.drafts.delete(partnerId, id))) {
      throw notFound('This draft order no longer exists.');
    }
    return { deleted: true };
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private async writeDraft(
    partner: PartnerRef,
    token: string,
  ): Promise<DraftOrderView> {
    const partnerId = partner.agent_id;
    const cart = await this.cart.get(partner, token);

    if (cart.items.length === 0) {
      throw conflict(
        'DRAFT_CART_EMPTY',
        'Your cart is empty. Please add a product before saving.',
      );
    }

    // Re-checked here: a cart may still name a customer set before the check.
    await this.cart.requireCustomer(partner, cart.pii_id);

    const [catalog, customer] = await Promise.all([
      this.catalog.variants(
        cart.items.map((l) => l.sku),
        token,
      ),
      this.customerFor(cart.pii_id),
    ]);

    const products = productsFrom(
      cart.items.map((l) => ({
        ...l,
        gst: catalog.get(l.sku)?.gst ?? 0,
      })),
    );

    const write: DraftWrite = {
      contact_id: customer?.contact_id ?? null,
      customer_name: customer?.name ?? null,
      contact_number: customer?.phone ?? null,
      form_data: formDataFor(customer, products),
      grand_total: grandTotalOf(products),
    };

    const key: CustomerKey = {
      contact_number: write.contact_number,
      customer_name: write.customer_name,
    };
    const open = await this.drafts.findOpen(partnerId, key);

    if (open) {
      const replaced = await this.drafts.replace(
        partnerId,
        open.draft_order_id,
        write,
      );
      // Gone between the read and the write (deleted, or ordered): start anew.
      if (replaced) return draftView(replaced);
    }

    const count = await this.drafts.nextCount();
    if (count === null) {
      throw serviceUnavailable(
        'DRAFT_ID_UNAVAILABLE',
        'Drafts cannot be saved right now. Please try again later.',
      );
    }

    return draftView(
      await this.drafts.insert(partnerId, draftOrderId(count), write),
    );
  }

  private async customerFor(
    piiId: string | null,
  ): Promise<DraftCustomer | null> {
    if (!piiId) return null;

    const customer = await this.customers.byPiiId(piiId);
    if (!customer) throw notFound('This customer could not be found.');
    return customer;
  }

  private async found(
    pending: Promise<DraftOrderRecord | null>,
  ): Promise<DraftOrderRecord> {
    const draft = await pending;
    if (!draft) throw notFound('This draft order no longer exists.');
    return draft;
  }
}

function draftView(draft: DraftOrderRecord): DraftOrderView {
  const products = draft.form_data?.products ?? [];

  return {
    id: draft.draft_order_id,
    contact_id: draft.contact_id ?? null,
    customer_name: draft.customer_name ?? null,
    contact_number: draft.contact_number ?? null,
    items: products.map((p) => ({
      sku: p.sku,
      product_name: p.productName,
      product_image: p.imageUrl ?? null,
      size_label: p.variant,
      price: p.unitPrice,
      mrp: p.mrp,
      quantity: p.quantity,
      line_total: p.total,
    })),
    item_count: itemCountOf(products),
    subtotal: draft.grand_total ?? grandTotalOf(products),
    reminder_sent: draft.reminder_sent ?? false,
    updated_at: draft.updated_at,
  };
}
