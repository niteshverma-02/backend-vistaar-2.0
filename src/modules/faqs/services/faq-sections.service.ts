import { Injectable } from '@nestjs/common';

import { conflict, notFound } from '@common/errors/api-error';
import { isDuplicateKey } from '@common/utils/mongo-error.util';

import type {
  CreateFaqSectionDto,
  UpdateFaqSectionDto,
} from '../dto/faq-section.dto';
import { FaqSectionRepository } from '../repositories/faq-section.repository';
import type { FaqSection } from '../schemas/faq.schema';
import { FaqsService } from './faqs.service';

/** HO's FAQ sections — the category chips on the app's FAQs screen. */
@Injectable()
export class FaqSectionsService {
  constructor(
    private readonly sections: FaqSectionRepository,
    private readonly faqs: FaqsService,
  ) {}

  list(isActive?: boolean): Promise<FaqSection[]> {
    return this.sections.list(isActive);
  }

  async get(key: string): Promise<FaqSection> {
    const section = await this.sections.find(key);
    if (!section) throw notFound(`No FAQ section ${key}.`);
    return section;
  }

  async create(dto: CreateFaqSectionDto, by: string): Promise<FaqSection> {
    try {
      const saved = await this.sections.create({
        _id: dto.key,
        label: dto.label.trim(),
        emoji: dto.emoji ?? null,
        order: dto.order ?? 0,
        is_active: dto.is_active ?? true,
        created_by: by,
        updated_by: by,
      });
      this.faqs.refresh();
      return saved;
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw conflict(
          'FAQ_SECTION_EXISTS',
          `A FAQ section with key ${dto.key} already exists.`,
        );
      }
      throw error;
    }
  }

  async update(
    key: string,
    dto: UpdateFaqSectionDto,
    by: string,
  ): Promise<FaqSection> {
    // A validated DTO carries every declared field, `undefined` when not sent.
    const sent = Object.entries(dto).filter(([, v]) => v !== undefined);
    const set: Partial<FaqSection> = {
      ...(Object.fromEntries(sent) as Partial<FaqSection>),
      updated_by: by,
    };
    if (dto.label !== undefined) set.label = dto.label.trim();
    const updated = await this.sections.update(key, set);
    if (!updated) throw notFound(`No FAQ section ${key}.`);
    this.faqs.refresh();
    return updated;
  }

  /**
   * Only an empty section: deleting one with FAQs would orphan them. HO moves
   * or deletes its FAQs first, or switches the section off.
   */
  async remove(key: string): Promise<{ deleted: true }> {
    if (await this.faqs.inSection(key)) {
      throw conflict(
        'FAQ_SECTION_IN_USE',
        'This section still has FAQs. Move or delete them first, or switch the section off.',
      );
    }
    if (!(await this.sections.remove(key))) {
      throw notFound(`No FAQ section ${key}.`);
    }
    this.faqs.refresh();
    return { deleted: true };
  }
}
