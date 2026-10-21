import { Injectable, Logger } from '@nestjs/common';

import { badRequest, conflict, notFound } from '@common/errors/api-error';
import { PageResult } from '@common/http/page-result';
import { KeyedSerialQueue } from '@common/utils/keyed-serial-queue';
import {
  AgentsService,
  type EarningCohortRef,
  type EarningPartnerRecord,
} from '@modules/agents/services/agents.service';

import type {
  CreateEarningCohortDto,
  EarningCohortsQueryDto,
  UpdateEarningCohortDto,
} from '../dto/earning-cohort.dto';
import {
  COHORT_FIELD_CATALOG,
  COHORT_ID_PATTERN,
  DEFAULT_COHORT_ID,
  MAX_COHORT_CONDITIONS,
  OPERATORS,
  OPERATOR_LABELS,
  checkConditionIn,
  cohortIdOf,
  cohortOrder,
  conditionsToFilters,
  describeCohortConditions,
  filtersToConditions,
  hasFilters,
  normalizeFilters,
  opsOf,
  orderError,
  pickCohort,
  withSuffix,
  type AssignmentReason,
  type CatalogField,
  type EarningFilters,
  type FiltersInput,
  type Operator,
  type PartnerFacts,
  type RuleCondition,
} from '../earning.domain';
import {
  EarningAssignmentRepository,
  type CohortMove,
  type EarningAssignmentRecord,
} from '../repositories/earning-assignment.repository';
import {
  EarningCohortRepository,
  type EarningCohortPatch,
  type EarningCohortRecord,
} from '../repositories/earning-cohort.repository';

export type { EarningCohortRecord } from '../repositories/earning-cohort.repository';

/** What a partner holds now: open leads (not won, not lost) and customers (won). */
export interface Holdings {
  open_leads: number;
  customers: number;
}

/**
 * Held counts per `VST-` id — for these partners, or every partner (`null`).
 * The leads module provides it (`useHoldings`), so this module never imports
 * leads: leads → orders → commission, and commission and gigs import this.
 */
export type HoldingsSource = (
  agentIds: readonly string[] | null,
) => Promise<Map<string, Holdings>>;

export interface CurrentEarningCohort {
  cohort: EarningCohortRecord;
  /** When the partner entered it; `null` = not assigned (not approved yet). */
  since: Date | null;
}

export interface RecomputeResult {
  agent_id: string;
  /** The cohort that stands now; `null` = never assigned (not approved). */
  cohort_id: string | null;
  changed: boolean;
  since: Date | null;
}

export type EarningAssignmentRow = Pick<
  EarningAssignmentRecord,
  'agent_id' | 'cohort_id' | 'from' | 'to'
>;

export type EarningCohortView = Omit<
  EarningCohortRecord,
  '_id' | 'conditions' | 'filters'
> & {
  id: string;
  /** Authoritative for matching; `[]` only on the default cohort. */
  conditions: RuleCondition[];
  /** The legacy view, derived from `conditions` (best effort). */
  filters: EarningFilters;
  /** The conditions in words. */
  summary: string;
  is_default: boolean;
  /** Approved partners in it now. */
  partners_count: number;
};

/** What the HO portal builds the cohort condition form from. */
export interface EarningCohortCatalog {
  fields: (CatalogField & { operators: readonly Operator[] })[];
  operators: { key: Operator; label: string }[];
}

export interface PartnerEarningView {
  agent_id: string;
  current: { cohort_id: string; name: string; since: Date | null } | null;
  /** What the cohort is matched on, now. */
  facts: PartnerFacts;
  /** Newest first. */
  history: {
    cohort_id: string;
    name: string;
    from: Date;
    to: Date | null;
    reason: AssignmentReason;
  }[];
}

const NOT_FOUND = 'This earning cohort could not be found.';
/** Free ids tried for a name before asking HO for a key. */
const ID_TRIES = 20;
/** Reads again after losing a race to another process. */
const TRIES = 2;
const HISTORY = 100;

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Approved and switched on: the only partners a cohort is worked out for. */
const isWorking = (p: EarningPartnerRecord): boolean =>
  p.stage === 'approved' && p.is_active !== false;

