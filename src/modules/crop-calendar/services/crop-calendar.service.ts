import { Injectable } from '@nestjs/common';
import { mongo } from 'mongoose';

import { badRequest, conflict, notFound } from '@common/errors/api-error';
import { PageResult } from '@common/http/page-result';

import { stagesError, type CropStage } from '../crop-calendar.domain';
import type {
  CreateCropDto,
  CropListQueryDto,
  UpdateCropDto,
} from '../dto/crop-calendar.dto';
import { CropCalendarRepository } from '../repositories/crop-calendar.repository';
import type { CropCalendarEntry } from '../schemas/crop-calendar.schema';

/** What the app reads: the entry with its key as `id`. */
export type CropView = Omit<
  CropCalendarEntry,
  | '_id'
  | 'created_by'
  | 'updated_by'
  | 'created_at'
  | 'updated_at'
  | 'is_active'
  | 'order'
> & { id: string };

const ACTIVE_TTL_MS = 60_000;

const isDuplicateKey = (error: unknown): boolean =>
  error instanceof mongo.MongoServerError && error.code === 11000;

const CROP_NOT_FOUND =
  'This crop could not be found. It may have been deleted.';

@Injectable()
export class CropCalendarService {
  /** Read by every partner, changed by HO a few times a season: re-read at most once a minute. */
  private active: { at: number; rows: CropView[] } | null = null;

  constructor(private readonly crops: CropCalendarRepository) {}

  async live(): Promise<CropView[]> {
    if (this.active && Date.now() - this.active.at < ACTIVE_TTL_MS) {
      return this.active.rows;
    }
    const rows = (await this.crops.listActive()).map(toView);
    this.active = { at: Date.now(), rows };
    return rows;
  }

  async list(query: CropListQueryDto): Promise<PageResult<CropCalendarEntry>> {
    const { rows, total } = await this.crops.page(
      { season: query.season, is_active: query.is_active },
      query.skip,
      query.limit,
      query.sortSpec,
    );
    return new PageResult(rows, total, query);
  }

  async get(key: string): Promise<CropCalendarEntry> {
    const crop = await this.crops.find(key);
    if (!crop) throw notFound(CROP_NOT_FOUND);
    return crop;
  }

  async create(dto: CreateCropDto, by: string): Promise<CropCalendarEntry> {
    const stages = checkedStages(dto.stages);
    try {
      const saved = await this.crops.create({
        _id: dto.key,
        crop: dto.crop.trim(),
        emoji: dto.emoji ?? null,
        season: dto.season,
        sowing: dto.sowing.trim(),
        harvest: dto.harvest.trim(),
        stages,
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
          'CROP_EXISTS',
          `A crop with the code "${dto.key}" already exists. Please use a different code or edit that crop.`,
        );
      }
      throw error;
    }
  }

  async update(
    key: string,
    dto: UpdateCropDto,
    by: string,
  ): Promise<CropCalendarEntry> {
    const { stages, ...rest } = dto;
    // A validated DTO carries every declared field, `undefined` when not sent.
    const sent = Object.entries(rest).filter(([, v]) => v !== undefined);
    const set: Partial<CropCalendarEntry> = {
      ...(Object.fromEntries(sent) as Partial<CropCalendarEntry>),
      updated_by: by,
    };
    if (stages !== undefined) set.stages = checkedStages(stages);
    const updated = await this.crops.update(key, set);
    if (!updated) throw notFound(CROP_NOT_FOUND);
    this.active = null;
    return updated;
  }

  /** Saved stories keep their own text, so a deleted crop changes none of them. */
  async remove(key: string): Promise<{ deleted: true }> {
    if (!(await this.crops.remove(key))) throw notFound(CROP_NOT_FOUND);
    this.active = null;
    return { deleted: true };
  }
}

function checkedStages(stages: CropStage[]): CropStage[] {
  const clean = stages.map((s) => ({
    stage: s.stage.trim(),
    month: s.month.trim(),
    advice: s.advice.trim(),
    products: s.products.map((p) => p.trim()).filter(Boolean),
  }));
  const error = stagesError(clean);
  if (error) throw badRequest('VALIDATION_FAILED', error, [error]);
  return clean;
}

function toView(c: CropCalendarEntry): CropView {
  return {
    id: c._id,
    crop: c.crop,
    emoji: c.emoji,
    season: c.season,
    sowing: c.sowing,
    harvest: c.harvest,
    stages: c.stages,
  };
}
