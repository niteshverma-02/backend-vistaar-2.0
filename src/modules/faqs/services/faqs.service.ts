import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { badRequest, conflict, notFound } from '@common/errors/api-error';
import { PageResult } from '@common/http/page-result';
import { isDuplicateKey } from '@common/utils/mongo-error.util';
import { TtlCache } from '@common/utils/ttl-cache';

import type {
  CreateFaqDto,
  FaqListQueryDto,
  UpdateFaqDto,
} from '../dto/faq.dto';
import { liveSections, questionKey } from '../faqs.domain';
import { FaqSectionRepository } from '../repositories/faq-section.repository';
import { FaqRepository } from '../repositories/faq.repository';
import type { Faq } from '../schemas/faq.schema';

/** The app's `Faq` entity: `category` is a section `key`. */
export type FaqView = Pick<Faq, 'category' | 'q' | 'a'> & { id: string };

/** A category chip on the app's FAQs screen. */
export interface FaqSectionView {
  key: string;
  label: string;
  emoji: string | null;
}

export interface LiveFaqs {
  sections: FaqSectionView[];
  faqs: FaqView[];
}

const ACTIVE_TTL_MS = 60_000;

const duplicate = (q: string) =>
  conflict(
    'FAQ_EXISTS',
    `The question "${q}" is already in the FAQs. Please edit that one instead.`,
  );

const FAQ_NOT_FOUND = 'This FAQ could not be found. It may have been deleted.';

@Injectable()
export class FaqsService {
  /** Read by every partner, changed by HO rarely: re-read at most once a minute. */
  private readonly active = new TtlCache<LiveFaqs>(ACTIVE_TTL_MS, 1);

  constructor(
    private readonly faqs: FaqRepository,
    private readonly sections: FaqSectionRepository,
  ) {}

  live(): Promise<LiveFaqs> {
    return this.active.get('live', () => this.load());
  }

  private async load(): Promise<LiveFaqs> {
    const { sections, faqs } = await this.faqs.listActive();
    const shown = liveSections(sections, faqs);
    return {
      sections: shown.sections.map((s) => ({
        key: s._id,
        label: s.label,
        emoji: s.emoji,
      })),
      faqs: shown.faqs.map(toView),
    };
  }

  /** A section change moves what the app sees, so the next read is fresh. */
  refresh(): void {
    this.active.delete('live');
  }

  inSection(key: string): Promise<boolean> {
    return this.faqs.inSection(key);
  }

  async list(query: FaqListQueryDto): Promise<PageResult<Faq>> {
    const { rows, total } = await this.faqs.page(
      { category: query.category, is_active: query.is_active },
      query.skip,
      query.limit,
      query.sortSpec,
    );
    return new PageResult(rows, total, query);
  }

  async get(id: string): Promise<Faq> {
    const faq = await this.faqs.find(id);
    if (!faq) throw notFound(FAQ_NOT_FOUND);
    return faq;
  }

  async create(dto: CreateFaqDto, by: string): Promise<Faq> {
    await this.checkSection(dto.category);
    const q = dto.q.trim();
    try {
      const saved = await this.faqs.create({
        _id: randomUUID(),
        category: dto.category,
        q,
        a: dto.a.trim(),
        q_key: questionKey(q),
        order: dto.order ?? 0,
        is_active: dto.is_active ?? true,
        created_by: by,
        updated_by: by,
      });
      this.active.delete('live');
      return saved;
    } catch (error) {
      if (isDuplicateKey(error)) throw duplicate(q);
      throw error;
    }
  }

  async update(id: string, dto: UpdateFaqDto, by: string): Promise<Faq> {
    if (dto.category !== undefined) await this.checkSection(dto.category);
    // A validated DTO carries every declared field, `undefined` when not sent.
    const sent = Object.entries(dto).filter(([, v]) => v !== undefined);
    const set: Partial<Faq> = {
      ...(Object.fromEntries(sent) as Partial<Faq>),
      updated_by: by,
    };
    if (dto.q !== undefined) {
      set.q = dto.q.trim();
      set.q_key = questionKey(set.q);
    }
    if (dto.a !== undefined) set.a = dto.a.trim();
    try {
      const updated = await this.faqs.update(id, set);
      if (!updated) throw notFound(FAQ_NOT_FOUND);
      this.active.delete('live');
      return updated;
    } catch (error) {
      if (isDuplicateKey(error)) throw duplicate(set.q ?? '');
      throw error;
    }
  }

  async remove(id: string): Promise<{ deleted: true }> {
    if (!(await this.faqs.remove(id))) throw notFound(FAQ_NOT_FOUND);
    this.active.delete('live');
    return { deleted: true };
  }

  /** A switched-off section is fine: HO can fill it before turning it on. */
  private async checkSection(key: string): Promise<void> {
    if (!(await this.sections.find(key))) {
      const message = `No FAQ section ${key}. Add the section first.`;
      throw badRequest('VALIDATION_FAILED', message, [message]);
    }
  }
}

function toView(f: Faq): FaqView {
  return { id: f._id, category: f.category, q: f.q, a: f.a };
}
