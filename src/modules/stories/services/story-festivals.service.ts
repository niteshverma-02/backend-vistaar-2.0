import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { mongo } from 'mongoose';

import { badRequest, conflict, notFound } from '@common/errors/api-error';
import { PageResult } from '@common/http/page-result';
import type { Localized } from '@modules/onboarding/form.domain';

import type {
  CreateStoryFestivalDto,
  StoryFestivalListQueryDto,
  UpdateStoryFestivalDto,
} from '../dto/story-festival.dto';
import { StoryFestivalRepository } from '../repositories/story-festival.repository';
import type { StoryFestival } from '../schemas/story-festival.schema';
import {
  festivalStatus,
  festivalTextError,
  windowError,
  type FestivalStatus,
  type FestivalText,
} from '../stories.domain';

const FESTIVAL_NOT_FOUND =
  'This festival could not be found. It may have been deleted.';

/** What the app's Festival picker reads. */
export interface PartnerFestivalView {
  key: string;
  label: Localized;
  emoji: string;
  text: Record<string, FestivalText>;
}

export type AdminFestivalView = StoryFestival & { status: FestivalStatus };

const ACTIVE_TTL_MS = 60_000;

const isDuplicateKey = (error: unknown): boolean =>
  error instanceof mongo.MongoServerError && error.code === 11000;

/** HO's festival greetings for My Story's Festival template. */
@Injectable()
export class StoryFestivalsService {
  /** Each instance re-reads at most once a minute; an HO edit shows within that minute. */
  private active: { at: number; rows: StoryFestival[] } | null = null;

  constructor(private readonly festivals: StoryFestivalRepository) {}

  /** Live ones, picker order. */
  async live(): Promise<PartnerFestivalView[]> {
    const now = new Date();
    return (await this.activeRows())
      .filter((f) => festivalStatus(f, now) === 'live')
      .map((f) => ({
        key: f.key,
        label: f.label,
        emoji: f.emoji,
        text: f.text,
      }));
  }

  async list(
    query: StoryFestivalListQueryDto,
  ): Promise<PageResult<AdminFestivalView>> {
    const now = new Date();
    const { rows, total } = await this.festivals.page(
      query.status,
      now,
      query.skip,
      query.limit,
      query.sortSpec,
    );
    return new PageResult(
      rows.map((f) => toAdminView(f, now)),
      total,
      query,
    );
  }

  async get(id: string): Promise<AdminFestivalView> {
    return toAdminView(await this.require(id), new Date());
  }

  async create(
    dto: CreateStoryFestivalDto,
    by: string,
  ): Promise<AdminFestivalView> {
    checkTexts(dto);
    const startsAt = toDate(dto.starts_at);
    const endsAt = toDate(dto.ends_at);
    checkWindow(startsAt, endsAt);
    try {
      const saved = await this.festivals.create({
        _id: randomUUID(),
        key: dto.key,
        label: dto.label,
        emoji: dto.emoji,
        text: cleanText(dto.text),
        starts_at: startsAt,
        ends_at: endsAt,
        order: dto.order ?? 0,
        is_active: dto.is_active ?? true,
        created_by: by,
        updated_by: by,
      });
      this.active = null;
      return toAdminView(saved, new Date());
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw conflict(
          'FESTIVAL_EXISTS',
          'This festival already exists. Please use a different short name.',
        );
      }
      throw error;
    }
  }

  async update(
    id: string,
    dto: UpdateStoryFestivalDto,
    by: string,
  ): Promise<AdminFestivalView> {
    checkTexts(dto);
    const current = await this.require(id);
    const { starts_at, ends_at, text, ...rest } = dto;
    // A validated DTO carries every declared field, `undefined` when not sent.
    const sent = Object.entries(rest).filter(([, v]) => v !== undefined);
    const set: Partial<StoryFestival> = {
      ...(Object.fromEntries(sent) as Partial<StoryFestival>),
      updated_by: by,
    };
    if (text !== undefined) set.text = cleanText(text);
    if (starts_at !== undefined) set.starts_at = toDate(starts_at);
    if (ends_at !== undefined) set.ends_at = toDate(ends_at);
    const merged = { ...current, ...set };
    checkWindow(merged.starts_at, merged.ends_at);

    const updated = await this.festivals.update(id, set);
    if (!updated) throw notFound(FESTIVAL_NOT_FOUND);
    this.active = null;
    return toAdminView(updated, new Date());
  }

  /**
   * Saved stories keep their own text, so deleting a festival never changes
   * one; it only leaves the picker.
   */
  async remove(id: string): Promise<{ deleted: true }> {
    if (!(await this.festivals.remove(id))) throw notFound(FESTIVAL_NOT_FOUND);
    this.active = null;
    return { deleted: true };
  }

  private async activeRows(): Promise<StoryFestival[]> {
    if (this.active && Date.now() - this.active.at < ACTIVE_TTL_MS) {
      return this.active.rows;
    }
    const rows = await this.festivals.listActive(new Date());
    this.active = { at: Date.now(), rows };
    return rows;
  }

  private async require(id: string): Promise<StoryFestival> {
    const festival = await this.festivals.find(id);
    if (!festival) throw notFound(FESTIVAL_NOT_FOUND);
    return festival;
  }
}

function toAdminView(f: StoryFestival, now: Date): AdminFestivalView {
  return { ...f, status: festivalStatus(f, now) };
}

function toDate(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null;
}

function checkWindow(startsAt: Date | null, endsAt: Date | null): void {
  const error = windowError(startsAt, endsAt);
  if (error) throw badRequest('VALIDATION_FAILED', error, [error]);
}

function checkTexts(dto: UpdateStoryFestivalDto): void {
  const errors: string[] = [];
  if (dto.label !== undefined && !dto.label.en?.trim()) {
    errors.push('Please add the festival name in English.');
  }
  if (dto.text !== undefined) {
    const error = festivalTextError(dto.text);
    if (error) errors.push(error);
  }
  if (errors.length) throw badRequest('VALIDATION_FAILED', errors[0], errors);
}

/** Only `headline` and `body` are stored, trimmed — nothing else rides along in the object. */
function cleanText(
  text: Record<string, FestivalText>,
): Record<string, FestivalText> {
  return Object.fromEntries(
    Object.entries(text).map(([lang, t]) => [
      lang,
      { headline: t.headline.trim(), body: t.body.trim() },
    ]),
  );
}
