import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, type QueryFilter } from 'mongoose';

import { isDuplicateKey } from '@common/utils/mongo-error.util';

import { VISTAAR_PROFILE } from '../terms.domain';
import {
  TermsAndConditions,
  type TermsHydrated,
} from '../schemas/terms.schema';

/** Every read and write is held to Vistaar's rows; the other apps' are never touched. */
const OURS = { profiles: VISTAAR_PROFILE };

@Injectable()
export class TermsRepository {
  constructor(
    @InjectModel(TermsAndConditions.name)
    private readonly model: Model<TermsHydrated>,
  ) {}

  /** The newest active Vistaar row. */
  live(): Promise<TermsAndConditions | null> {
    return this.model
      .findOne({ ...OURS, is_active: true })
      .sort({ _id: -1 })
      .lean<TermsAndConditions | null>()
      .exec();
  }

  async page(
    isActive: boolean | undefined,
    skip: number,
    limit: number,
    sort: Record<string, 1 | -1>,
  ): Promise<{ rows: TermsAndConditions[]; total: number }> {
    const query: QueryFilter<TermsAndConditions> = { ...OURS };
    if (isActive !== undefined) query.is_active = isActive;
    const [rows, total] = await Promise.all([
      this.model
        .find(query)
        .sort({ ...sort, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean<TermsAndConditions[]>()
        .exec(),
      this.model.countDocuments(query).exec(),
    ]);
    return { rows, total };
  }

  find(tocId: string): Promise<TermsAndConditions | null> {
    return this.model
      .findOne({ ...OURS, toc_id: tocId })
      .lean<TermsAndConditions | null>()
      .exec();
  }

  /**
   * The highest `TOC-n` in use by **any** app: the series is the
   * collection's, not ours, and `toc_id` is unique across it.
   */
  async lastTocNumber(): Promise<number> {
    const [row] = await this.model
      .aggregate<{ n: number }>([
        { $match: { toc_id: { $regex: /^TOC-\d+$/ } } },
        {
          $project: {
            n: { $toInt: { $substrCP: ['$toc_id', 4, 12] } },
          },
        },
        { $sort: { n: -1 } },
        { $limit: 1 },
      ])
      .exec();
    return row?.n ?? 0;
  }

  /** `null` when the `toc_id` was taken meanwhile (the collection's unique index). */
  async insert(
    row: Pick<TermsAndConditions, 'toc_id' | 'title' | 'link' | 'is_active'>,
  ): Promise<TermsAndConditions | null> {
    try {
      const doc = await this.model.create({
        ...row,
        profiles: [VISTAAR_PROFILE],
      });
      return doc.toObject<TermsAndConditions>();
    } catch (error) {
      if (isDuplicateKey(error)) return null;
      throw error;
    }
  }

  /** A new title or link is a new version of the same row; switching on/off is not. */
  update(
    tocId: string,
    set: Partial<Pick<TermsAndConditions, 'title' | 'link' | 'is_active'>>,
  ): Promise<TermsAndConditions | null> {
    const edited = set.title !== undefined || set.link !== undefined;
    return this.model
      .findOneAndUpdate(
        { ...OURS, toc_id: tocId },
        { $set: set, ...(edited ? { $inc: { __v: 1 } } : {}) },
        { returnDocument: 'after' },
      )
      .lean<TermsAndConditions | null>()
      .exec();
  }

  /**
   * The next version of a row's document, only over the version the editor
   * opened; `null` when someone saved first or the row is gone.
   */
  replaceDocument(
    tocId: string,
    version: number,
    set: Pick<TermsAndConditions, 'title' | 'link'>,
  ): Promise<TermsAndConditions | null> {
    return this.model
      .findOneAndUpdate(
        { ...OURS, toc_id: tocId, __v: version },
        { $set: set, $inc: { __v: 1 } },
        { returnDocument: 'after' },
      )
      .lean<TermsAndConditions | null>()
      .exec();
  }

  /** One active Vistaar T&C at a time: switches off every other one. */
  async deactivateOthers(tocId: string): Promise<void> {
    await this.model
      .updateMany(
        { ...OURS, is_active: true, toc_id: { $ne: tocId } },
        { $set: { is_active: false } },
      )
      .exec();
  }

  /** Only a switched-off row; `false` when there is none such. */
  async removeInactive(tocId: string): Promise<boolean> {
    const res = await this.model
      .deleteOne({ ...OURS, toc_id: tocId, is_active: false })
      .exec();
    return res.deletedCount === 1;
  }
}
