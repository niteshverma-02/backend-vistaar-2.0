import { HttpException } from '@nestjs/common';
import { Types } from 'mongoose';

import { forbidden, notFound } from '@common/errors/api-error';
import type { AgentsService } from '@modules/agents/services/agents.service';

import type { CartView } from '@modules/cart/dto/cart-view.dto';
import type { CartService } from '@modules/cart/services/cart.service';
import type { CatalogVariant } from '@modules/catalog/catalog.domain';
import type { CatalogService } from '@modules/catalog/services/catalog.service';

import { DraftOrdersQueryDto } from '../dto/draft-order-request.dto';
import { formDataFor, type DraftCustomer } from '../draft-order.domain';
import type { CustomerLookupRepository } from '../repositories/customer-lookup.repository';
import type {
  DraftOrderRepository,
  DraftWrite,
} from '../repositories/draft-order.repository';
import type { DraftOrderRecord } from '../schemas/draft-order.schema';
import { DraftOrderService } from './draft-order.service';

const PARTNER = 'VA-1';
const OWNER = { agent_id: PARTNER, pii_id: 'PII-9' };
const TOKEN = 'agent-token';

const CUSTOMER: DraftCustomer = {
  pii_id: 'PII-1',
  contact_id: 'C0-1',
  lead_id: 'L-1',
  name: 'Mohan Rao',
  phone: '8247554977',
};

function cartView(overrides: Partial<CartView> = {}): CartView {
  return {
    pii_id: 'PII-1',
    items: [
      {
        sku: 'K-1',
        product_id: 'BK-1',
        product_name: 'Humic',
        product_image: null,
        size_label: '1 KG',
        price: 100,
        mrp: 150,
        quantity: 2,
        line_total: 200,
        available_qty: 10,
        available: true,
        price_changed: false,
      },
    ],
    item_count: 2,
    subtotal: 200,
    has_issues: false,
    updated_at: new Date(),
    ...overrides,
  };
}

function record(
  id: string,
  write: DraftWrite,
  overrides: Partial<DraftOrderRecord> = {},
): DraftOrderRecord {
  return {
    _id: new Types.ObjectId(),
    draft_order_id: id,
    agent_id: PARTNER,
    deal_id: null,
    status: 'draft',
    order_id: null,
    entry_path: 'vistaar',
    reminder_sent: false,
    created_at: new Date(),
    updated_at: new Date(),
    __v: 0,
    ...write,
    ...overrides,
  };
}

