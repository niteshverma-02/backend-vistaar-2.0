import { Injectable } from '@nestjs/common';

import { badRequest, conflict, notFound } from '@common/errors/api-error';
import { PageResult } from '@common/http/page-result';
import { istMonthKey } from '@common/utils/ist-day.util';
import { CohortsService } from '@modules/onboarding/services/cohorts.service';

import {
  defaultPlan,
  slabsProblem,
  type PlanTerms,
  type Slab,
} from '../commission.domain';
import type {
  CreatePlanDto,
  PlanListQueryDto,
  UpdatePlanDto,
} from '../dto/commission-plan.dto';
import {
  CommissionPlanRepository,
  type PlanRecord,
} from '../repositories/commission-plan.repository';

const CACHE_MS = 60_000;

export const planId = (cohort: string, month: string): string =>
  `${cohort}@${month}`;

/** A cohort's terms for one month, and the stored plan they come from (`null` = the PRD's). */
export interface PlanInEffect extends PlanTerms {
  cohort: string;
  plan_id: string | null;
  effective_from: string | null;
}

export type PlanView = Omit<PlanRecord, '_id'> & { id: string };

@Injectable()
export class CommissionPlansService {
  private cached: { at: number; rows: PlanRecord[] } | null = null;
  private loading: Promise<PlanRecord[]> | null = null;

  constructor(
    private readonly plans: CommissionPlanRepository,
    private readonly cohorts: CohortsService,
  ) {}

  /**
   * The cohort's terms for any month, from one snapshot of every plan —
   * read once a minute per process, not once per order.
   */
  async termsFor(cohort: string): Promise<(month: string) => PlanInEffect> {
    const rows = (await this.rows())
      .filter((r) => r.cohort === cohort)
      .sort((a, b) => b.effective_from.localeCompare(a.effective_from));
    const memo = new Map<string, PlanInEffect>();
    return (month) => {
      let terms = memo.get(month);
      if (!terms) {
        const row = rows.find((r) => r.effective_from <= month);
        terms = row
          ? {
              cohort,
              plan_id: row._id,
              effective_from: row.effective_from,
              slabs: row.slabs,
              notes: row.notes,
              draft: row.draft,
            }
          : {
              cohort,
              plan_id: null,
              effective_from: null,
              ...defaultPlan(cohort),
            };
        memo.set(month, terms);
      }
      return terms;
    };
  }

  /** Every active cohort's terms in `month`, in the cohorts' order, with its label. */
  async inEffect(month: string): Promise<(PlanInEffect & { label: string })[]> {
    const cohorts = await this.cohorts.list(true);
    return Promise.all(
      cohorts.map(async (c) => ({
        ...(await this.termsFor(c._id))(month),
        label: c.label.en ?? c._id,
      })),
    );
  }

  // ── HO ────────────────────────────────────────────────────────────────

  async list(query: PlanListQueryDto): Promise<PageResult<PlanView>> {
    const rows = (await this.plans.all())
      .filter((r) => !query.cohort || r.cohort === query.cohort)
      .sort(
        (a, b) =>
          a.cohort.localeCompare(b.cohort) ||
          b.effective_from.localeCompare(a.effective_from),
      );
    return new PageResult(
      rows.slice(query.skip, query.skip + query.limit).map(viewOf),
      rows.length,
      query,
    );
  }

  async get(id: string): Promise<PlanView> {
    return viewOf(await this.require(id));
  }

  /** From this month or a later one: an earlier month has been paid on. */
  async create(dto: CreatePlanDto, by: string): Promise<PlanView> {
    await this.cohorts.require(dto.cohort, false);
    lockedIfPast(dto.effective_from);
    const slabs = checkedSlabs(dto.slabs);
    const id = planId(dto.cohort, dto.effective_from);
    const inserted = await this.plans.insert({
      _id: id,
      cohort: dto.cohort,
      effective_from: dto.effective_from,
      slabs,
      notes: dto.notes ?? [],
      draft: dto.draft ?? true,
      created_by: by,
      updated_by: by,
    });
    if (!inserted) {
      throw conflict(
        'PLAN_EXISTS',
        `This partner type already has a plan from ${dto.effective_from}. Please edit that one.`,
      );
    }
    this.cached = null;
    return this.get(id);
  }

  /**
   * Slabs and notes change only for this month or later; signing a plan off
   * (`draft: false`) — or back — is allowed on any plan.
   */
  async update(id: string, dto: UpdatePlanDto, by: string): Promise<PlanView> {
    const row = await this.require(id);
    if (dto.slabs || dto.notes) lockedIfPast(row.effective_from);
    const updated = await this.plans.update(
      id,
      row.updated_at,
      {
        ...(dto.slabs ? { slabs: checkedSlabs(dto.slabs) } : {}),
        ...(dto.notes ? { notes: dto.notes } : {}),
        ...(dto.draft !== undefined ? { draft: dto.draft } : {}),
        updated_by: by,
      },
      {
        at: row.updated_at,
        by: row.updated_by,
        action: row.history?.length ? 'updated' : 'created',
        slabs: row.slabs,
        notes: row.notes,
        draft: row.draft,
      },
    );
    if (!updated) throw changed();
    this.cached = null;
    return viewOf(updated);
  }

  /** Only a plan for this month or later; the cohort falls back to its earlier plan. */
  async remove(id: string): Promise<{ deleted: true }> {
    const row = await this.require(id);
    lockedIfPast(row.effective_from);
    if (!(await this.plans.remove(id, row.updated_at))) throw changed();
    this.cached = null;
    return { deleted: true };
  }

  private async require(id: string): Promise<PlanRecord> {
    const row = await this.plans.findById(id);
    if (!row) throw notFound('This commission plan could not be found.');
    return row;
  }

  private async rows(): Promise<PlanRecord[]> {
    if (this.cached && Date.now() - this.cached.at < CACHE_MS)
      return this.cached.rows;
    this.loading ??= this.plans
      .all()
      .then((rows) => {
        this.cached = { at: Date.now(), rows };
        return rows;
      })
      .finally(() => {
        this.loading = null;
      });
    return this.loading;
  }
}

function viewOf(row: PlanRecord): PlanView {
  const { _id, ...rest } = row;
  return { id: _id, ...rest, history: rest.history ?? [] };
}

function lockedIfPast(month: string): void {
  const now = istMonthKey(new Date());
  if (month < now) {
    throw conflict(
      'PLAN_LOCKED',
      `Commission for ${month} has already been worked out on this plan. Please make the change from ${now} or later.`,
    );
  }
}

function checkedSlabs(slabs: Slab[]): Slab[] {
  const clean = slabs.map((s) => ({
    from: s.from,
    to: s.to ?? null,
    rate: s.rate,
  }));
  const problem = slabsProblem(clean);
  if (problem) throw badRequest('VALIDATION_FAILED', problem, [problem]);
  return clean;
}

function changed() {
  return conflict(
    'VERSION_CONFLICT',
    'This plan was just changed by someone else. Please reload it and try again.',
  );
}