function factsOf(
  p: EarningPartnerRecord,
  held: Holdings | undefined,
): PartnerFacts {
  return {
    state: p.profile?.state ?? p.preview?.state ?? null,
    district: p.profile?.district ?? p.preview?.district ?? null,
    pincode: p.profile?.pincode ?? p.preview?.pincode ?? null,
    open_leads: held?.open_leads ?? 0,
    customers: held?.customers ?? 0,
  };
}

/**
 * Earning cohorts: HO's CRUD, and which one each partner is in. Assignment
 * is worked out from the partner's profile place and what they hold now; it
 * changes only when that, or HO's cohorts, change — every caller of
 * `recompute` is one of those events.
 */
@Injectable()
export class EarningCohortsService {
  private readonly logger = new Logger(EarningCohortsService.name);
  private holdings: HoldingsSource | null = null;
  /** One partner's recomputes run one after another in this process. */
  private readonly queue = new KeyedSerialQueue();
  /** The bulk run in flight here, and whether another was asked for meanwhile. */
  private bulk: Promise<void> | null = null;
  private bulkAgain = false;

  constructor(
    private readonly cohorts: EarningCohortRepository,
    private readonly assignments: EarningAssignmentRepository,
    private readonly agents: AgentsService,
  ) {}

  /** Called once by the leads module at start-up. */
  useHoldings(source: HoldingsSource): void {
    this.holdings = source;
  }

  // ── For other modules ────────────────────────────────────────────────

  /**
   * Every cohort: active ones in HO's order with the default last, then
   * archived ones. Read fresh each time — a few dozen rows, and a stale copy
   * would assign partners by filters HO has already changed.
   */
  async all(): Promise<EarningCohortRecord[]> {
    let rows = await this.cohorts.all();
    if (!rows.some((c) => c._id === DEFAULT_COHORT_ID)) {
      await this.cohorts.ensureDefault();
      rows = await this.cohorts.all();
    }
    const archived = rows
      .filter((c) => c.status === 'archived')
      .sort(
        (a, b) =>
          (b.archived_at?.getTime() ?? 0) - (a.archived_at?.getTime() ?? 0),
      );
    return [...cohortOrder(rows), ...archived].map(withConditions);
  }

  async find(id: string): Promise<EarningCohortRecord | null> {
    if (id === DEFAULT_COHORT_ID) {
      return (await this.all()).find((c) => c._id === id) ?? null;
    }
    const row = await this.cohorts.find(id);
    return row && withConditions(row);
  }

  async get(id: string): Promise<EarningCohortRecord> {
    const cohort = await this.find(id);
    if (!cohort) throw notFound(NOT_FOUND);
    return cohort;
  }

  /**
   * The partner's cohort now. An approved partner never assigned (approved
   * before this feature) is assigned here, once.
   */
  async current(agentId: string): Promise<CurrentEarningCohort> {
    const id = agentId.toUpperCase();
    const [partner, cohorts] = await Promise.all([
      this.agents.earningPartner(id),
      this.all(),
    ]);
    if (!partner) throw notFound('This partner could not be found.');
    let ref: EarningCohortRef | null = partner.earning_cohort ?? null;
    if (!ref && isWorking(partner)) {
      const done = await this.recompute(id, 'first_assignment');
      if (done.cohort_id && done.since) {
        ref = { id: done.cohort_id, since: done.since };
      }
    }
    // An archived cohort pays nothing from the moment it is archived, not
    // only once the recompute it starts has moved its partners.
    const cohort =
      cohorts.find((c) => c._id === ref?.id && c.status === 'active') ??
      cohorts.find((c) => c._id === DEFAULT_COHORT_ID);
    // `all()` writes the default when it is missing; this is a broken database.
    if (!cohort) throw new Error('The default earning cohort is missing.');
    return { cohort, since: ref?.since ?? null };
  }

  /**
   * The cohort the partner was in at `at` (an order's placing time); `null`
   * before their first assignment — the caller keeps its older rules then.
   */
  async cohortAt(agentId: string, at: Date): Promise<string | null> {
    return (
      (await this.assignments.at(agentId.toUpperCase(), at))?.cohort_id ?? null
    );
  }

