import { HttpStatus, Injectable } from '@nestjs/common';

import { apiError, badRequest, notFound } from '@common/errors/api-error';

import { configErrors, type StepDef } from '../form.domain';
import { ConfigRepository } from '../repositories/config.repository';
import type { OnboardingConfig } from '../schemas/onboarding-config.schema';
import { CohortsService } from './cohorts.service';

const LATEST_TTL_MS = 30_000;
const MAX_VERSIONS_CACHED = 200;

export interface DraftResult {
  draft: OnboardingConfig;
  /** What still stops a publish — empty when it is ready. */
  errors: string[];
}

/**
 * Onboarding forms per cohort. Published versions are immutable, so they are
 * cached for good; "which version is latest" is cached for 30 s and dropped
 * on publish. The app fetches the form on every launch, so this is the
 * hottest read in the service.
 */
@Injectable()
export class ConfigsService {
  private readonly byVersion = new Map<string, OnboardingConfig>();
  private readonly latest = new Map<
    string,
    { at: number; config: OnboardingConfig | null }
  >();

  constructor(
    private readonly configs: ConfigRepository,
    private readonly cohorts: CohortsService,
  ) {}

  async published(cohort: string): Promise<OnboardingConfig | null> {
    const hit = this.latest.get(cohort);
    if (hit && Date.now() - hit.at < LATEST_TTL_MS) return hit.config;
    const config = await this.configs.latestPublished(cohort);
    this.latest.set(cohort, { at: Date.now(), config });
    if (config) this.remember(config);
    return config;
  }

  async requirePublished(cohort: string): Promise<OnboardingConfig> {
    const config = await this.published(cohort);
    if (!config) {
      throw apiError(
        HttpStatus.CONFLICT,
        'CONFIG_NOT_PUBLISHED',
        'The form for this partner type is not ready yet. Please try again later.',
      );
    }
    return config;
  }

  /** A pinned version; published and archived ones never change, so cached. */
  async version(cohort: string, version: number): Promise<OnboardingConfig> {
    const key = `${cohort}@${version}`;
    const hit = this.byVersion.get(key);
    if (hit) return hit;
    const config = await this.configs.version(cohort, version);
    if (!config) throw notFound('This form version could not be found.');
    if (config.status !== 'draft') this.remember(config);
    return config;
  }

  versions(cohort: string): Promise<Omit<OnboardingConfig, 'steps'>[]> {
    return this.configs.versions(cohort);
  }

  async draft(cohort: string): Promise<DraftResult | null> {
    const draft = await this.configs.draft(cohort);
    return draft ? { draft, errors: configErrors(draft.steps) } : null;
  }

  /**
   * Replaces the cohort's draft (creating it as the next version if there is
   * none). Saved even when not yet publishable — the errors come back so the
   * editor can show them.
   */
  async saveDraft(
    cohort: string,
    rawSteps: unknown[],
    notes: string | null,
    by: string,
  ): Promise<DraftResult> {
    await this.cohorts.require(cohort, false);
    const steps = asSteps(rawSteps);
    const existing = await this.configs.updateDraft(cohort, steps, notes, by);
    const draft =
      existing ??
      (await this.configs.createDraft({
        cohort,
        version: (await this.configs.maxVersion(cohort)) + 1,
        steps,
        notes,
        by,
      }));
    return { draft, errors: configErrors(steps) };
  }

  /** Copies another cohort's latest published form into this cohort's draft. */
  async cloneFrom(
    cohort: string,
    source: string,
    by: string,
  ): Promise<DraftResult> {
    const from =
      (await this.configs.latestPublished(source)) ??
      (await this.configs.draft(source));
    if (!from) throw notFound('That partner type has no form to copy yet.');
    return this.saveDraft(cohort, from.steps, `Copied from ${from._id}`, by);
  }

  async publish(cohort: string, by: string): Promise<OnboardingConfig> {
    const draft = await this.configs.draft(cohort);
    if (!draft)
      throw badRequest(
        'NO_DRAFT',
        'There is no draft to publish. Please make changes to the form first.',
      );
    const errors = configErrors(draft.steps);
    if (errors.length) {
      throw badRequest(
        'CONFIG_INVALID',
        errors.length === 1
          ? `Please fix this before publishing: ${errors[0]}`
          : `Please fix these ${errors.length} problems before publishing. First: ${errors[0]}`,
        errors.slice(0, 50),
      );
    }
    const published = await this.configs.publish(draft._id, by);
    if (!published)
      throw badRequest(
        'NO_DRAFT',
        'This draft was already published or discarded. Please reload the page.',
      );
    await this.configs.archiveOlder(cohort, published.version, by);
    this.latest.delete(cohort);
    this.remember(published);
    return published;
  }

  async discardDraft(cohort: string): Promise<{ deleted: true }> {
    if (!(await this.configs.deleteDraft(cohort)))
      throw badRequest(
        'NO_DRAFT',
        'There is no draft to discard. Please reload the page.',
      );
    return { deleted: true };
  }

  private remember(config: OnboardingConfig): void {
    if (this.byVersion.size >= MAX_VERSIONS_CACHED) this.byVersion.clear();
    this.byVersion.set(config._id, config);
  }
}

/**
 * Just enough shape to store and to run `configErrors` on: a list of step
 * objects each with a `fields` list. Everything finer is reported by
 * `configErrors` as sentences the editor can show.
 */
function asSteps(raw: unknown[]): StepDef[] {
  const bad = raw.findIndex(
    (s) =>
      !s ||
      typeof s !== 'object' ||
      !Array.isArray((s as { fields?: unknown }).fields),
  );
  if (bad !== -1) {
    throw badRequest(
      'CONFIG_INVALID',
      `Step ${bad + 1} is not set up correctly. Please add its fields and try again.`,
    );
  }
  if (JSON.stringify(raw).length > 512 * 1024) {
    throw badRequest(
      'CONFIG_INVALID',
      'The form is too large. Please remove some steps or fields.',
    );
  }
  return raw as StepDef[];
}
