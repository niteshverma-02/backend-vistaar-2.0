import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { mongo } from 'mongoose';

import { badRequest, conflict, notFound } from '@common/errors/api-error';
import { PageResult } from '@common/http/page-result';
import { imageInfo } from '@common/utils/image-size.util';
import { TtlCache } from '@common/utils/ttl-cache';
import type { Localized } from '@modules/onboarding/form.domain';
import { StorageService } from '@modules/uploads/services/storage.service';

import type {
  CreateStoryDesignDto,
  StoryDesignListQueryDto,
  UpdateStoryDesignDto,
  UploadedDesignImageDto,
} from '../dto/story-design.dto';
import { StoryDesignRepository } from '../repositories/story-design.repository';
import type { StoryDesign } from '../schemas/story-design.schema';
import {
  DEFAULT_IMAGE_OVERLAY,
  DESIGN_IMAGE_FOLDER,
  DESIGN_IMAGE_HINT,
  completeColors,
  designImageError,
  designWarnings,
  festivalStatus,
  windowError,
  type DesignColorKey,
  type DesignColors,
  type FestivalStatus,
  type StoryTemplate,
} from '../stories.domain';

const DESIGN_NOT_FOUND =
  'This design could not be found. It may have been deleted.';

/** What the app's design picker reads. */
export interface PartnerDesignView {
  key: string;
  label: Localized;
  colors: DesignColors;
  /** HO's art; `url` never changes for a path, so the app caches by it. */
  image: { url: string; width: number | null; height: number | null } | null;
  overlay: number;
  templates: StoryTemplate[];
}

export type AdminDesignView = StoryDesign & {
  status: FestivalStatus;
  /** Readability advice for the form; never blocks a save. */
  warnings: string[];
};

interface ImageFields {
  image_path: string | null;
  image_url: string | null;
  image_width: number | null;
  image_height: number | null;
}

const NO_IMAGE: ImageFields = {
  image_path: null,
  image_url: null,
  image_width: null,
  image_height: null,
};

const ACTIVE_TTL_MS = 60_000;

const isDuplicateKey = (error: unknown): boolean =>
  error instanceof mongo.MongoServerError && error.code === 11000;

/** HO's story designs: colours and optional art for My Story. */
@Injectable()
export class StoryDesignsService {
  /** Each instance re-reads at most once a minute; an HO edit shows within that minute. */
  private readonly active = new TtlCache<StoryDesign[]>(ACTIVE_TTL_MS, 1);

  constructor(
    private readonly designs: StoryDesignRepository,
    private readonly storage: StorageService,
  ) {}

  /** Live ones, picker order. */
  async live(): Promise<PartnerDesignView[]> {
    const now = new Date();
    return (await this.activeRows())
      .filter((d) => festivalStatus(d, now) === 'live')
      .map(toPartnerView);
  }

  /** For a template's `default_design`: any design HO made, live or not. */
  async exists(key: string): Promise<boolean> {
    return (await this.designs.findByKey(key)) !== null;
  }

  /** The type and size come from the bytes, not from what the browser claims. */
  async uploadImage(buffer: Buffer): Promise<UploadedDesignImageDto> {
    const info = imageInfo(buffer);
    if (!info) {
      throw badRequest(
        'FILE_TYPE_NOT_ALLOWED',
        `This file is not a supported image. Please use ${DESIGN_IMAGE_HINT}.`,
      );
    }
    const sizeError = designImageError(info.width, info.height);
    if (sizeError) {
      throw badRequest('IMAGE_SIZE_NOT_ALLOWED', sizeError, [sizeError]);
    }
    const { path, url } = await this.storage.savePublic(
      DESIGN_IMAGE_FOLDER,
      buffer,
      info.mime,
      { width: String(info.width), height: String(info.height) },
    );
    return {
      path,
      url,
      content_type: info.mime,
      size: buffer.length,
      width: info.width,
      height: info.height,
    };
  }

  async list(
    query: StoryDesignListQueryDto,
  ): Promise<PageResult<AdminDesignView>> {
    const now = new Date();
    const { rows, total } = await this.designs.page(
      query.status,
      now,
      query.skip,
      query.limit,
      query.sortSpec,
    );
    return new PageResult(
      rows.map((d) => toAdminView(d, now)),
      total,
      query,
    );
  }

  async get(id: string): Promise<AdminDesignView> {
    return toAdminView(await this.require(id), new Date());
  }