  /** Every stretch of these partners, oldest first — for `cohortAtIn` over many orders. */
  assignmentsOf(agentIds: readonly string[]): Promise<EarningAssignmentRow[]> {
    return this.assignments.forAgents([
      ...new Set(agentIds.map((a) => a.toUpperCase())),
    ]);
  }

  /**
   * Works the partner's cohort out again; writes only when it changed (the
   * open stretch closed at now, a new one opened). Safe to repeat, and safe
   * when another process does the same at once: the open row is the guard.
   * A partner not approved keeps what they had.
   */
  recompute(
    agentId: string,
    reason: AssignmentReason,
  ): Promise<RecomputeResult> {
    const id = agentId.toUpperCase();
    return this.queue.run(id, () => this.recomputeOne(id, reason));
  }

  /** `recompute` after the caller's response; failures are logged, the next event fixes them. */
  recomputeLater(agentIds: readonly string[], reason: AssignmentReason): void {
    for (const id of new Set(agentIds)) {
      if (!id) continue;
      this.recompute(id, reason).catch((error: unknown) =>
        this.logger.warn(
          `Earning cohort of ${id} not recomputed (${reason}): ${message(error)}`,
        ),
      );
    }
  }

  /**
   * Every approved partner in one pass: one read of partners, one
   * aggregation of holdings, one read of open stretches, matched in memory;
   * only changes are written, in bulk.
   */
  async recomputeAll(
    reason: AssignmentReason,
  ): Promise<{ partners: number; changed: number }> {
    const [partners, cohorts, holdings, open] = await Promise.all([
      this.agents.earningPartners(),
      this.all(),
      this.holdingsOf(null),
      this.assignments.openAll(),
    ]);
    const openBy = new Map(open.map((r) => [r.agent_id, r]));
    const syncs: { agent_id: string; cohort: EarningCohortRef }[] = [];
    const moves: CohortMove[] = [];
    let working = 0;
    for (const p of partners) {
      if (!p.agent_id || !isWorking(p)) continue;
      working += 1;
      const target = pickCohort(cohorts, factsOf(p, holdings.get(p.agent_id)));
      const now = openBy.get(p.agent_id);
      if (now?.cohort_id === target) {
        if (p.earning_cohort?.id !== target) {
          syncs.push({
            agent_id: p.agent_id,
            cohort: { id: target, since: now.from },
          });
        }
        continue;
      }
      moves.push({
        agent_id: p.agent_id,
        open_id: now?._id ?? null,
        cohort_id: target,
      });
    }

    const since = new Date();
    const moved = await this.assignments.switchMany(moves, since, reason);
    for (const m of moves) {
      if (moved.has(m.agent_id)) {
        syncs.push({
          agent_id: m.agent_id,
          cohort: { id: m.cohort_id, since },
        });
      }
    }
    await this.agents.setEarningCohorts(syncs);

    let changed = moved.size;
    // Moved by another process meanwhile: one by one, from what it wrote.
    for (const m of moves) {
      if (moved.has(m.agent_id)) continue;
      const again = await this.recompute(m.agent_id, reason).catch(
        (error: unknown) => {
          this.logger.warn(
            `Earning cohort of ${m.agent_id} not recomputed: ${message(error)}`,
          );
          return null;
        },
      );
      if (again?.changed) changed += 1;
    }
    return { partners: working, changed };
  }

  /**
   * `recomputeAll` after HO's response. Asked again while one runs, it runs
   * once more at the end, so the last HO change is always the one applied.
   */
  recomputeAllLater(reason: AssignmentReason): void {
    if (this.bulk) {
      this.bulkAgain = true;
      return;
    }
    const run = async (): Promise<void> => {
      do {
        this.bulkAgain = false;
        try {
          const done = await this.recomputeAll(reason);
          this.logger.log(
            `Earning cohorts recomputed (${reason}): ${done.changed} of ${done.partners} partners moved.`,
          );
        } catch (error) {
          this.logger.error(
            `Earning cohorts not recomputed (${reason}): ${message(error)}`,
          );
        }
      } while (this.bulkAgain);
    };
    this.bulk = run().finally(() => {
      this.bulk = null;
    });
  }

