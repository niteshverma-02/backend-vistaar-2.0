import { Injectable } from '@nestjs/common';

import { badRequest, conflict, notFound } from '@common/errors/api-error';

import type { CreateCohortDto, UpdateCohortDto } from '../dto/cohort.dto';
import { CohortRepository } from '../repositories/cohort.repository';
import { ConfigRepository } from '../repositories/config.repository';
import { OnboardingRepository } from '../repositories/onboarding.repository';
import type { Cohort } from '../schemas/cohort.schema';

const ACTIVE_TTL_MS = 60_000;

@Injectable()
export class CohortsService {
  /** The app reads the active list on every signup screen; HO changes it rarely. */
  private active: { at: number; rows: Cohort[] } | null = null;

  constructor(
    private readonly cohorts: CohortRepository,
    private readonly configs: ConfigRepository,
    private readonly onboarding: OnboardingRepository,
  ) {}

  async list(activeOnly: boolean): Promise<Cohort[]> {
    if (!activeOnly) return this.cohorts.list(false);
    if (this.active && Date.now() - this.active.at < ACTIVE_TTL_MS) {
      return this.active.rows;
    }
    const rows = await this.cohorts.list(true);
    this.active = { at: Date.now(), rows };
    return rows;
  }

  async require(key: string, activeOnly = true): Promise<Cohort> {
    const cohort = await this.cohorts.find(key);
    if (!cohort || (activeOnly && !cohort.is_active)) {
      throw badRequest(
        'COHORT_NOT_FOUND',
        activeOnly
          ? 'This partner type is not open right now. Please choose another one.'
          : 'This partner type could not be found.',
      );
    }
    return cohort;
  }

  async create(dto: CreateCohortDto, by: string): Promise<Cohort> {
    if (!dto.label?.en)
      throw badRequest(
        'VALIDATION_FAILED',
        'Please add an English name for the partner type.',
        ['Please add an English name for the partner type.'],
      );
    if (await this.cohorts.find(dto.key))
      throw conflict(
        'COHORT_EXISTS',
        `A partner type with the ID "${dto.key}" already exists. Please use another ID.`,
      );
    this.active = null;
    return this.cohorts.create({
      _id: dto.key,
      label: dto.label,
      description: dto.description ?? null,
      icon: dto.icon ?? null,
      sub_types: dto.sub_types ?? [],
      order: dto.order ?? 0,
      is_active: dto.is_active ?? true,
      created_by: by,
      updated_by: by,
    });
  }

  async update(key: string, dto: UpdateCohortDto, by: string): Promise<Cohort> {
    if (dto.label && !dto.label.en)
      throw badRequest(
        'VALIDATION_FAILED',
        'Please add an English name for the partner type.',
        ['Please add an English name for the partner type.'],
      );
    this.active = null;
    const updated = await this.cohorts.update(key, { ...dto, updated_by: by });
    if (!updated) throw notFound('This partner type could not be found.');
    return updated;
  }

  /** Only a cohort nothing uses yet; otherwise deactivate it (`is_active: false`). */
  async remove(key: string): Promise<{ deleted: true }> {
    await this.require(key, false);
    if (
      (await this.configs.existsForCohort(key)) ||
      (await this.onboarding.countForCohort(key)) > 0
    ) {
      throw conflict(
        'COHORT_IN_USE',
        'This partner type already has a form or applicants, so it cannot be deleted. Please turn it off instead.',
      );
    }
    this.active = null;
    await this.cohorts.remove(key);
    return { deleted: true };
  }
}
