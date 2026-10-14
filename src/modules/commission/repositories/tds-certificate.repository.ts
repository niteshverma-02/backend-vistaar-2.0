import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import {
  TdsCertificate,
  type TdsCertificateDocument,
} from '../schemas/tds-certificate.schema';

export type TdsCertificateRecord = TdsCertificate;

export const certificateId = (agentId: string, quarter: string): string =>
  `${agentId}:${quarter}`;

@Injectable()
export class TdsCertificateRepository {
  constructor(
    @InjectModel(TdsCertificate.name)
    private readonly model: Model<TdsCertificateDocument>,
  ) {}

  find(agentId: string, quarter: string): Promise<TdsCertificateRecord | null> {
    return this.model
      .findById(certificateId(agentId, quarter))
      .lean<TdsCertificateRecord | null>()
      .exec();
  }

  /** Puts the file on the quarter; the previous file's path, so it can be removed. */
  async put(
    agentId: string,
    quarter: string,
    path: string,
    by: string,
  ): Promise<string | null> {
    const before = await this.model
      .findOneAndUpdate(
        { _id: certificateId(agentId, quarter) },
        {
          $set: { path, uploaded_by: by },
          $setOnInsert: { agent_id: agentId, quarter },
        },
        { upsert: true, returnDocument: 'before' },
      )
      .lean<TdsCertificateRecord | null>()
      .exec();
    return before?.path ?? null;
  }

  forAgents(
    quarter: string,
    agentIds: readonly string[],
  ): Promise<TdsCertificateRecord[]> {
    return this.model
      .find({ _id: { $in: agentIds.map((a) => certificateId(a, quarter)) } })
      .lean<TdsCertificateRecord[]>()
      .exec();
  }

  async list(
    quarter: string,
    agentId: string | null,
    page: { skip: number; limit: number },
  ): Promise<{ items: TdsCertificateRecord[]; total: number }> {
    const query = { quarter, ...(agentId ? { agent_id: agentId } : {}) };
    const [items, total] = await Promise.all([
      this.model
        .find(query)
        .sort({ agent_id: 1 })
        .skip(page.skip)
        .limit(page.limit)
        .lean<TdsCertificateRecord[]>()
        .exec(),
      this.model.countDocuments(query).exec(),
    ]);
    return { items, total };
  }

  /** The removed certificate, so its file can go too; `null` when there was none. */
  remove(
    agentId: string,
    quarter: string,
  ): Promise<TdsCertificateRecord | null> {
    return this.model
      .findOneAndDelete({ _id: certificateId(agentId, quarter) })
      .lean<TdsCertificateRecord | null>()
      .exec();
  }
}