  // ── HO ────────────────────────────────────────────────────────────────

  async adminList(
    query: EarningCohortsQueryDto,
  ): Promise<PageResult<EarningCohortView>> {
    const [cohorts, counts] = await Promise.all([
      this.all(),
      this.agents.earningCohortCounts(),
    ]);
    const rows = cohorts.filter(
      (c) => query.include_archived || c.status === 'active',
    );
    return new PageResult(
      rows
        .slice(query.skip, query.skip + query.limit)
        .map((c) => viewOf(c, counts.get(c._id) ?? 0)),
      rows.length,
      query,
    );
  }

  async adminGet(id: string): Promise<EarningCohortView> {
    const [cohort, counts] = await Promise.all([
      this.get(id),
      this.agents.earningCohortCounts(),
    ]);
    return viewOf(cohort, counts.get(id) ?? 0);
  }

  /** What the HO portal builds the condition form from. */
  catalog(): EarningCohortCatalog {
    return {
      fields: COHORT_FIELD_CATALOG.map((f) => ({ ...f, operators: opsOf(f) })),
      operators: OPERATORS.map((key) => ({ key, label: OPERATOR_LABELS[key] })),
    };
  }

  /** Goes in just above the default; HO moves it with `reorder`. */
  async create(
    dto: CreateEarningCohortDto,
    by: string,
  ): Promise<EarningCohortView> {
    const conditions =
      dto.conditions !== undefined
        ? this.checkConditions(dto.conditions, dto.filters)
        : filtersToConditions(this.checkFilters(dto.filters));
    const cohorts = await this.all();
    const taken = new Set(cohorts.map((c) => c._id));
    const priority =
      Math.max(
        0,
        ...cohorts
          .filter((c) => c.status === 'active' && c._id !== DEFAULT_COHORT_ID)
          .map((c) => c.priority),
      ) + 1;

    let candidates: string[];
    if (dto.key) {
      const id = dto.key.startsWith('ec_') ? dto.key : `ec_${dto.key}`;
      if (!COHORT_ID_PATTERN.test(id)) {
        throw badRequest(
          'VALIDATION_FAILED',
          'The key is lower-case letters, digits and _ (at most 40).',
        );
      }
      candidates = [id];
    } else {
      const base = cohortIdOf(dto.name) ?? 'ec_cohort';
      candidates = Array.from({ length: ID_TRIES }, (_, i) =>
        withSuffix(base, i + 1),
      );
    }

    for (const id of candidates) {
      if (id === DEFAULT_COHORT_ID || taken.has(id)) continue;
      const created = await this.cohorts.create({
        _id: id,
        name: dto.name,
        description: dto.description || null,
        conditions,
        filters: conditionsToFilters(conditions),
        priority,
        status: 'active',
        meeting_gig_payout: dto.meeting_gig_payout ?? null,
        version: 1,
        created_by: by,
        updated_by: by,
        archived_by: null,
        archived_at: null,
      });
      if (created) {
        this.recomputeAllLater('cohorts_changed');
        return this.adminGet(id);
      }
    }
    throw conflict(
      'COHORT_EXISTS',
      dto.key
        ? 'An earning cohort with this key already exists. Pick another key.'
        : 'No free id is left for this name. Send a key.',
    );
  }

