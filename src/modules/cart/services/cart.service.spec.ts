import { Types } from 'mongoose';

import type { PartnerRef } from '@common/auth/current-partner.decorator';

import type { CatalogVariant } from '@modules/catalog/catalog.domain';
import type { CatalogService } from '@modules/catalog/services/catalog.service';
import type { LeadsService } from '@modules/leads/services/leads.service';

import { lineFrom } from '../cart.domain';
import type {
  CartRepository,
  CartWrite,
} from '../repositories/cart.repository';
import type { CartRecord } from '../schemas/cart.schema';
import { CartService } from './cart.service';

const PARTNER: PartnerRef = { agent_id: 'VST-000001', pii_id: 'PII-9' };
const TOKEN = 'agent-token';

function variant(
  sku = 'K-1',
  overrides: Partial<CatalogVariant> = {},
): CatalogVariant {
  return {
    sku,
    product_id: 'BK-1',
    product_name: 'Product',
    product_image: null,
    size_label: '1 L',
    packaging_size: '1',
    uom: 'l',
    moq: 1,
    price: 100,
    mrp: 150,
    gst: 0,
    available_qty: 10,
    ...overrides,
  };
}

function record(
  write: CartWrite,
  overrides: Partial<CartRecord> = {},
): CartRecord {
  return {
    _id: new Types.ObjectId(),
    source: 'vistaar',
    tax: 0,
    discount: 0,
    __v: 0,
    created_at: new Date(),
    updated_at: new Date(),
    items: write.items,
    subtotal: write.subtotal,
    total: write.total,
    pii_id: write.pii_id,
    ...overrides,
  };
}

