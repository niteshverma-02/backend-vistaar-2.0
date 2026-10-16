import { Injectable } from '@nestjs/common';

import {
  conflict,
  notFound,
  serviceUnavailable,
} from '@common/errors/api-error';
import { PageResult } from '@common/http/page-result';
import { TtlCache } from '@common/utils/ttl-cache';
import { StorageService } from '@modules/uploads/services/storage.service';

import type {
  ComposeTermsDto,
  CreateTermsDto,
  RewriteTermsDto,
  TermsListQueryDto,
  UpdateTermsDto,
} from '../dto/terms.dto';
import { TermsRepository } from '../repositories/terms.repository';
import type { TermsAndConditions } from '../schemas/terms.schema';
import {
  buildTermsDocx,
  DOCX_MIME,
  readTermsText,
  type TermsText,
} from '../terms-docx';
import { tocId } from '../terms.domain';

/** What the app shows: the title and the document to open. */
export interface TermsView {
  toc_id: string;
  /** 1, 2, 3 … — goes up each time HO changes this T&C's text, title or link. */
  version: number;
  title: string;
  link: string;
}

/** Read by every partner and the login screen, changed by HO rarely. */
const TTL_MS = 60_000;
/** Another app adding its row at the same moment takes our number; try the next. */
const ID_ATTEMPTS = 5;

const NOT_FOUND = 'This T&C could not be found. It may have been deleted.';

@Injectable()
export class TermsService {
  private readonly cache = new TtlCache<TermsView | null>(TTL_MS, 1);

  constructor(
    private readonly terms: TermsRepository,
    private readonly storage: StorageService,
  ) {}

  async live(): Promise<TermsView> {
    const view = await this.cache.get('live', async () => {
      const row = await this.terms.live();
      return row && toView(row);
    });
    if (!view) throw notFound('The Vistaar T&C has not been added yet.');
    return view;
  }

  async list(
    query: TermsListQueryDto,
  ): Promise<PageResult<TermsAndConditions>> {
    const { rows, total } = await this.terms.page(
      query.is_active,
      query.skip,
      query.limit,
      query.sortSpec,
    );
    return new PageResult(rows, total, query);
  }

  async get(id: string): Promise<TermsAndConditions> {
    const row = await this.terms.find(id);
    if (!row) throw notFound(NOT_FOUND);
    return row;
  }

  /** A new version is a new row; made active, it replaces the one partners see. */
  async create(dto: CreateTermsDto): Promise<TermsAndConditions> {
    const isActive = dto.is_active ?? true;
    for (let i = 0; i < ID_ATTEMPTS; i++) {
      const id = tocId((await this.terms.lastTocNumber()) + 1);
      const saved = await this.terms.insert({
        toc_id: id,
        title: dto.title.trim(),
        link: dto.link,
        is_active: isActive,
      });
      if (!saved) continue;
      if (isActive) await this.activated(id);
      return saved;
    }
    throw serviceUnavailable(
      'TERMS_ID_UNAVAILABLE',
      'Could not number the new T&C just now. Please try again.',
    );
  }

  async update(id: string, dto: UpdateTermsDto): Promise<TermsAndConditions> {
    // A validated DTO carries every declared field, `undefined` when not sent.
    const sent = Object.entries(dto).filter(([, v]) => v !== undefined);
    const set = Object.fromEntries(sent) as UpdateTermsDto;
    if (set.title !== undefined) set.title = set.title.trim();
    const updated = await this.terms.update(id, set);
    if (!updated) throw notFound(NOT_FOUND);
    if (set.is_active === true) await this.activated(id);
    this.cache.delete('live');
    return updated;
  }

  /**
   * Only a switched-off version: the active one is what partners are shown,
   * and deleting it would leave them none.
   */
  async remove(id: string): Promise<{ deleted: true }> {
    if (await this.terms.removeInactive(id)) return { deleted: true };
    const row = await this.terms.find(id);
    if (!row) throw notFound(NOT_FOUND);
    throw conflict(
      'TERMS_IN_USE',
      'This is the T&C partners see now. Make another one active, or switch this off, before deleting it.',
    );
  }

  /**
   * A version's text, for the editor — read back from inside its document.
   * Only documents the editor wrote carry it; any other is 409.
   */
  async text(
    id: string,
  ): Promise<{ toc_id: string; version: number; text: TermsText }> {
    const row = await this.get(id);
    const path = this.storage.pathOf(row.link);
    const file = path ? await this.storage.read(path) : null;
    const text = file ? readTermsText(file) : null;
    if (!text) {
      throw conflict(
        'TERMS_NOT_EDITABLE',
        'This document was not written in the editor, so its text cannot be opened here. Start from another version, or add a new one.',
      );
    }
    return { toc_id: row.toc_id, version: row.__v ?? 0, text };
  }

  /** The first T&C written in the editor: a document in the bucket, then a new `TOC-n`. */
  async compose(dto: ComposeTermsDto): Promise<TermsAndConditions> {
    const text = tidyText(dto);
    const url = await this.upload(text);
    return this.create({
      title: text.title,
      link: url,
      is_active: dto.is_active,
    });
  }

  /**
   * An edit of a version's text: a new document, the **same** row — its link
   * moves to the new file and its version goes up by one. Active stays active,
   * so partners get the new text within a minute.
   */
  async rewrite(id: string, dto: RewriteTermsDto): Promise<TermsAndConditions> {
    const current = await this.get(id);
    if ((current.__v ?? 0) !== dto.version) throw versionConflict();
    const text = tidyText(dto);
    const url = await this.upload(text);
    const saved = await this.terms.replaceDocument(id, dto.version, {
      title: text.title,
      link: url,
    });
    if (!saved) {
      const path = this.storage.pathOf(url);
      if (path) await this.storage.remove(path);
      throw versionConflict();
    }
    this.cache.delete('live');
    return saved;
  }

  private async upload(text: TermsText): Promise<string> {
    const { url } = await this.storage.savePublic(
      'toc',
      buildTermsDocx(text),
      DOCX_MIME,
    );
    return url;
  }

  private async activated(id: string): Promise<void> {
    await this.terms.deactivateOthers(id);
    this.cache.delete('live');
  }
}

const versionConflict = () =>
  conflict(
    'VERSION_CONFLICT',
    'Someone else saved this T&C after you opened it. Please reload it and make your change again.',
  );

/** Trimmed, with empty optional parts as `null` and empty points dropped. */
function tidyText(
  dto: Pick<ComposeTermsDto, 'title' | 'intro' | 'sections'>,
): TermsText {
  return {
    title: dto.title.trim(),
    intro: dto.intro?.trim() || null,
    sections: dto.sections.map((s) => ({
      heading: s.heading.trim(),
      body: s.body?.trim() || null,
      points: s.points.map((p) => p.trim()).filter(Boolean),
      items: s.items.map((i) => ({
        title: i.title.trim(),
        detail: i.detail.trim(),
        purpose: i.purpose?.trim() || null,
      })),
    })),
  };
}

function toView(row: TermsAndConditions): TermsView {
  return {
    toc_id: row.toc_id,
    version: (row.__v ?? 0) + 1,
    title: row.title,
    link: row.link,
  };
}
