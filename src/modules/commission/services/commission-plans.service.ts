import { Injectable, type OnModuleInit } from '@nestjs/common';

import { badRequest, conflict, notFound } from '@common/errors/api-error';
import { PageResult } from '@common/http/page-result';
import { istMonthKey } from '@common/utils/ist-day.util';
import {
  DEFAULT_COHORT_ID,
  commissionOffIn,
  type CommissionOffRange,
} from '@modules/earning/earning.domain';
import { EarningCohortsService } from '@modules/earning/services/earning-cohorts.service';
import { CohortsService } from '@modules/onboarding/services/cohorts.service';

import {
  defaultPlan,
  inheritReasonOf,
  isEarningCohort,
  planSlabs,
  type InheritReason,
  type PlanInEffect,
  type PlanInherit,
  type PlanKind,
  type SavedPlans,
  type Slab,
} from '../commission.domain';
import type {
  CreatePlanDto,
  PlanListQueryDto,
  PlanScope,
  UpdatePlanDto,
} from '../dto/commission-plan.dto';
import {
  CommissionPlanRepository,
  type PlanRecord,
} from '../repositories/commission-plan.repository';

export type { PlanInEffect } from '../commission.domain';

const CACHE_MS = 60_000;

export const planId = (cohort: string, month: string): string =>
  `${cohort}@${month}`;

/** One row of the "rates in effect" table, with the cohort's name. */
export type PlanInEffectRow = PlanInEffect & {
  label: string;
  /** Earning cohorts with no plan of their own: whose rates apply; `null` = its own. */
  inherits: PlanInherit | null;
  /** Why it inherits: its commission switched off that month, or no plan of its own; `null` = its own. */
  inherits_reason: InheritReason | null;
};

/** Is this cohort's own commission switched off in this month? */
type CommissionOff = (cohort: string, month: string) => boolean;

export type PlanView = Omit<PlanRecord, '_id'> & { id: string };

@Injectable()
export class CommissionPlansService implements OnModuleInit {
  private cached: { at: number; rows: PlanRecord[] } | null = null;
  private loading: Promise<PlanRecord[]> | null = null;
  /** The cohorts' commission switches, held as long as the plans. */
  private offCached: {
    at: number;
    ranges: Map<string, CommissionOffRange[]>;
  } | null = null;
  private offLoading: Promise<Map<string, CommissionOffRange[]>> | null = null;

  constructor(
    private readonly plans: CommissionPlanRepository,
    private readonly cohorts: CohortsService,
    private readonly earning: EarningCohortsService,
  ) {}

  /** A switch on this server is read at once, as a plan edit is (other servers: within the cache minute). */
  onModuleInit(): void {
    this.earning.onCommissionChange(() => {
      this.offCached = null;
    });
  }

  /**
   * Every saved plan by cohort and month, from one snapshot — read once a
   * minute per process, not once per order.
   */
  async saved(): Promise<SavedPlans> {
    const [rows, off] = await Promise.all([this.rows(), this.commissionOff()]);
    const byCohort = new Map<string, PlanRecord[]>();
    for (const row of rows) {
      const list = byCohort.get(row.cohort) ?? [];
      list.push(row);
      byCohort.set(row.cohort, list);
    }
    for (const list of byCohort.values())
      list.sort((a, b) => b.effective_from.localeCompare(a.effective_from));
    const memo = new Map<string, PlanInEffect | null>();
    return (cohort, month) => {
      // Switched off: the month reads as if the cohort had no plan of its
      // own, so every caller falls to ec_default's (`earningPlanIn`).
      if (off(cohort, month)) return null;
      const key = planId(cohort, month);
      let terms = memo.get(key);
      if (terms === undefined) {
        const row = byCohort
          .get(cohort)
          ?.find((r) => r.effective_from <= month);
        terms = row ? inEffectOf(row) : null;
        memo.set(key, terms);
      }
      return terms;
    };
  }

