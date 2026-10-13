import { Injectable } from '@nestjs/common';
import { mongo } from 'mongoose';

import { badRequest, conflict, notFound } from '@common/errors/api-error';
import type { Localized } from '@modules/onboarding/form.domain';

import type {
  CreateStoryTemplateDto,
  UpdateStoryTemplateDto,
} from '../dto/story-template.dto';
import { StoryTemplateRepository } from '../repositories/story-template.repository';
import type { StoryTemplateRow } from '../schemas/story-template.schema';
import {
  STORY_TEMPLATES,
  festivalStatus,
  templateFieldsError,
  templateTextsError,
  windowError,
  type FestivalStatus,
  type StoryTemplate,
  type TemplateFields,
  type TemplateTexts,
} from '../stories.domain';
import { StoryDesignsService } from './story-designs.service';

/** What the app's "Choose a design" strip reads. */
export interface PartnerTemplateView {
  /** Card key: what a saved story's `config.card` keeps (the layout name for a built-in card). */
  key: string;
  /** The layout the app draws it with. */
  base: StoryTemplate;
  label: Localized;
  hint: Localized;
  texts: Record<string, TemplateTexts>;
  fields: Record<string, TemplateFields>;
  emojis: string[];
  default_design: string | null;
  suggested: boolean;
}

export type AdminTemplateView = StoryTemplateRow & {
  key: string;
  status: FestivalStatus;
  /** E.g. the design it opens in no longer exists. Never blocks a save. */
  warnings: string[];
};

const ACTIVE_TTL_MS = 60_000;

const isBuiltinKey = (key: string): boolean =>
  (STORY_TEMPLATES as readonly string[]).includes(key);

const isDuplicateKey = (error: unknown): boolean =>
  error instanceof mongo.MongoServerError && error.code === 11000;

/** HO's "Choose a design" cards: the six built-in ones and custom cards on their layouts. */
@Injectable()
export class StoryTemplatesService {
  /** Each instance re-reads at most once a minute; an HO edit shows within that minute. */
  private cache: { at: number; rows: StoryTemplateRow[] } | null = null;

  constructor(
    private readonly templates: StoryTemplateRepository,
    private readonly designs: StoryDesignsService,
  ) {}

  /**
   * Live cards: suggested first, then by order. Empty until seeded — the app
   * then keeps its bundled six.
   */
  async live(): Promise<PartnerTemplateView[]> {
    const now = new Date();
    return (await this.rows())
      .filter((t) => statusOf(t, now) === 'live')
      .map((t) => ({
        key: t._id,
        base: t.base ?? (t._id as StoryTemplate),
        label: t.label,
        hint: t.hint,
        texts: t.texts,
        fields: t.fields ?? {},
        emojis: t.emojis,
        default_design: t.default_design,
        suggested: t.suggested ?? false,
      }));
  }

  /** Every card (hidden, scheduled and ended ones too), strip order. */
  async list(): Promise<AdminTemplateView[]> {
    const now = new Date();
    const rows = await this.templates.all();
    return Promise.all(rows.map((t) => this.toAdminView(t, now)));
  }

  async get(key: string): Promise<AdminTemplateView> {
    return this.toAdminView(await this.require(key), new Date());
  }

