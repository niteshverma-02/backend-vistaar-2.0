import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { isDuplicateKey } from '@common/utils/mongo-error.util';

import type { InfoPageKey } from '../info-pages.domain';
import { InfoPage, type InfoPageDocument } from '../schemas/info-page.schema';

@Injectable()
export class InfoPageRepository {
  constructor(
    @InjectModel(InfoPage.name) private readonly model: Model<InfoPageDocument>,
  ) {}

  find(page: InfoPageKey): Promise<InfoPage | null> {
    return this.model.findById(page).lean<InfoPage | null>().exec();
  }

  /** `null` when the page already exists. */
  async create(
    page: InfoPageKey,
    content: unknown,
    by: string,
  ): Promise<InfoPage | null> {
    try {
      const doc = await this.model.create({
        _id: page,
        content,
        version: 1,
        created_by: by,
        updated_by: by,
      });
      return doc.toObject<InfoPage>();
    } catch (error) {
      if (isDuplicateKey(error)) return null;
      throw error;
    }
  }

  /** Writes only over `version`; `null` when another save got there first or the page is gone. */
  update(
    page: InfoPageKey,
    content: unknown,
    version: number,
    by: string,
  ): Promise<InfoPage | null> {
    return this.model
      .findOneAndUpdate(
        { _id: page, version },
        { $set: { content, updated_by: by }, $inc: { version: 1 } },
        { returnDocument: 'after' },
      )
      .lean<InfoPage | null>()
      .exec();
  }

  async remove(page: InfoPageKey): Promise<boolean> {
    const { deletedCount } = await this.model.deleteOne({ _id: page }).exec();
    return deletedCount === 1;
  }
}
