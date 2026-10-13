import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

interface ProductRow {
  sku: string;
  name?: string;
  hero_image?: string;
  images?: string[];
  variant?: { value?: string | number; uom?: string };
  item_qty?: string | number;
}

export type OrderProduct = Omit<ProductRow, 'sku'>;

/**
 * Names and pictures for an order's lines, from Stockship's `products_v2`.
 * Orders store only the sku. Read-only, on its `sku` index; no B2B token
 * needed, so an old order still shows a product the marketplace no longer
 * sells.
 */
@Injectable()
export class ProductLookupRepository {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async bySku(skus: Iterable<string>): Promise<Map<string, OrderProduct>> {
    const wanted = [...new Set(skus)];
    if (wanted.length === 0) return new Map();

    const rows = await this.connection
      .collection<ProductRow>('products_v2')
      .find(
        { sku: { $in: wanted } },
        {
          projection: {
            _id: 0,
            sku: 1,
            name: 1,
            hero_image: 1,
            images: { $slice: 1 },
            variant: 1,
            item_qty: 1,
          },
        },
      )
      .toArray();

    return new Map(rows.map(({ sku, ...rest }) => [sku, rest]));
  }
}
