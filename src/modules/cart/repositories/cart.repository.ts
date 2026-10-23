import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { mongo, Types, type Model } from 'mongoose';

import type { CartLineData } from '../cart.domain';
import { Cart, CART_SOURCE, type CartRecord } from '../schemas/cart.schema';

/** What a cart write sets; ownership fields are the repository's job. */
export interface CartWrite {
  items: CartLineData[];
  subtotal: number;
  total: number;
  /** The farmer, or the partner's own `pii_id` for shop stock. */
  pii_id: string;
}

/**
 * A partner's cart lives at an `_id` derived from their id. The row itself
 * names only the person it is for (`pii_id`), as B2B's rows do; the `_id` is
 * what keeps it the partner's — only their id hashes to it, so two partners
 * ordering for one farmer still have two carts.
 *
 * "One cart per partner" then rests on the `_id` index, which every
 * collection has, instead of a unique index on a shared collection we may not
 * build: two first-adds racing from two phones produce one document and a
 * duplicate-key the loser retries, never two carts. It also makes the hot
 * read a primary-key lookup.
 */
export function activeCartId(partnerId: string): Types.ObjectId {
  const hex = createHash('sha256')
    .update(`${CART_SOURCE}:active-cart:${partnerId}`)
    .digest('hex');
  return new Types.ObjectId(hex.slice(0, 24));
}

@Injectable()
export class CartRepository {
  constructor(@InjectModel(Cart.name) private readonly model: Model<Cart>) {}

  findActive(partnerId: string): Promise<CartRecord | null> {
    return this.model
      .findOne(this.activeFilter(partnerId))
      .lean<CartRecord>()
      .exec();
  }

  /** `false` when another request created it first — re-read and retry. */
  async insertActive(partnerId: string, data: CartWrite): Promise<boolean> {
    try {
      await this.model.create({
        _id: activeCartId(partnerId),
        source: CART_SOURCE,
        ...data,
      });
      return true;
    } catch (error) {
      if (error instanceof mongo.MongoServerError && error.code === 11000) {
        return false;
      }
      throw error;
    }
  }

  /** `false` when the cart moved past `version` (`__v`) since it was read. */
  async updateActive(
    partnerId: string,
    version: number,
    data: CartWrite,
  ): Promise<boolean> {
    const result = await this.model
      .updateOne(
        { ...this.activeFilter(partnerId), __v: version },
        {
          $set: data,
          // Rows written before 2026-10-09 still carry it; B2B's never do.
          $unset: { user_id: 1 },
          $inc: { __v: 1 },
        },
        { strict: false },
      )
      .exec();
    return result.matchedCount === 1;
  }

  /**
   * HO's read: the carts behind these `_id`s that still hold a line, last
   * touched first. The row names no partner, so the caller passes the ids of
   * the partners it wants (`activeCartId`) — a primary-key `$in`.
   */
  async adminList(
    ids: readonly Types.ObjectId[],
    skip: number,
    limit: number,
  ): Promise<[CartRecord[], number]> {
    const filter = this.adminFilter(ids);
    return Promise.all([
      this.model
        .find(filter)
        .sort({ updated_at: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean<CartRecord[]>()
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);
  }

  /**
   * HO's cards for the same carts as `adminList`, in one pass: how many,
   * Σ subtotal as the list shows it, Σ units, and how many were last
   * touched before `staleBefore`.
   */
  async adminSummary(
    ids: readonly Types.ObjectId[],
    staleBefore: Date,
  ): Promise<{ carts: number; value: number; items: number; stale: number }> {
    const [out] = await this.model
      .aggregate<{
        carts: number;
        value: number;
        items: number;
        stale: number;
      }>([
        { $match: this.adminFilter(ids) },
        {
          $group: {
            _id: null,
            carts: { $sum: 1 },
            // The list's `subtotal`: the stored one, else its lines' totals.
            value: {
              $sum: { $ifNull: ['$subtotal', { $sum: '$items.total' }] },
            },
            items: { $sum: { $sum: '$items.quantity' } },
            stale: {
              $sum: { $cond: [{ $lt: ['$updated_at', staleBefore] }, 1, 0] },
            },
          },
        },
      ])
      .exec();
    return {
      carts: out?.carts ?? 0,
      value: out?.value ?? 0,
      items: out?.items ?? 0,
      stale: out?.stale ?? 0,
    };
  }

  /** The carts behind these `_id`s that still hold a line — the list and its cards. */
  private adminFilter(ids: readonly Types.ObjectId[]) {
    return {
      _id: { $in: ids },
      source: CART_SOURCE,
      'items.0': { $exists: true },
    };
  }

  // `source` is in every filter beside the `_id`: it keeps Vistaar off B2B's
  // and the retailer app's rows.
  private activeFilter(partnerId: string) {
    return { _id: activeCartId(partnerId), source: CART_SOURCE };
  }
}