describe('CartService', () => {
  let active: CartRecord | null;
  let repo: jest.Mocked<CartRepository>;
  let leads: jest.Mocked<Pick<LeadsService, 'holds' | 'recordLocation'>>;
  let catalog: Map<string, CatalogVariant>;
  let service: CartService;

  beforeEach(() => {
    active = null;
    catalog = new Map([
      ['K-1', variant()],
      ['K-2', variant('K-2')],
    ]);

    repo = {
      findActive: jest.fn(() => Promise.resolve(active)),
      insertActive: jest.fn((_p: string, data: CartWrite) => {
        active = record(data);
        return Promise.resolve(true);
      }),
      updateActive: jest.fn((_p: string, version: number, data: CartWrite) => {
        if (!active || active.__v !== version) return Promise.resolve(false);
        active = record(data, { __v: version + 1 });
        return Promise.resolve(true);
      }),
    } as unknown as jest.Mocked<CartRepository>;

    const catalogService = {
      variant: (sku: string) => Promise.resolve(catalog.get(sku) ?? null),
      variants: (skus: Iterable<string>) =>
        Promise.resolve(
          new Map(
            [...skus].flatMap((s) =>
              catalog.has(s) ? [[s, catalog.get(s)!]] : [],
            ),
          ),
        ),
    } as unknown as CatalogService;

    // The partner holds PII-1 and PII-1620388 in Leads, nobody else.
    leads = {
      holds: jest.fn((agentId: string, piiId: string) =>
        Promise.resolve(
          agentId === PARTNER.agent_id &&
            ['PII-1', 'PII-1620388'].includes(piiId),
        ),
      ),
      recordLocation: jest.fn().mockResolvedValue(true),
    };

    service = new CartService(
      repo,
      leads as unknown as LeadsService,
      catalogService,
    );
  });

  describe('addItem', () => {
    it('creates the cart on the first add, then updates it', async () => {
      await service.addItem(PARTNER, TOKEN, { sku: 'K-1', quantity: 2 });
      const view = await service.addItem(PARTNER, TOKEN, {
        sku: 'K-1',
        quantity: 3,
      });

      expect(repo.insertActive).toHaveBeenCalledTimes(1);
      expect(repo.updateActive).toHaveBeenCalledTimes(1);
      expect(view).toMatchObject({
        item_count: 5,
        subtotal: 500,
        has_issues: false,
      });
      expect(active?.total).toBe(500);
    });

    it('retries when another device wrote in between', async () => {
      await service.addItem(PARTNER, TOKEN, { sku: 'K-1', quantity: 1 });

      // The other device adds K-2 right after this request reads the cart.
      const realFind = repo.findActive.getMockImplementation()!;
      repo.findActive.mockImplementationOnce(async (p) => {
        const snapshot = await realFind(p);
        active = {
          ...active!,
          items: [...active!.items, lineFrom(variant('K-2'), 1)],
          __v: active!.__v + 1,
        };
        return snapshot;
      });

      const view = await service.addItem(PARTNER, TOKEN, {
        sku: 'K-1',
        quantity: 1,
      });

      expect(repo.updateActive).toHaveBeenCalledTimes(2);
      expect(view.items.map((l) => [l.sku, l.quantity])).toEqual([
        ['K-1', 2],
        ['K-2', 1],
      ]);
    });

    it('gives up as CART_BUSY after repeated lost races', async () => {
      active = record({ items: [], subtotal: 0, total: 0, pii_id: 'PII-9' });
      repo.updateActive.mockResolvedValue(false);

      await expect(
        service.addItem(PARTNER, TOKEN, { sku: 'K-1', quantity: 1 }),
      ).rejects.toMatchObject({
        status: 409,
        response: { error: 'CART_BUSY' },
      });
      expect(repo.updateActive).toHaveBeenCalledTimes(6);
    });

    it('answers 404 for a pack not sold here, OUT_OF_STOCK for a sold-out one', async () => {
      await expect(
        service.addItem(PARTNER, TOKEN, { sku: 'K-x', quantity: 1 }),
      ).rejects.toMatchObject({ status: 404 });

      catalog.set('K-1', variant('K-1', { available_qty: 0 }));
      await expect(
        service.addItem(PARTNER, TOKEN, { sku: 'K-1', quantity: 1 }),
      ).rejects.toMatchObject({
        status: 409,
        response: { error: 'OUT_OF_STOCK' },
      });
      expect(repo.insertActive).not.toHaveBeenCalled();
    });
  });

  describe('get', () => {
    it('is an empty cart before anything was added, without writing', async () => {
      await expect(service.get(PARTNER, TOKEN)).resolves.toMatchObject({
        items: [],
        item_count: 0,
        subtotal: 0,
      });
      expect(repo.insertActive).not.toHaveBeenCalled();
    });

    it("prices at today's catalogue and flags a delisted pack", async () => {
      await service.addItem(PARTNER, TOKEN, { sku: 'K-1', quantity: 2 });
      await service.addItem(PARTNER, TOKEN, { sku: 'K-2', quantity: 1 });
      catalog.set('K-1', variant('K-1', { price: 120 }));
      catalog.delete('K-2');

      const view = await service.get(PARTNER, TOKEN);

      expect(
        view.items.map((l) => [l.sku, l.price, l.available, l.price_changed]),
      ).toEqual([
        ['K-1', 120, true, true],
        ['K-2', 100, false, false],
      ]);
      expect(view.has_issues).toBe(true);
    });
  });

  describe('setCustomer', () => {
    it('passes the phone fix on as where the farmer may be, never failing the cart', async () => {
      const at = { lat: 23.2, lng: 77.4 };
      await service.setCustomer(PARTNER, TOKEN, {
        pii_id: 'PII-1',
        location: at,
      });
      expect(leads.recordLocation).toHaveBeenCalledWith(
        'VST-000001',
        'PII-1',
        at,
      );

      leads.recordLocation.mockRejectedValueOnce(new Error('down'));
      const view = await service.setCustomer(PARTNER, TOKEN, {
        pii_id: 'PII-1',
        location: at,
      });
      expect(view.pii_id).toBe('PII-1');

      leads.recordLocation.mockClear();
      await service.setCustomer(PARTNER, TOKEN, { pii_id: null, location: at });
      expect(leads.recordLocation).not.toHaveBeenCalled();
    });

    it("stores the customer in pii_id, and the partner's own for shop stock", async () => {
      const first = await service.addItem(PARTNER, TOKEN, {
        sku: 'K-1',
        quantity: 1,
      });
      expect(first.pii_id).toBeNull();
      expect(active?.pii_id).toBe('PII-9');

      const forCustomer = await service.setCustomer(PARTNER, TOKEN, {
        pii_id: 'PII-1620388',
      });
      expect(forCustomer.pii_id).toBe('PII-1620388');
      expect(active?.pii_id).toBe('PII-1620388');

      const ownStock = await service.setCustomer(PARTNER, TOKEN, {
        pii_id: null,
      });
      expect(ownStock.pii_id).toBeNull();
      expect(active?.pii_id).toBe('PII-9');
      expect(active).not.toHaveProperty('user_id');
      expect(active?.items).toHaveLength(1);
    });

    it('refuses a person the partner does not hold in Leads, and leaves the cart as it was', async () => {
      await service.addItem(PARTNER, TOKEN, { sku: 'K-1', quantity: 1 });
      await service.setCustomer(PARTNER, TOKEN, { pii_id: 'PII-1' });
      const writes = repo.updateActive.mock.calls.length;

      await expect(
        service.setCustomer(PARTNER, TOKEN, { pii_id: 'PII-424242' }),
      ).rejects.toMatchObject({ status: 404 });

      expect(leads.holds).toHaveBeenCalledWith('VST-000001', 'PII-424242');
      expect(repo.updateActive).toHaveBeenCalledTimes(writes);
      expect(active?.pii_id).toBe('PII-1');
    });

    it("accepts the partner's own pii_id as shop stock without a lead lookup", async () => {
      const view = await service.setCustomer(PARTNER, TOKEN, {
        pii_id: 'PII-9',
      });

      expect(view.pii_id).toBeNull();
      expect(leads.holds).not.toHaveBeenCalled();
    });
  });

  describe('replace', () => {
    it('refuses to restore a cart for a person the partner does not hold in Leads', async () => {
      await expect(
        service.replace(
          PARTNER,
          TOKEN,
          [{ sku: 'K-1', quantity: 1 }],
          'PII-424242',
        ),
      ).rejects.toMatchObject({ status: 404 });

      expect(repo.insertActive).not.toHaveBeenCalled();
    });
  });

  describe('clear', () => {
    it('empties the lines and clears the customer', async () => {
      await service.addItem(PARTNER, TOKEN, { sku: 'K-1', quantity: 1 });
      await service.setCustomer(PARTNER, TOKEN, { pii_id: 'PII-1' });

      const view = await service.clear(PARTNER, TOKEN);

      expect(view).toMatchObject({ pii_id: null, items: [], subtotal: 0 });
      expect(active).toMatchObject({
        items: [],
        subtotal: 0,
        total: 0,
        pii_id: 'PII-9',
      });
    });
  });
});
