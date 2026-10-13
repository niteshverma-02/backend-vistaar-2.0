import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { mongo } from 'mongoose';

import { conflict, notFound } from '@common/errors/api-error';
import { PageResult } from '@common/http/page-result';

import type {
  CreateStorySampleDto,
  StorySampleListQueryDto,
  UpdateStorySampleDto,
} from '../dto/story-sample.dto';
import { StorySampleRepository } from '../repositories/story-sample.repository';
import type { StorySample } from '../schemas/story-sample.schema';

const SAMPLE_NOT_FOUND =
  'This farmer story could not be found. It may have been deleted.';

const ACTIVE_TTL_MS = 60_000;

const isDuplicateKey = (error: unknown): boolean =>
  error instanceof mongo.MongoServerError && error.code === 11000;

/** HO's ready-made farmer quotes for the "Farmer story" template. */
@Injectable()
export class StorySamplesService {
  /** Each instance re-reads at most once a minute; an HO edit shows within that minute. */
  private active: { at: number; rows: StorySample[] } | null = null;

  constructor(private readonly samples: StorySampleRepository) {}

  async live(): Promise<StorySample[]> {
    if (this.active && Date.now() - this.active.at < ACTIVE_TTL_MS) {
      return this.active.rows;
    }
    const rows = await this.samples.listActive();
    this.active = { at: Date.now(), rows };
    return rows;
  }

  async list(query: StorySampleListQueryDto): Promise<PageResult<StorySample>> {
    const { rows, total } = await this.samples.page(
      query.is_active,
      query.skip,
      query.limit,
      query.sortSpec,
    );
    return new PageResult(rows, total, query);
  }

  async get(id: string): Promise<StorySample> {
    const sample = await this.samples.find(id);
    if (!sample) throw notFound(SAMPLE_NOT_FOUND);
    return sample;
  }

  async create(dto: CreateStorySampleDto, by: string): Promise<StorySample> {
    try {
      const saved = await this.samples.create({
        _id: randomUUID(),
        key: dto.key,
        name: dto.name.trim(),
        village: dto.village?.trim() || null,
        district: dto.district?.trim() || null,
        state: dto.state?.trim() || null,
        product: dto.product.trim(),
        crop: dto.crop?.trim() || null,
        quote: dto.quote.trim(),
        stars: dto.stars ?? 5,
        order: dto.order ?? 0,
        is_active: dto.is_active ?? true,
        created_by: by,
        updated_by: by,
      });
      this.active = null;
      return saved;
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw conflict(
          'SAMPLE_EXISTS',
          'This farmer story already exists. Please use a different short name.',
        );
      }
      throw error;
    }
  }

  async update(
    id: string,
    dto: UpdateStorySampleDto,
    by: string,
  ): Promise<StorySample> {
    // A validated DTO carries every declared field, `undefined` when not sent.
    const sent = Object.entries(dto).filter(([, v]) => v !== undefined);
    const updated = await this.samples.update(id, {
      ...(Object.fromEntries(sent) as Partial<StorySample>),
      updated_by: by,
    });
    if (!updated) throw notFound(SAMPLE_NOT_FOUND);
    this.active = null;
    return updated;
  }

  async remove(id: string): Promise<{ deleted: true }> {
    if (!(await this.samples.remove(id))) {
      throw notFound(SAMPLE_NOT_FOUND);
    }
    this.active = null;
    return { deleted: true };
  }
}
