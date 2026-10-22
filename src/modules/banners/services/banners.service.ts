import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { badRequest, conflict, notFound } from '@common/errors/api-error';
import { PageResult } from '@common/http/page-result';
import { imageInfo } from '@common/utils/image-size.util';
import { checkWindow, toDate } from '@common/utils/schedule-window.util';
import { TtlCache } from '@common/utils/ttl-cache';
import { AgentsService } from '@modules/agents/services/agents.service';
import type { Localized } from '@modules/onboarding/form.domain';
import { CohortsService } from '@modules/onboarding/services/cohorts.service';
import { StorageService } from '@modules/uploads/services/storage.service';

import {
  BANNER_IMAGE_FOLDER,
  BANNER_IMAGE_HINT,
  MAX_LIVE_BANNERS,
  contentError,
  imageSizeError,
  isShownTo,
  statusOf,
  type BannerStatus,
  type BannerTone,
} from '../banners.domain';
import type {
  BannerListQueryDto,
  CreateBannerDto,
  UpdateBannerDto,
  UploadedBannerImageDto,
} from '../dto/banner.dto';
import { BannerRepository } from '../repositories/banner.repository';
import type { Banner } from '../schemas/banner.schema';

/** What the app's `HomeBanner` reads. */
export interface PartnerBannerView {
  id: string;
  title: Localized;
  /** `null` only on an image banner. */
  subtitle: Localized | null;
  cta: Localized | null;
  link: string;
  tone: BannerTone;
  emoji: string | null;
  /** Set: show this art instead of drawing the banner from its text. */
  image: { url: string; width: number; height: number } | null;
}

export type AdminBannerView = Banner & { status: BannerStatus };

type ImageFields = Pick<
  Banner,
  'image_path' | 'image_url' | 'image_width' | 'image_height'
>;

const NO_IMAGE: ImageFields = {
  image_path: null,
  image_url: null,
  image_width: null,
  image_height: null,
};

const ACTIVE_TTL_MS = 60_000;
const BANNER_NOT_FOUND =
  'This banner could not be found. It may have been deleted.';

@Injectable()
export class BannersService {
  /**
   * Every partner reads this on each Home open; HO changes it a few times a
   * week. Each instance re-reads at most once a minute, so an HO edit shows
   * on other instances within that minute.
   */
  private readonly active = new TtlCache<Banner[]>(ACTIVE_TTL_MS, 1);

  constructor(
    private readonly banners: BannerRepository,
    private readonly agents: AgentsService,
    private readonly cohorts: CohortsService,
    private readonly storage: StorageService,
  ) {}

  async forPartner(agentRef: string): Promise<PartnerBannerView[]> {
    const [cohort, rows] = await Promise.all([
      this.agents.cohortById(agentRef),
      this.activeRows(),
    ]);
    const now = new Date();
    return rows
      .filter((b) => isShownTo(b, cohort, now))
      .slice(0, MAX_LIVE_BANNERS)
      .map(toPartnerView);
  }