describe('DraftOrderService', () => {
  let cart: CartView;
  let open: DraftOrderRecord | null;
  let counter: number | null;
  let drafts: jest.Mocked<DraftOrderRepository>;
  let customers: jest.Mocked<CustomerLookupRepository>;
  let cartService: jest.Mocked<CartService>;
  let service: DraftOrderService;
  let agents: { requireWorkingPartner: jest.Mock };

  beforeEach(() => {
    cart = cartView();
    open = null;
    counter = 95;

    drafts = {
      nextCount: jest.fn(() =>
        Promise.resolve(counter === null ? null : ++counter),
      ),
      findOpen: jest.fn(() => Promise.resolve(open)),
      findAllOpen: jest.fn(() => Promise.resolve([])),
      findOne: jest.fn(() => Promise.resolve(open)),
      insert: jest.fn((_p: string, id: string, data: DraftWrite) =>
        Promise.resolve(record(id, data)),
      ),
      replace: jest.fn((_p: string, id: string, data: DraftWrite) =>
        Promise.resolve(open ? record(id, data) : null),
      ),
      list: jest.fn(),
      markReminderSent: jest.fn(),
      delete: jest.fn(() => Promise.resolve(true)),
    } as unknown as jest.Mocked<DraftOrderRepository>;

    customers = {
      byPiiId: jest.fn(() => Promise.resolve(CUSTOMER)),
      piiIdFor: jest.fn(() => Promise.resolve('PII-1')),
      piiIdsFor: jest.fn(() =>
        Promise.resolve(new Map([['C0-1|8247554977', 'PII-1']])),
      ),
    } as unknown as jest.Mocked<CustomerLookupRepository>;

    cartService = {
      get: jest.fn(() => Promise.resolve(cart)),
      replace: jest.fn(() => Promise.resolve(cartView())),
      requireCustomer: jest.fn(() => Promise.resolve()),
    } as unknown as jest.Mocked<CartService>;

    const catalog = {
      variants: jest.fn(() =>
        Promise.resolve(new Map([['K-1', { gst: 18 } as CatalogVariant]])),
      ),
    } as unknown as CatalogService;

    agents = { requireWorkingPartner: jest.fn().mockResolvedValue({}) };
    service = new DraftOrderService(
      drafts,
      customers,
      cartService,
      catalog,
      agents as unknown as AgentsService,
    );
  });

  describe('save', () => {
    it('refuses a blocked partner before reading the cart', async () => {
      agents.requireWorkingPartner.mockRejectedValueOnce(
        forbidden('ACCOUNT_BLOCKED', 'blocked'),
      );
      await expect(service.save(OWNER, TOKEN)).rejects.toMatchObject({
        status: 403,
      });
      expect(cartService.get).not.toHaveBeenCalled();
    });

    it("never reads or writes a customer the partner's cart may not name", async () => {
      cartService.requireCustomer.mockRejectedValueOnce(
        notFound('This customer could not be found.'),
      );

      await expect(service.save(OWNER, TOKEN)).rejects.toMatchObject({
        status: 404,
      });

      expect(cartService.requireCustomer).toHaveBeenCalledWith(OWNER, 'PII-1');
      expect(customers.byPiiId).not.toHaveBeenCalled();
      expect(drafts.nextCount).not.toHaveBeenCalled();
      expect(drafts.insert).not.toHaveBeenCalled();
    });

    it('starts a new draft with the next DFT id, customer copied in', async () => {
      const view = await service.save(OWNER, TOKEN);

      expect(view).toMatchObject({
        id: 'DFT-96',
        contact_id: 'C0-1',
        customer_name: 'Mohan Rao',
        contact_number: '8247554977',
        item_count: 2,
        subtotal: 200,
        reminder_sent: false,
      });

      const write = drafts.insert.mock.calls[0][2];
      expect(write.form_data.products[0]).toMatchObject({
        sku: 'K-1',
        gstPercent: 18,
        unitPrice: 100,
      });
      expect(write.grand_total).toBe(200);
    });

    it("replaces the customer's open draft, keeping its id", async () => {
      open = record('DFT-40', {
        contact_id: 'C0-1',
        customer_name: 'Mohan Rao',
        contact_number: '8247554977',
        form_data: formDataFor(CUSTOMER, []),
        grand_total: 0,
      });

      const view = await service.save(OWNER, TOKEN);

      expect(view.id).toBe('DFT-40');
      expect(drafts.nextCount).not.toHaveBeenCalled();
      expect(drafts.insert).not.toHaveBeenCalled();
    });

    it('starts anew when the open draft went away mid-save', async () => {
      open = record('DFT-40', {
        contact_id: null,
        customer_name: null,
        contact_number: null,
        form_data: formDataFor(null, []),
        grand_total: 0,
      });
      drafts.replace.mockResolvedValueOnce(null);

      expect((await service.save(OWNER, TOKEN)).id).toBe('DFT-96');
    });

    it('keys own-stock drafts apart from customers', async () => {
      cart = cartView({ pii_id: null });

      await service.save(OWNER, TOKEN);

      expect(customers.byPiiId).not.toHaveBeenCalled();
      expect(drafts.findOpen).toHaveBeenCalledWith(PARTNER, {
        contact_number: null,
        customer_name: null,
      });
    });

    it('refuses an empty cart', async () => {
      cart = cartView({ items: [] });
      await expect(service.save(OWNER, TOKEN)).rejects.toThrow(HttpException);
      expect(drafts.insert).not.toHaveBeenCalled();
    });

    it('fails cleanly when the shared counter row is missing', async () => {
      counter = null;
      await expect(service.save(OWNER, TOKEN)).rejects.toMatchObject({
        status: 503,
      });
      expect(drafts.insert).not.toHaveBeenCalled();
    });

    it('queues two quick saves so they do not both start a draft', async () => {
      drafts.insert.mockImplementation((_p, id, data) => {
        open = record(id, data);
        return Promise.resolve(open);
      });

      const [a, b] = await Promise.all([
        service.save(OWNER, TOKEN),
        service.save(OWNER, TOKEN),
      ]);

      expect(a.id).toBe('DFT-96');
      expect(b.id).toBe('DFT-96');
      expect(drafts.insert).toHaveBeenCalledTimes(1);
    });
  });

  describe('save — two instances', () => {
    it('keeps the oldest when another instance started the same draft meanwhile', async () => {
      const write = {
        contact_id: 'C0-1',
        customer_name: 'Mohan Rao',
        contact_number: '8247554977',
        form_data: formDataFor(CUSTOMER, []),
        grand_total: 200,
      };
      drafts.findAllOpen.mockResolvedValueOnce([
        record('DFT-95', write),
        record('DFT-96', write),
      ]);

      const view = await service.save(OWNER, TOKEN);

      expect(view.id).toBe('DFT-95');
      expect(drafts.findAllOpen).toHaveBeenCalledWith(PARTNER, {
        contact_number: '8247554977',
        customer_name: 'Mohan Rao',
      });
      expect(drafts.delete).toHaveBeenCalledTimes(1);
      expect(drafts.delete).toHaveBeenCalledWith(PARTNER, 'DFT-96');
    });

    it('deletes nothing when the draft is the only one', async () => {
      drafts.findAllOpen.mockResolvedValueOnce([
        record('DFT-96', {
          contact_id: 'C0-1',
          customer_name: 'Mohan Rao',
          contact_number: '8247554977',
          form_data: formDataFor(CUSTOMER, []),
          grand_total: 200,
        }),
      ]);
      expect((await service.save(OWNER, TOKEN)).id).toBe('DFT-96');
      expect(drafts.delete).not.toHaveBeenCalled();
    });
  });

  describe('restore', () => {
    it("puts the draft's lines back in the cart for its customer", async () => {
      open = record('DFT-40', {
        contact_id: 'C0-1',
        customer_name: 'Mohan Rao',
        contact_number: '8247554977',
        form_data: formDataFor(CUSTOMER, [
          {
            id: 'K-1',
            productName: 'Humic',
            variant: '1 KG',
            sku: 'K-1',
            quantity: 3,
            unitPrice: 100,
            mrp: 150,
            gstPercent: 18,
            discount: 0,
            total: 300,
            weight: 0,
            inStock: true,
            _source: 'products',
          },
        ]),
        grand_total: 300,
      });

      await service.restore(OWNER, TOKEN, 'DFT-40');

      expect(customers.piiIdFor).toHaveBeenCalledWith('C0-1', '8247554977');
      expect(cartService.replace).toHaveBeenCalledWith(
        OWNER,
        TOKEN,
        [{ sku: 'K-1', quantity: 3 }],
        'PII-1',
      );
    });

    it('is a 404 for a draft that is not open or not ours', async () => {
      await expect(
        service.restore(OWNER, TOKEN, 'DFT-1'),
      ).rejects.toMatchObject({ status: 404 });
      expect(cartService.replace).not.toHaveBeenCalled();
    });
  });

  describe('the farmer on a draft', () => {
    const write = (contact_id: string | null, phone: string | null) => ({
      contact_id,
      customer_name: contact_id ? 'Mohan Rao' : null,
      contact_number: phone,
      form_data: { products: [] },
      grand_total: 0,
    });

    it('names each draft’s farmer by pii_id, one lookup for the page', async () => {
      drafts.list.mockResolvedValue([
        [
          record('DFT-1', write('C0-1', '8247554977') as unknown as DraftWrite),
          record('DFT-2', write(null, null) as unknown as DraftWrite),
        ],
        2,
      ]);
      const page = await service.list(
        PARTNER,
        Object.assign(new DraftOrdersQueryDto(), {}),
      );
      expect(page.items.map((d) => d.pii_id)).toEqual(['PII-1', null]);
      expect(customers.piiIdsFor).toHaveBeenCalledTimes(1);
    });

    it('a saved draft carries the cart’s farmer', async () => {
      const saved = await service.save(OWNER, TOKEN);
      expect(saved.pii_id).toBe('PII-1');
    });
  });

  it('delete is a 404 when nothing was deleted', async () => {
    drafts.delete.mockResolvedValueOnce(false);
    await expect(service.delete(PARTNER, 'DFT-1')).rejects.toMatchObject({
      status: 404,
    });
  });
});
