import {
  RECENT_SEARCH_LIMIT,
  applyRecentSearch,
  variantsFromMarketplaceItem,
} from './catalog.domain';

const pack = (overrides: Record<string, unknown> = {}) => ({
  sku: 'K-350',
  is_priced: true,
  display_name: 'Display',
  variant: { value: '1', uom: 'L' },
  item_qty: '1',
  dp: 1895,
  mrp: 3829,
  gst_rate: 18,
  images: ['https://img/variant.webp'],
  avl_qty: { available_qty: 12 },
  ...overrides,
});

describe('variantsFromMarketplaceItem', () => {
  it('maps a priced pack the way the app labels it', () => {
    const [v] = variantsFromMarketplaceItem({
      bulk_sku: 'BK-629',
      name: '2IN1',
      image: 'https://img/product.webp',
      variants: [pack()],
    });

    expect(v).toEqual({
      sku: 'K-350',
      product_id: 'BK-629',
      product_name: '2IN1',
      product_image: 'https://img/product.webp',
      size_label: '1 L',
      packaging_size: '1',
      uom: 'l',
      moq: 1,
      price: 1895,
      mrp: 3829,
      gst: 18,
      available_qty: 12,
    });
  });

  it('labels multi-unit packs and de-duplicates repeated labels', () => {
    const variants = variantsFromMarketplaceItem({
      bulk_sku: 'BK-1',
      variants: [
        pack({ sku: 'K-1', item_qty: '5' }),
        pack({ sku: 'K-2', item_qty: '5' }),
      ],
    });

    expect(variants.map((v) => v.size_label)).toEqual([
      '1 L × 5',
      '1 L × 5 (K-2)',
    ]);
  });

  it('stores the pack weight the way B2B carts do: grams to kg', () => {
    const [v] = variantsFromMarketplaceItem({
      bulk_sku: 'BK-1',
      variants: [
        pack({ variant: { value: '460', uom: 'gm' }, item_qty: '2', moq: 3 }),
      ],
    });

    expect(v).toMatchObject({ packaging_size: '0.92', uom: 'kg', moq: 3 });
  });

  it('drops unpriced packs and survives a malformed payload', () => {
    expect(
      variantsFromMarketplaceItem({
        bulk_sku: 'BK-1',
        variants: [pack({ is_priced: false }), pack({ dp: 0 }), 'junk'],
      }),
    ).toEqual([]);
    expect(variantsFromMarketplaceItem(null)).toEqual([]);
    expect(variantsFromMarketplaceItem({ variants: [pack()] })).toEqual([]);
  });

  it('falls back to the pack image and display name', () => {
    const [v] = variantsFromMarketplaceItem({
      bulk_sku: 'BK-1',
      variants: [pack()],
    });

    expect(v.product_image).toBe('https://img/variant.webp');
    expect(v.product_name).toBe('Display');
  });
});

describe('applyRecentSearch', () => {
  it('puts the new term first', () => {
    expect(applyRecentSearch(['urea'], 'humic acid')).toEqual([
      'humic acid',
      'urea',
    ]);
  });

  it('moves a repeated term to the front instead of duplicating it', () => {
    expect(applyRecentSearch(['urea', 'humic acid'], 'urea')).toEqual([
      'urea',
      'humic acid',
    ]);
  });

  it('matches a repeat case-insensitively', () => {
    expect(applyRecentSearch(['Urea'], 'urea')).toEqual(['urea']);
  });

  it('caps the list at RECENT_SEARCH_LIMIT, dropping the oldest', () => {
    const terms = Array.from({ length: RECENT_SEARCH_LIMIT }, (_, i) =>
      String(i),
    );
    const result = applyRecentSearch(terms, 'new');
    expect(result).toHaveLength(RECENT_SEARCH_LIMIT);
    expect(result[0]).toBe('new');
    expect(result).not.toContain(String(RECENT_SEARCH_LIMIT - 1));
  });
});