  /**
   * Stores HO's art before the banner is saved, so the form can preview it.
   * The type and size come from the bytes, not from what the browser claims.
   */
  async uploadImage(buffer: Buffer): Promise<UploadedBannerImageDto> {
    const info = imageInfo(buffer);
    if (!info) {
      throw badRequest(
        'FILE_TYPE_NOT_ALLOWED',
        `Only JPG, PNG and WEBP images can be used. ${BANNER_IMAGE_HINT}`,
      );
    }
    const sizeError = imageSizeError(info.width, info.height);
    if (sizeError) {
      throw badRequest('IMAGE_SIZE_NOT_ALLOWED', sizeError, [sizeError]);
    }
    const { path, url } = await this.storage.savePublic(
      BANNER_IMAGE_FOLDER,
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

  async list(query: BannerListQueryDto): Promise<PageResult<AdminBannerView>> {
    const now = new Date();
    const { rows, total } = await this.banners.page(
      { status: query.status, cohort: query.cohort },
      now,
      query.skip,
      query.limit,
      query.sortSpec,
    );
    return new PageResult(
      rows.map((b) => toAdminView(b, now)),
      total,
      query,
    );
  }

  async get(id: string): Promise<AdminBannerView> {
    return toAdminView(await this.require(id), new Date());
  }

  async create(dto: CreateBannerDto, by: string): Promise<AdminBannerView> {
    requireEnglish(dto);
    const startsAt = toDate(dto.starts_at);
    const endsAt = toDate(dto.ends_at);
    checkWindow(startsAt, endsAt);
    const subtitle = dto.subtitle ?? null;
    const cta = dto.cta ?? null;
    checkContent({ image_path: dto.image ?? null, subtitle, cta });
    const [cohorts, image] = await Promise.all([
      this.checkCohorts(dto.cohorts ?? []),
      this.resolveImage(dto.image ?? null),
    ]);

    const saved = await this.banners.create({
      _id: randomUUID(),
      title: dto.title,
      subtitle,
      cta,
      ...image,
      link: dto.link,
      tone: dto.tone ?? 'primary',
      emoji: dto.emoji ?? null,
      cohorts,
      starts_at: startsAt,
      ends_at: endsAt,
      order: dto.order ?? 0,
      is_active: dto.is_active ?? true,
      created_by: by,
      updated_by: by,
    });
    this.active.delete('active');
    return toAdminView(saved, new Date());
  }

  async update(
    id: string,
    dto: UpdateBannerDto,
    by: string,
  ): Promise<AdminBannerView> {
    requireEnglish(dto);
    const current = await this.require(id);
    const { starts_at, ends_at, cohorts, image, ...rest } = dto;
    // The validated DTO is a class instance with every declared field present,
    // left `undefined` when not sent — copied as is, a switch-off would wipe the
    // stored subtitle from the merged banner and fail the content rule.
    const sent = Object.entries(rest).filter(([, v]) => v !== undefined);
    const set: Partial<Banner> = {
      ...(Object.fromEntries(sent) as Partial<Banner>),
      updated_by: by,
    };

    if (starts_at !== undefined) set.starts_at = toDate(starts_at);
    if (ends_at !== undefined) set.ends_at = toDate(ends_at);
    // Each rule is checked against the banner as it will be, not just the patch.
    const merged = { ...current, ...set };
    checkWindow(merged.starts_at, merged.ends_at);
    checkContent({
      image_path: image !== undefined ? image : current.image_path,
      subtitle: merged.subtitle,
      cta: merged.cta,
    });

    if (cohorts !== undefined) set.cohorts = await this.checkCohorts(cohorts);
    if (image !== undefined && image !== current.image_path) {
      Object.assign(set, await this.resolveImage(image));
    }

    const updated = await this.banners.update(id, set);
    if (!updated) throw notFound(BANNER_NOT_FOUND);
    this.active.delete('active');
    if (updated.image_path !== current.image_path) {
      await this.dropImage(current.image_path);
    }
    return toAdminView(updated, new Date());
  }

  /**
   * The desk drags the whole carousel into a new order. The list must name
   * every banner the book holds now, so a banner added or deleted meanwhile
   * on another screen is never left sharing a position.
   */
  async reorder(ids: string[], by: string): Promise<{ ids: string[] }> {
    const stored = await this.banners.ids();
    const known = new Set(stored);
    if (ids.length !== stored.length || ids.some((id) => !known.has(id))) {
      throw conflict(
        'BANNERS_CHANGED',
        'The banners changed on another screen. Reload and drag them again.',
      );
    }
    await this.banners.reorder(ids, by);
    this.active.delete('active');
    return { ids };
  }

  async remove(id: string): Promise<{ deleted: true }> {
    const current = await this.require(id);
    if (!(await this.banners.remove(id))) throw notFound(BANNER_NOT_FOUND);
    this.active.delete('active');
    await this.dropImage(current.image_path);
    return { deleted: true };
  }

  private async activeRows(): Promise<Banner[]> {
    return this.active.get('active', () => this.banners.listActive(new Date()));
  }

  private async require(id: string): Promise<Banner> {
    const banner = await this.banners.find(id);
    if (!banner) throw notFound(BANNER_NOT_FOUND);
    return banner;
  }

  /** Inactive cohorts are allowed: HO may prepare a banner before launching one. */
  private async checkCohorts(keys: string[]): Promise<string[]> {
    const unique = [...new Set(keys)];
    await Promise.all(unique.map((key) => this.cohorts.require(key, false)));
    return unique;
  }

  /** The stored URL and size of an uploaded image, read once at save time. */
  private async resolveImage(path: string | null): Promise<ImageFields> {
    if (!path) return NO_IMAGE;
    const file = await this.storage.publicFile(path);
    if (!file) {
      throw badRequest(
        'IMAGE_NOT_FOUND',
        'The banner image was not found. Please upload it again.',
      );
    }
    return {
      image_path: path,
      image_url: file.url,
      image_width: Number(file.extra.width) || null,
      image_height: Number(file.extra.height) || null,
    };
  }

  /** A copied banner can share its art, so the file goes only with its last user. */
  private async dropImage(path: string | null): Promise<void> {
    if (!path || (await this.banners.countByImage(path)) > 0) return;
    await this.storage.remove(path);
  }
}

function toPartnerView(b: Banner): PartnerBannerView {
  return {
    id: b._id,
    title: b.title,
    subtitle: b.subtitle,
    cta: b.cta,
    link: b.link,
    tone: b.tone,
    emoji: b.emoji,
    image:
      b.image_url && b.image_width && b.image_height
        ? { url: b.image_url, width: b.image_width, height: b.image_height }
        : null,
  };
}

function toAdminView(b: Banner, now: Date): AdminBannerView {
  return { ...b, status: statusOf(b, now) };
}

function checkContent(content: Parameters<typeof contentError>[0]): void {
  const error = contentError(content);
  if (error) throw badRequest('VALIDATION_FAILED', error, [error]);
}

const ENGLISH_LABEL = {
  title: 'title',
  subtitle: 'subtitle',
  cta: 'button text',
} as const;

/** The app falls back to `en`, so every text that is sent must have one. */
function requireEnglish(dto: UpdateBannerDto): void {
  for (const key of ['title', 'subtitle', 'cta'] as const) {
    const text = dto[key];
    if (text && !text.en?.trim()) {
      const message = `Please enter the English ${ENGLISH_LABEL[key]}.`;
      throw badRequest('VALIDATION_FAILED', message, [message]);
    }
  }
  if (dto.title === null) {
    const message = 'Please enter a banner title.';
    throw badRequest('VALIDATION_FAILED', message, [message]);
  }
}