  /** A custom card on one of the six layouts. */
  async create(
    dto: CreateStoryTemplateDto,
    by: string,
  ): Promise<AdminTemplateView> {
    if (isBuiltinKey(dto.key)) {
      throw conflict(
        'TEMPLATE_EXISTS',
        'This short name belongs to a built-in card. Edit that card instead, or use a different short name.',
      );
    }
    await this.check(dto);
    const startsAt = toDate(dto.starts_at);
    const endsAt = toDate(dto.ends_at);
    checkWindow(startsAt, endsAt);
    try {
      const saved = await this.templates.create({
        _id: dto.key,
        base: dto.base,
        builtin: false,
        label: dto.label,
        hint: dto.hint,
        texts: cleanTexts(dto.texts),
        fields: cleanFields(dto.fields ?? {}),
        emojis: cleanEmojis(dto.emojis ?? []),
        default_design: dto.default_design ?? null,
        suggested: dto.suggested ?? false,
        starts_at: startsAt,
        ends_at: endsAt,
        order: dto.order ?? 0,
        is_active: dto.is_active ?? true,
        created_by: by,
        updated_by: by,
      });
      this.cache = null;
      return this.toAdminView(saved, new Date());
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw conflict(
          'TEMPLATE_EXISTS',
          'This card already exists. Please use a different short name.',
        );
      }
      throw error;
    }
  }

  async update(
    key: string,
    dto: UpdateStoryTemplateDto,
    by: string,
  ): Promise<AdminTemplateView> {
    const current = await this.require(key);
    await this.check(dto);
    if (
      dto.is_active === false &&
      current.is_active &&
      (await this.templates.countActive()) <= 1
    ) {
      throw invalid('At least one card must stay shown.');
    }

    const { texts, fields, emojis, starts_at, ends_at, ...rest } = dto;
    // A validated DTO carries every declared field, `undefined` when not sent.
    const sent = Object.entries(rest).filter(([, v]) => v !== undefined);
    const set: Partial<StoryTemplateRow> = {
      ...(Object.fromEntries(sent) as Partial<StoryTemplateRow>),
      updated_by: by,
    };
    if (texts !== undefined) set.texts = cleanTexts(texts);
    if (fields !== undefined) set.fields = cleanFields(fields);
    if (emojis !== undefined) set.emojis = cleanEmojis(emojis);
    if (starts_at !== undefined) set.starts_at = toDate(starts_at);
    if (ends_at !== undefined) set.ends_at = toDate(ends_at);
    const merged = { ...current, ...set };
    checkWindow(merged.starts_at ?? null, merged.ends_at ?? null);

    const updated = await this.templates.update(current._id, set);
    if (!updated) throw notFound(CARD_NOT_FOUND);
    this.cache = null;
    return this.toAdminView(updated, new Date());
  }

  /**
   * Custom cards only — a built-in card is hidden instead. Saved stories
   * keep their image; "Edit" opens them on the layout's own card.
   */
  async remove(key: string): Promise<{ deleted: true }> {
    const current = await this.require(key);
    if (current.builtin || isBuiltinKey(current._id)) {
      throw invalid(
        'Built-in cards cannot be deleted. You can hide this card instead.',
      );
    }
    if (current.is_active && (await this.templates.countActive()) <= 1) {
      throw invalid('At least one card must stay shown.');
    }
    if (!(await this.templates.remove(key))) throw notFound(CARD_NOT_FOUND);
    this.cache = null;
    return { deleted: true };
  }

  /** Adds the cards that are missing; an existing one (HO's edits) is left alone. */
  async seed(
    rows: Omit<StoryTemplateRow, 'created_at' | 'updated_at'>[],
  ): Promise<string[]> {
    await this.templates.backfillBuiltins();
    const added: string[] = [];
    for (const row of rows) {
      if (await this.templates.insertIfMissing(row)) added.push(row._id);
    }
    this.cache = null;
    return added;
  }

  /** For the seed: a design a card should open in may not exist on this database. */
  designExists(key: string): Promise<boolean> {
    return this.designs.exists(key);
  }

  private async check(dto: UpdateStoryTemplateDto): Promise<void> {
    const errors = [
      ...localizedErrors('label', dto.label),
      ...localizedErrors('hint', dto.hint),
    ];
    if (dto.texts !== undefined) {
      const error = templateTextsError(dto.texts);
      if (error) errors.push(error);
    }
    if (dto.fields !== undefined) {
      const error = templateFieldsError(dto.fields);
      if (error) errors.push(error);
    }
    if (errors.length) throw badRequest('VALIDATION_FAILED', errors[0], errors);
    if (
      dto.default_design &&
      !(await this.designs.exists(dto.default_design))
    ) {
      throw invalid(
        'The chosen design no longer exists. Please choose another design.',
      );
    }
  }

  private async rows(): Promise<StoryTemplateRow[]> {
    if (this.cache && Date.now() - this.cache.at < ACTIVE_TTL_MS) {
      return this.cache.rows;
    }
    const rows = await this.templates.all();
    this.cache = { at: Date.now(), rows };
    return rows;
  }

  private async require(key: string): Promise<StoryTemplateRow> {
    const row = await this.templates.find(key);
    if (!row) throw notFound(CARD_NOT_FOUND);
    return row;
  }

  private async toAdminView(
    t: StoryTemplateRow,
    now: Date,
  ): Promise<AdminTemplateView> {
    const warnings: string[] = [];
    if (t.default_design && !(await this.designs.exists(t.default_design))) {
      warnings.push(
        'The design chosen for this card no longer exists, so partners keep their current design. Please choose another design.',
      );
    }
    return { ...t, key: t._id, status: statusOf(t, now), warnings };
  }
}

/** Rows written before cards had a window have no dates: no bound. */
function statusOf(t: StoryTemplateRow, now: Date): FestivalStatus {
  return festivalStatus(
    {
      is_active: t.is_active,
      starts_at: t.starts_at ?? null,
      ends_at: t.ends_at ?? null,
    },
    now,
  );
}

const CARD_NOT_FOUND =
  'This card could not be found. It may have been deleted.';

function invalid(error: string) {
  return badRequest('VALIDATION_FAILED', error, [error]);
}

function localizedErrors(
  field: string,
  value: Record<string, string> | undefined,
): string[] {
  if (value === undefined || value.en?.trim()) return [];
  return [
    `Please add the card ${field === 'hint' ? 'description' : 'name'} in English.`,
  ];
}

function toDate(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null;
}

function checkWindow(startsAt: Date | null, endsAt: Date | null): void {
  const error = windowError(startsAt, endsAt);
  if (error) throw invalid(error);
}

function cleanTexts(
  texts: Record<string, TemplateTexts>,
): Record<string, TemplateTexts> {
  return Object.fromEntries(
    Object.entries(texts).map(([lang, t]) => [
      lang,
      { kicker: t.kicker.trim(), cta: t.cta.trim() },
    ]),
  );
}

/** Empty values are dropped: "nothing to pre-fill" means the layout's default. */
function cleanFields(
  fields: Record<string, TemplateFields>,
): Record<string, TemplateFields> {
  const out: Record<string, TemplateFields> = {};
  for (const [lang, f] of Object.entries(fields)) {
    const kept = Object.fromEntries(
      Object.entries(f)
        .map(([k, v]) => [k, (v ?? '').trim()] as const)
        .filter(([, v]) => v !== ''),
    ) as TemplateFields;
    if (Object.keys(kept).length) out[lang] = kept;
  }
  return out;
}

function cleanEmojis(emojis: string[]): string[] {
  return [...new Set(emojis.map((e) => e.trim()).filter(Boolean))];
}