  /**
   * Only what is sent; `conditions` replaces the whole list. Legacy `filters`
   * keys merge over the stored legacy view, then convert — a condition the
   * legacy shape cannot say is dropped by such an edit (the sender cannot
   * see it either).
   */
  async update(
    id: string,
    dto: UpdateEarningCohortDto,
    by: string,
  ): Promise<EarningCohortView> {
    const current = await this.get(id);
    if (current.status === 'archived') {
      throw conflict(
        'EARNING_ARCHIVED',
        'This cohort is archived and can no longer be edited.',
      );
    }
    const set: EarningCohortPatch = {};
    if (dto.name !== undefined) set.name = dto.name;
    if (dto.description !== undefined)
      set.description = dto.description || null;
    if (dto.meeting_gig_payout !== undefined)
      set.meeting_gig_payout = dto.meeting_gig_payout;
    let moved = false;
    if (dto.conditions !== undefined || dto.filters !== undefined) {
      if (id === DEFAULT_COHORT_ID) {
        throw badRequest(
          'EARNING_COHORT_LOCKED',
          'The default cohort takes every partner no other cohort takes, so it has no conditions.',
        );
      }
      if (dto.conditions !== undefined) {
        set.conditions = this.checkConditions(dto.conditions, dto.filters);
      } else {
        const sent = Object.fromEntries(
          Object.entries(dto.filters ?? {}).filter(([, v]) => v !== undefined),
        ) as FiltersInput;
        set.conditions = filtersToConditions(
          this.checkFilters({
            ...conditionsToFilters(current.conditions ?? []),
            ...sent,
          }),
        );
      }
      set.filters = conditionsToFilters(set.conditions);
      moved =
        JSON.stringify(set.conditions) !== JSON.stringify(current.conditions);
    }
    if (Object.keys(set).length === 0) {
      throw badRequest('VALIDATION_FAILED', 'Nothing to change was sent.');
    }
    const saved = await this.cohorts.save(id, dto.version, set, by);
    if (!saved) {
      throw conflict(
        'VERSION_CONFLICT',
        'This cohort was changed on another screen. Reload and try again.',
      );
    }
    if (moved) this.recomputeAllLater('cohorts_changed');
    return this.adminGet(id);
  }

  /** Its partners move to the next cohort that takes them; its history stays. */
  async archive(id: string, by: string): Promise<EarningCohortView> {
    if (id === DEFAULT_COHORT_ID) {
      throw badRequest(
        'EARNING_COHORT_LOCKED',
        'The default cohort cannot be archived.',
      );
    }
    const saved = await this.cohorts.archive(id, by);
    if (!saved) {
      await this.get(id);
      throw conflict('EARNING_ARCHIVED', 'This cohort is already archived.');
    }
    this.recomputeAllLater('cohorts_changed');
    return this.adminGet(id);
  }

  /** Every active cohort but the default, once, first looked at first. */
  async reorder(ids: string[], by: string): Promise<{ ids: string[] }> {
    const active = (await this.all())
      .filter((c) => c.status === 'active' && c._id !== DEFAULT_COHORT_ID)
      .map((c) => c._id);
    const error = orderError(ids, active);
    if (error) throw conflict('EARNING_ORDER_CHANGED', error, [error]);
    await this.cohorts.setPriorities(ids, by);
    this.recomputeAllLater('cohorts_changed');
    return { ids };
  }

  /** HO's button: every partner now, awaited — the answer says how many moved. */
  recomputeNow(): Promise<{ partners: number; changed: number }> {
    return this.recomputeAll('recompute');
  }

  /** One partner: the cohort now, why (their facts), and every stretch before. */
  async partnerView(agentId: string): Promise<PartnerEarningView> {
    const id = agentId.toUpperCase();
    const partner = await this.agents.earningPartner(id);
    if (!partner) throw notFound('This partner could not be found.');
    // Assigns an approved partner never assigned yet.
    if (isWorking(partner)) await this.current(id);
    const [history, cohorts, holdings] = await Promise.all([
      this.assignments.history(id, HISTORY),
      this.all(),
      this.holdingsOf([id]),
    ]);
    const names = new Map(cohorts.map((c) => [c._id, c.name]));
    const open = history.find((h) => h.open);
    return {
      agent_id: id,
      current: open
        ? {
            cohort_id: open.cohort_id,
            name: names.get(open.cohort_id) ?? open.cohort_id,
            since: open.from,
          }
        : null,
      facts: factsOf(partner, holdings.get(id)),
      history: history.map((h) => ({
        cohort_id: h.cohort_id,
        name: names.get(h.cohort_id) ?? h.cohort_id,
        from: h.from,
        to: h.to,
        reason: h.reason,
      })),
    };
  }

  // ── internals ─────────────────────────────────────────────────────────

