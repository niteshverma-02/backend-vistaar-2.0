import { Injectable } from '@nestjs/common';

import { badRequest, conflict, notFound } from '@common/errors/api-error';
import { CohortsService } from '@modules/onboarding/services/cohorts.service';

import {
  contentProblems,
  isOpenAt,
  ruleCohorts,
  type AboutProgramContent,
  type ContactUsContent,
  type InfoPageContent,
  type InfoPageKey,
} from '../info-pages.domain';
import { InfoPageRepository } from '../repositories/info-page.repository';
import type { InfoPage } from '../schemas/info-page.schema';

export interface InfoPageView<C> {
  version: number;
  updated_at: Date;
  content: C;
}

export type ContactUsView = InfoPageView<ContactUsContent> & {
  /** Head Office hours against the server clock, IST. */
  open_now: boolean;
};

/** Read on every visit to these pages, changed by HO rarely. */
const TTL_MS = 60_000;

const notPublished = (page: InfoPageKey) =>
  notFound(`The ${page.replace(/_/g, ' ')} page has not been published yet.`);

@Injectable()
export class InfoPagesService {
  private readonly cache = new Map<
    InfoPageKey,
    { at: number; value: InfoPage | null }
  >();

  constructor(
    private readonly pages: InfoPageRepository,
    private readonly cohorts: CohortsService,
  ) {}

  async live<K extends InfoPageKey>(
    page: K,
  ): Promise<InfoPageView<InfoPageContent[K]>> {
    const row = await this.cached(page);
    if (!row) throw notPublished(page);
    return {
      version: row.version,
      updated_at: row.updated_at,
      content: row.content as InfoPageContent[K],
    };
  }

  /** `open_now` is worked out per request, so the cache never holds it stale. */
  async contactUs(now = new Date()): Promise<ContactUsView> {
    const view = await this.live('contact_us');
    return { ...view, open_now: isOpenAt(view.content.hours, now) };
  }

  async get(page: InfoPageKey): Promise<InfoPage> {
    const row = await this.pages.find(page);
    if (!row) throw notPublished(page);
    return row;
  }

  async create<K extends InfoPageKey>(
    page: K,
    content: InfoPageContent[K],
    by: string,
  ): Promise<InfoPage> {
    await this.check(page, content);
    const saved = await this.pages.create(page, content, by);
    if (!saved) {
      throw conflict(
        'INFO_PAGE_EXISTS',
        'This page already exists. Please edit it instead.',
      );
    }
    this.cache.delete(page);
    return saved;
  }

  /** Each field sent replaces that whole part of the page; the rest stays. */
  async update<K extends InfoPageKey>(
    page: K,
    patch: Partial<InfoPageContent[K]>,
    version: number,
    by: string,
  ): Promise<InfoPage> {
    const current = await this.get(page);
    // A validated DTO carries every declared field, `undefined` when not sent.
    const sent = Object.entries(patch).filter(([, v]) => v !== undefined);
    const content = {
      ...(current.content as InfoPageContent[K]),
      ...Object.fromEntries(sent),
    } as InfoPageContent[K];
    await this.check(page, content);
    const saved = await this.pages.update(page, content, version, by);
    if (!saved) {
      throw conflict(
        'VERSION_CONFLICT',
        'Someone else saved this page after you opened it. Please reload it and make your change again.',
      );
    }
    this.cache.delete(page);
    return saved;
  }

  /** The app falls back to its built-in text until the page is created again. */
  async remove(page: InfoPageKey): Promise<{ deleted: true }> {
    if (!(await this.pages.remove(page))) throw notPublished(page);
    this.cache.delete(page);
    return { deleted: true };
  }

  private async check<K extends InfoPageKey>(
    page: K,
    content: InfoPageContent[K],
  ): Promise<void> {
    const problems = contentProblems(page, content);
    if (page === 'about_program') {
      problems.push(
        ...(await this.missingCohorts(content as AboutProgramContent)),
      );
    }
    if (problems.length) {
      throw badRequest('VALIDATION_FAILED', problems[0], problems);
    }
  }

  private async cached(page: InfoPageKey): Promise<InfoPage | null> {
    const hit = this.cache.get(page);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
    const value = await this.pages.find(page);
    this.cache.set(page, { at: Date.now(), value });
    return value;
  }

  /** A switched-off cohort is fine: its partners still read the page. */
  private async missingCohorts(
    content: AboutProgramContent,
  ): Promise<string[]> {
    const keys = ruleCohorts(content.rules.items);
    const found = await Promise.all(
      keys.map((k) =>
        this.cohorts.require(k, false).then(
          () => null,
          () => k,
        ),
      ),
    );
    return found
      .filter((k): k is string => k !== null)
      .map(
        (k) => `No partner type ${k}. A rule can name only an existing cohort.`,
      );
  }
}
