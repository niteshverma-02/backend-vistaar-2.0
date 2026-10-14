import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

/** What commission and performance need about a pack, keyed by its sku. */
export interface ProductFact {
  name: string | null;
  /** `hero_image` (else the first of `images`) as stored — may hold two URLs run together. */
  image: string | null;
  /** Pack size, for an order line's label. */
  variant: { value?: string | number; uom?: string } | null;
  item_qty: string | number | null;
  /** GST % of the pack's bulk; `null` when the catalogue has none. */
  gst_rate: number | null;
  /** `categories_v2.name`; `null` when the bulk has no category. */
  category: string | null;
}

interface ProductRow {
  sku: string;
  name?: string;
  hero_image?: string;
  images?: string[];
  variant?: { value?: string | number; uom?: string };
  item_qty?: string | number;
  bulk?: { sku?: string } | null;
}

interface BulkRow {
  sku: string;
  gst_rate?: string | number;
  category?: { cat_id?: string } | null;
}

interface CategoryRow {
  category_id: string;
  name?: string;
}

/**
 * Stockship's catalogue (`products_v2` → `bulk_v2` → `categories_v2`),
 * read whole and joined here: ~4,900 packs, ~1,200 bulks, 7 categories
 * (2026-10-14), ~2 MB in memory. Read-only.
 */
@Injectable()
export class ProductFactsRepository {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async all(): Promise<Map<string, ProductFact>> {
    const [products, bulks, categories] = await Promise.all([
      this.connection
        .collection<ProductRow>('products_v2')
        .find(
          { sku: { $type: 'string' } },
          {
            projection: {
              _id: 0,
              sku: 1,
              name: 1,
              hero_image: 1,
              images: { $slice: 1 },
              variant: 1,
              item_qty: 1,
              'bulk.sku': 1,
            },
          },
        )
        .toArray(),
      this.connection
        .collection<BulkRow>('bulk_v2')
        .find(
          { sku: { $type: 'string' } },
          {
            projection: { _id: 0, sku: 1, gst_rate: 1, 'category.cat_id': 1 },
          },
        )
        .toArray(),
      this.connection
        .collection<CategoryRow>('categories_v2')
        .find({}, { projection: { _id: 0, category_id: 1, name: 1 } })
        .toArray(),
    ]);

    const categoryName = new Map(
      categories.map((c) => [c.category_id, c.name ?? null]),
    );
    const bySku = new Map(bulks.map((b) => [b.sku, b]));

    return new Map(
      products.map((p) => {
        const bulk = p.bulk?.sku ? bySku.get(p.bulk.sku) : undefined;
        return [
          p.sku,
          {
            name: p.name ?? null,
            image: p.hero_image || p.images?.[0] || null,
            variant: p.variant ?? null,
            item_qty: p.item_qty ?? null,
            gst_rate: gstOf(bulk?.gst_rate),
            category: bulk?.category?.cat_id
              ? (categoryName.get(bulk.category.cat_id) ?? null)
              : null,
          },
        ];
      }),
    );
  }
}

/** `"5"` / `"18"` → 5 / 18; a spreadsheet leftover such as `"#REF!"` → `null`. */
function gstOf(value: string | number | undefined): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return value !== undefined && value !== '' && Number.isFinite(n) && n >= 0
    ? n
    : null;
}