  private async recomputeOne(
    id: string,
    reason: AssignmentReason,
  ): Promise<RecomputeResult> {
    for (let attempt = 0; attempt < TRIES; attempt++) {
      const [partner, open] = await Promise.all([
        this.agents.earningPartner(id),
        this.assignments.open(id),
      ]);
      if (!partner) throw notFound('This partner could not be found.');
      const stands: RecomputeResult = {
        agent_id: id,
        cohort_id: open?.cohort_id ?? null,
        changed: false,
        since: open?.from ?? null,
      };
      if (!isWorking(partner)) return stands;

      const [cohorts, holdings] = await Promise.all([
        this.all(),
        this.holdingsOf([id]),
      ]);
      const target = pickCohort(cohorts, factsOf(partner, holdings.get(id)));
      if (open?.cohort_id === target) {
        if (partner.earning_cohort?.id !== target) {
          await this.agents.setEarningCohorts([
            { agent_id: id, cohort: { id: target, since: open.from } },
          ]);
        }
        return stands;
      }
      const since = new Date();
      const switched = await this.assignments.switchTo(
        id,
        open?._id ?? null,
        target,
        since,
        reason,
      );
      if (switched) {
        await this.agents.setEarningCohorts([
          { agent_id: id, cohort: { id: target, since } },
        ]);
        return { agent_id: id, cohort_id: target, changed: true, since };
      }
      // Another process moved this partner meanwhile: look again.
    }
    const open = await this.assignments.open(id);
    return {
      agent_id: id,
      cohort_id: open?.cohort_id ?? null,
      changed: false,
      since: open?.from ?? null,
    };
  }

  private holdingsOf(
    agentIds: readonly string[] | null,
  ): Promise<Map<string, Holdings>> {
    if (!this.holdings) {
      // Wiring, not data: the leads module registers this at start-up.
      throw new Error('No lead holdings source is registered.');
    }
    return this.holdings(agentIds);
  }

  /** Each condition against the cohort catalog; every problem is listed. */
  private checkConditions(
    input: readonly { field: string; op: string; value: unknown }[],
    filters: FiltersInput | null | undefined,
  ): RuleCondition[] {
    if (filters !== undefined && filters !== null) {
      throw badRequest(
        'VALIDATION_FAILED',
        'Send conditions or the legacy filters, not both.',
      );
    }
    const out: RuleCondition[] = [];
    const errors: string[] = [];
    for (const c of input) {
      const checked = checkConditionIn(COHORT_FIELD_CATALOG, 'a cohort', c);
      if ('error' in checked) errors.push(checked.error);
      else out.push(checked.ok);
    }
    if (errors.length) throw badRequest('VALIDATION_FAILED', errors[0], errors);
    if (out.length === 0) {
      throw badRequest(
        'VALIDATION_FAILED',
        'Add at least one condition. A cohort with none would take every partner — that is the default cohort.',
      );
    }
    if (out.length > MAX_COHORT_CONDITIONS) {
      throw badRequest(
        'VALIDATION_FAILED',
        `A cohort takes at most ${MAX_COHORT_CONDITIONS} conditions.`,
      );
    }
    return out;
  }

  /** The legacy shape: at least one filter in use. */
  private checkFilters(input: FiltersInput | null | undefined) {
    const filters = normalizeFilters(input);
    if (!hasFilters(filters)) {
      throw badRequest(
        'VALIDATION_FAILED',
        'Add at least one condition (or legacy filter). A cohort with none would take every partner — that is the default cohort.',
      );
    }
    return filters;
  }
}

function withConditions(c: EarningCohortRecord): EarningCohortRecord {
  // A row from before conditions: its legacy filters say what it means.
  return c.conditions
    ? c
    : { ...c, conditions: filtersToConditions(c.filters) };
}

function viewOf(c: EarningCohortRecord, count: number): EarningCohortView {
  const { _id, conditions, ...rest } = withConditions(c);
  const list = conditions ?? [];
  return {
    id: _id,
    ...rest,
    conditions: list,
    filters: conditionsToFilters(list),
    summary: describeCohortConditions(list),
    is_default: _id === DEFAULT_COHORT_ID,
    partners_count: count,
  };
}
