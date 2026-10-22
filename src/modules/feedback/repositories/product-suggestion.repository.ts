import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model, PipelineStage } from 'mongoose';

import { escapeRegex } from '@common/utils/regex.util';

import { type SuggestionStatus } from '../feedback.domain';
import { ProductSuggestion } from '../schemas/product-suggestion.schema';

export type SuggestionRow = ProductSuggestion;
export type NewSuggestion = Omit<
  ProductSuggestion,
  'created_at' | 'updated_at'
>;

export interface SuggestionFilter {
  status?: SuggestionStatus;
  agent_id?: string;
  start?: Date;
  end?: Date;
  q?: string;
}

export interface TopProduct {
  product_key: string;
  /** The latest spelling, as the desk shows it. */
  product: string;
  count: number;
  partners: number;
  crops: string[];
  last_at: Date;
}

/** Only bounds the crop list on one product card. */
const CROPS_PER_PRODUCT = 10;

@Injectable()
export class ProductSuggestionRepository {
  constructor(
    @InjectModel(ProductSuggestion.name)
    private readonly model: Model<ProductSuggestion>,
  ) {}

  async create(row: NewSuggestion): Promise<SuggestionRow> {
    const doc = await this.model.create(row);
    return doc.toObject<SuggestionRow>();
  }

  countSince(agentId: string, since: Date): Promise<number> {
    return this.model
      .countDocuments({ agent_id: agentId, created_at: { $gte: since } })
      .exec();
  }

  async page(
    filter: SuggestionFilter,
    skip: number,
    limit: number,
    sort: Record<string, 1 | -1>,
  ): Promise<{ rows: SuggestionRow[]; total: number }> {
    const query = queryOf(filter);
    const [rows, total] = await Promise.all([
      this.model
        .find(query)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean<SuggestionRow[]>()
        .exec(),
      this.model.countDocuments(query).exec(),
    ]);
    return { rows, total };
  }

  find(ref: string): Promise<SuggestionRow | null> {
    return this.model.findById(ref).lean<SuggestionRow>().exec();
  }

  update(
    ref: string,
    set: Partial<Pick<SuggestionRow, 'status' | 'ho_note' | 'updated_by'>>,
  ): Promise<SuggestionRow | null> {
    return this.model
      .findByIdAndUpdate(ref, { $set: set }, { returnDocument: 'after' })
      .lean<SuggestionRow>()
      .exec();
  }

  async statusCounts(): Promise<{ _id: SuggestionStatus; count: number }[]> {
    return this.model
      .aggregate<{ _id: SuggestionStatus; count: number }>([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ])
      .exec();
  }

  /** The most asked-for products in `[start, end)`. */
  async topProducts(
    start: Date,
    end: Date,
    limit: number,
  ): Promise<TopProduct[]> {
    const pipeline: PipelineStage[] = [
      { $match: { created_at: { $gte: start, $lt: end } } },
      { $sort: { created_at: -1 } },
      {
        $group: {
          _id: '$product_key',
          product: { $first: '$product' },
          count: { $sum: 1 },
          partners: { $addToSet: '$agent_id' },
          crops: { $addToSet: '$crop' },
          last_at: { $first: '$created_at' },
        },
      },
      { $sort: { count: -1, last_at: -1 } },
      { $limit: limit },
      {
        $project: {
          _id: 0,
          product_key: '$_id',
          product: 1,
          count: 1,
          partners: { $size: '$partners' },
          crops: {
            $slice: [
              {
                $filter: {
                  input: '$crops',
                  cond: { $ne: ['$$this', null] },
                },
              },
              CROPS_PER_PRODUCT,
            ],
          },
          last_at: 1,
        },
      },
    ];
    return this.model.aggregate<TopProduct>(pipeline).exec();
  }
}

function queryOf(filter: SuggestionFilter): Record<string, unknown> {
  const query: Record<string, unknown> = {};
  if (filter.status) query.status = filter.status;
  if (filter.agent_id) query.agent_id = filter.agent_id;
  if (filter.start || filter.end) {
    query.created_at = {
      ...(filter.start ? { $gte: filter.start } : {}),
      ...(filter.end ? { $lt: filter.end } : {}),
    };
  }
  const q = filter.q?.trim();
  if (q) {
    const re = { $regex: escapeRegex(q), $options: 'i' };
    query.$or = [
      { _id: re },
      { product: re },
      { crop: re },
      { note: re },
      { 'partner.name': re },
      { 'partner.phone': re },
    ];
  }
  return query;
}