  async create(
    dto: CreateStoryDesignDto,
    by: string,
  ): Promise<AdminDesignView> {
    checkLabel(dto.label);
    const colors = paletteOf(dto.colors);
    const startsAt = toDate(dto.starts_at);
    const endsAt = toDate(dto.ends_at);
    checkWindow(startsAt, endsAt);
    const image = await this.resolveImage(dto.image ?? null);
    try {
      const saved = await this.designs.create({
        _id: randomUUID(),
        key: dto.key,
        label: dto.label,
        colors,
        ...image,
        overlay: overlayFor(dto.overlay, image.image_path !== null),
        templates: unique(dto.templates ?? []),
        starts_at: startsAt,
        ends_at: endsAt,
        order: dto.order ?? 0,
        is_active: dto.is_active ?? true,
        created_by: by,
        updated_by: by,
      });
      this.active.delete('active');
      return toAdminView(saved, new Date());
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw conflict(
          'DESIGN_EXISTS',
          'This design already exists. Please use a different short name.',
        );
      }
      throw error;
    }
  }

  async update(
    id: string,
    dto: UpdateStoryDesignDto,
    by: string,
  ): Promise<AdminDesignView> {
    if (dto.label !== undefined) checkLabel(dto.label);
    const current = await this.require(id);
    const { colors, image, overlay, templates, starts_at, ends_at, ...rest } =
      dto;
    // A validated DTO carries every declared field, `undefined` when not sent.
    const sent = Object.entries(rest).filter(([, v]) => v !== undefined);
    const set: Partial<StoryDesign> = {
      ...(Object.fromEntries(sent) as Partial<StoryDesign>),
      updated_by: by,
    };
    if (colors !== undefined) set.colors = paletteOf(colors);
    if (templates !== undefined) set.templates = unique(templates);
    if (starts_at !== undefined) set.starts_at = toDate(starts_at);
    if (ends_at !== undefined) set.ends_at = toDate(ends_at);
    const imageChanged = image !== undefined && image !== current.image_path;
    if (imageChanged) Object.assign(set, await this.resolveImage(image));
    const hasImage = (set.image_path ?? current.image_path) !== null;
    if (overlay !== undefined) {
      set.overlay = overlayFor(overlay, hasImage);
    } else if (imageChanged && current.image_path === null) {
      // Art added to a colours-only design: start from the readable default.
      set.overlay = overlayFor(undefined, hasImage);
    }
    const merged = { ...current, ...set };
    checkWindow(merged.starts_at, merged.ends_at);

    const updated = await this.designs.update(id, set);
    if (!updated) throw notFound(DESIGN_NOT_FOUND);
    this.active.delete('active');
    if (imageChanged) await this.dropImage(current.image_path);
    return toAdminView(updated, new Date());
  }

  /**
   * A saved story keeps its finished image, so deleting a design never
   * changes one; "Edit" on it opens on the app's default design.
   */
  async remove(id: string): Promise<{ deleted: true }> {
    const current = await this.require(id);
    if (!(await this.designs.remove(id))) throw notFound(DESIGN_NOT_FOUND);
    this.active.delete('active');
    await this.dropImage(current.image_path);
    return { deleted: true };
  }

  private async activeRows(): Promise<StoryDesign[]> {
    return this.active.get('active', () => this.designs.listActive(new Date()));
  }

  private async require(id: string): Promise<StoryDesign> {
    const design = await this.designs.find(id);
    if (!design) throw notFound(DESIGN_NOT_FOUND);
    return design;
  }

  /** The stored URL and size of an uploaded image, read once at save time. */
  private async resolveImage(path: string | null): Promise<ImageFields> {
    if (!path) return NO_IMAGE;
    const file = await this.storage.publicFile(path);
    if (!file) {
      throw badRequest(
        'IMAGE_NOT_FOUND',
        'The image was not found. Please upload it again.',
      );
    }
    return {
      image_path: path,
      image_url: file.url,
      image_width: Number(file.extra.width) || null,
      image_height: Number(file.extra.height) || null,
    };
  }

  /** Two designs can share art, so the file goes only with its last user. */
  private async dropImage(path: string | null): Promise<void> {
    if (!path || (await this.designs.countByImage(path)) > 0) return;
    await this.storage.remove(path);
  }
}

function toPartnerView(d: StoryDesign): PartnerDesignView {
  return {
    key: d.key,
    label: d.label,
    colors: d.colors,
    image: d.image_url
      ? { url: d.image_url, width: d.image_width, height: d.image_height }
      : null,
    overlay: d.image_url ? d.overlay : 0,
    templates: d.templates,
  };
}

function toAdminView(d: StoryDesign, now: Date): AdminDesignView {
  return {
    ...d,
    status: festivalStatus(d, now),
    warnings: designWarnings(d.colors, d.image_path !== null),
  };
}

function paletteOf(
  input: Partial<Record<DesignColorKey, string>>,
): DesignColors {
  const result = completeColors(input);
  if ('error' in result) {
    throw badRequest('VALIDATION_FAILED', result.error, [result.error]);
  }
  return result.colors;
}

/** Art without a tint is HO's call, but art left at the default stays readable. */
function overlayFor(overlay: number | undefined, hasImage: boolean): number {
  if (!hasImage) return overlay ?? 0;
  return overlay ?? DEFAULT_IMAGE_OVERLAY;
}

function checkLabel(label: Record<string, string>): void {
  if (!label.en?.trim()) {
    const error = 'Please add the design name in English.';
    throw badRequest('VALIDATION_FAILED', error, [error]);
  }
}

function toDate(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null;
}

function checkWindow(startsAt: Date | null, endsAt: Date | null): void {
  const error = windowError(startsAt, endsAt);
  if (error) throw badRequest('VALIDATION_FAILED', error, [error]);
}

const unique = <T>(items: T[]): T[] => [...new Set(items)];