  /** A partner type's terms for any month: its saved plan, else the PRD's. */
  async termsFor(cohort: string): Promise<(month: string) => PlanInEffect> {
    const saved = await this.saved();
    return (month) =>
      saved(cohort, month) ?? {
        cohort,
        plan_id: null,
        effective_from: null,
        ...defaultPlan(cohort),
      };
  }

  /**
   * Every active cohort's terms in `month`, with its label: the partner types
   * in their order, or the earning cohorts in HO's priority order.
   */
  async inEffect(
    month: string,
    scope: PlanScope = 'partner_type',
  ): Promise<PlanInEffectRow[]> {
    if (scope === 'earning') return this.earningInEffect(month);
    const cohorts = await this.cohorts.list(true);
    return Promise.all(
      cohorts.map(async (c) => ({
        ...(await this.termsFor(c._id))(month),
        label: c.label.en ?? c._id,
        inherits: null,
        inherits_reason: null,
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
    await this.requireCohort(dto.cohort);
    lockedIfPast(dto.effective_from);
    const kind = dto.kind ?? 'slabs';
    const slabs = checked(planSlabs(kind, dto));
    const minOrder = minOrderValue(dto.cohort, dto.min_order_value ?? null);
    const id = planId(dto.cohort, dto.effective_from);
    const inserted = await this.plans.insert({
      _id: id,
      cohort: dto.cohort,
      effective_from: dto.effective_from,
      kind,
      slabs,
      min_order_value: minOrder,
      notes: dto.notes ?? [],
      draft: dto.draft ?? true,
      created_by: by,
      updated_by: by,
    });
    if (!inserted) {
      throw conflict(
        'PLAN_EXISTS',
        `This cohort already has a plan from ${dto.effective_from}. Please edit that one.`,
      );
    }
    this.cached = null;
    return this.get(id);
  }

  /**
   * The terms (kind, slabs / rate, minimum order, notes) change only for
   * this month or later; signing a plan off (`draft: false`) — or back — is
   * allowed on any plan.
   */
  async update(id: string, dto: UpdatePlanDto, by: string): Promise<PlanView> {
    const row = await this.require(id);
    const termsSent =
      dto.kind !== undefined ||
      dto.slabs !== undefined ||
      dto.rate !== undefined;
    if (termsSent || dto.notes || dto.min_order_value !== undefined)
      lockedIfPast(row.effective_from);
    const kind = dto.kind ?? row.kind ?? 'slabs';
    const updated = await this.plans.update(
      id,
      row.updated_at,
      {
        ...(termsSent ? { kind, slabs: checked(planSlabs(kind, dto)) } : {}),
        ...(dto.min_order_value !== undefined
          ? { min_order_value: minOrderValue(row.cohort, dto.min_order_value) }
          : {}),
        ...(dto.notes ? { notes: dto.notes } : {}),
        ...(dto.draft !== undefined ? { draft: dto.draft } : {}),
        updated_by: by,
      },
      {
        at: row.updated_at,
        by: row.updated_by,
        action: row.history?.length ? 'updated' : 'created',
        kind: row.kind ?? 'slabs',
        slabs: row.slabs,
        min_order_value: row.min_order_value ?? null,
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

  private async earningInEffect(month: string): Promise<PlanInEffectRow[]> {
    const [cohorts, saved, off] = await Promise.all([
      this.earning.all(),
      this.saved(),
      this.commissionOff(),
    ]);
    const fallback = saved(DEFAULT_COHORT_ID, month);
    return cohorts
      .filter((c) => c.status === 'active')
      .map((c): PlanInEffectRow => {
        const own = saved(c._id, month);
        const plan = own ?? (c._id === DEFAULT_COHORT_ID ? null : fallback);
        const switchedOff = off(c._id, month);
        if (plan) {
          const inherits = own ? null : 'ec_default';
          return {
            ...plan,
            cohort: c._id,
            label: c.name,
            inherits,
            inherits_reason: inheritReasonOf(inherits, switchedOff),
          };
        }
        // Each partner earns on their own partner type's plan: no one set of slabs to show.
        return {
          cohort: c._id,
          plan_id: null,
          effective_from: null,
          kind: 'slabs',
          slabs: [],
          min_order_value: null,
          notes: [],
          draft: true,
          label: c.name,
          inherits: 'partner_type',
          inherits_reason: inheritReasonOf('partner_type', switchedOff),
        };
      });
  }

  /** The cohort exists: an active earning cohort, or a partner type (any). */
  private async requireCohort(cohort: string): Promise<void> {
    if (!isEarningCohort(cohort)) {
      await this.cohorts.require(cohort, false);
      return;
    }
    const found = await this.earning.find(cohort);
    if (!found) {
      throw badRequest(
        'COHORT_NOT_FOUND',
        'This earning cohort could not be found.',
      );
    }
    if (found.status === 'archived') {
      throw conflict(
        'EARNING_ARCHIVED',
        'This earning cohort is archived: its partners have moved on, so it takes no new plan.',
      );
    }
  }

  private async require(id: string): Promise<PlanRecord> {
    const row = await this.plans.findById(id);
    if (!row) throw notFound('This commission plan could not be found.');
    return row;
  }

  /**
   * Earning cohorts' commission switches, from one read of the cohorts a
   * minute (a book is worked out per partner, often for every partner at
   * once). `ec_default` is never off: it is what the others fall back to.
   */
  private async commissionOff(): Promise<CommissionOff> {
    let ranges = this.offCached?.ranges;
    if (!ranges || Date.now() - (this.offCached?.at ?? 0) >= CACHE_MS) {
      this.offLoading ??= this.earning
        .all()
        .then((cohorts) => {
          const map = new Map(
            cohorts
              .filter((c) => (c.commission_off ?? []).length > 0)
              .map((c) => [c._id, c.commission_off ?? []] as const),
          );
          this.offCached = { at: Date.now(), ranges: map };
          return map;
        })
        .finally(() => {
          this.offLoading = null;
        });
      ranges = await this.offLoading;
    }
    const held = ranges;
    return (cohort, month) =>
      isEarningCohort(cohort) &&
      cohort !== DEFAULT_COHORT_ID &&
      commissionOffIn(held.get(cohort), month);
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

/** A saved row's terms; rows from before plan kinds read as slab plans with no minimum. */
function inEffectOf(row: PlanRecord): PlanInEffect {
  return {
    cohort: row.cohort,
    plan_id: row._id,
    effective_from: row.effective_from,
    kind: kindOf(row),
    slabs: row.slabs,
    min_order_value: row.min_order_value ?? null,
    notes: row.notes,
    draft: row.draft,
  };
}

const kindOf = (row: PlanRecord): PlanKind => row.kind ?? 'slabs';

function viewOf(row: PlanRecord): PlanView {
  const { _id, ...rest } = row;
  return {
    id: _id,
    ...rest,
    kind: kindOf(row),
    min_order_value: row.min_order_value ?? null,
    history: rest.history ?? [],
  };
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

function checked(out: { slabs: Slab[] } | { error: string }): Slab[] {
  if ('error' in out)
    throw badRequest('VALIDATION_FAILED', out.error, [out.error]);
  return out.slabs;
}

/**
 * A minimum only on an earning cohort's plan: below it the order earns the
 * default cohort's, so the default cohort itself — and a partner type — has none.
 */
function minOrderValue(cohort: string, value: number | null): number | null {
  if (value === null) return null;
  if (!isEarningCohort(cohort) || cohort === DEFAULT_COHORT_ID) {
    const problem =
      'A minimum order value is only for an earning cohort other than the default one.';
    throw badRequest('VALIDATION_FAILED', problem, [problem]);
  }
  return value;
}

function changed() {
  return conflict(
    'VERSION_CONFLICT',
    'This plan was just changed by someone else. Please reload it and try again.',
  );
}
