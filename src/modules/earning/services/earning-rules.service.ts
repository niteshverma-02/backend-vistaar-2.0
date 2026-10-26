import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { badRequest, conflict, notFound } from '@common/errors/api-error';
import { PageResult } from '@common/http/page-result';

import type {
  CreateEarningRuleDto,
  EarningRulesQueryDto,
  ReorderEarningRulesDto,
  RuleConditionDto,
  UpdateEarningRuleDto,
} from '../dto/earning-rule.dto';
import {
  DEFAULT_COIN_REDEEM_PCT,
  EARNING_TRIGGERS,
  MAX_RULES_PER_COHORT,
  OPERATORS,
  OPERATOR_LABELS,
  REWARD_KINDS,
  TRIGGER_CATALOG,
  activeRules,
  checkCondition,
  describeConditions,
  nextRuleOrder,
  opsOf,
  orderError,
  pickRewards,
  ruleEnabled,
  rulePays,
  type CatalogField,
  type EarningTrigger,
  type Facts,
  type Operator,
  type RewardKind,
  type RuleCondition,
  type RuleReward,
} from '../earning.domain';
import {
  EarningRuleRepository,
  type EarningRulePatch,
  type EarningRuleRecord,
} from '../repositories/earning-rule.repository';
import { EarningCohortsService } from './earning-cohorts.service';

export type { EarningRuleRecord } from '../repositories/earning-rule.repository';

/** One reward an event earns — what part C records (pending) for HO to approve. */
export interface EarnedReward {
  rule_id: string;
  rule_name: string;
  cohort_id: string;
  kind: RewardKind;
  /** Coins, or ₹ for a gig. */
  amount: number;
}

export type EarningRuleView = Omit<EarningRuleRecord, '_id' | 'enabled'> & {
  id: string;
  /** HO's ON/OFF switch; `true` on rules from before it. */
  enabled: boolean;
  /** The conditions in words. */
  summary: string;
};

/** `earning_cohort` on the app's `GET /me`. */
export interface AppEarningCohort {
  id: string;
  name: string;
  since: Date | null;
  rules: {
    name: string;
    trigger: EarningTrigger;
    trigger_label: string;
    reward: RuleReward;
    summary: string;
  }[];
}

/** What the HO portal builds the rule form from. */
export interface EarningCatalog {
  triggers: {
    key: EarningTrigger;
    label: string;
    description: string;
    fields: (CatalogField & { operators: readonly Operator[] })[];
  }[];
  operators: { key: Operator; label: string }[];
  reward_kinds: readonly RewardKind[];
}

const NOT_FOUND = 'This earning rule could not be found.';

/**
 * The light rule engine (user's choice, 2026-10-16): HO writes coin / gig
 * rules per earning cohort from the code catalog of triggers and fields; an
 * event is matched against the partner's current cohort's rules.
 */
@Injectable()
export class EarningRulesService {
  constructor(
    private readonly rules: EarningRuleRepository,
    private readonly cohorts: EarningCohortsService,
  ) {}

  // ── For other modules ────────────────────────────────────────────────

  /**
   * What `trigger` earns this partner now: from their current cohort's
   * active rules in HO's order, at most one per reward kind. Writes nothing;
   * the rules come inside the cohort `current` read, so no second read.
   */
  async evaluate(
    agentId: string,
    trigger: EarningTrigger,
    facts: Facts,
  ): Promise<EarnedReward[]> {
    const { cohort, since } = await this.cohorts.current(agentId);
    // Not placed = not approved yet: no cohort, so nothing to earn — the app
    // shows such a partner no "How to earn" either.
    if (!since) return [];
    return pickRewards(cohort.rules, trigger, facts).map((r) => ({
      rule_id: r._id,
      rule_name: r.name,
      cohort_id: cohort._id,
      kind: r.reward.kind,
      amount: r.reward.amount,
    }));
  }

  /**
   * What one order may take in coins now: at most `pct` % of the partner's
   * coins and at most `max` coins (`null` = no cap), from their cohort.
   */
  async coinRedeemLimit(
    agentId: string,
  ): Promise<{ pct: number; max: number | null }> {
    const { cohort } = await this.cohorts.current(agentId);
    return {
      pct: cohort.coin_redeem_pct ?? DEFAULT_COIN_REDEEM_PCT,
      max: cohort.coin_redeem_max ?? null,
    };
  }

  /** The partner's cohort and what it pays for, for the app. */
  async appCohort(agentId: string): Promise<AppEarningCohort> {
    const { cohort, since } = await this.cohorts.current(agentId);
    // A switched-off rule pays nothing, so it is no "how to earn" card either.
    const rules = activeRules(cohort.rules).filter(rulePays);
    return {
      id: cohort._id,
      name: cohort.name,
      since,
      rules: rules.map((r) => ({
        name: r.name,
        trigger: r.trigger,
        trigger_label: TRIGGER_CATALOG[r.trigger].label,
        reward: r.reward,
        summary: describeConditions(r.trigger, r.conditions),
      })),
    };
  }

  // ── HO ────────────────────────────────────────────────────────────────

  catalog(): EarningCatalog {
    return {
      triggers: EARNING_TRIGGERS.map((key) => ({
        key,
        label: TRIGGER_CATALOG[key].label,
        description: TRIGGER_CATALOG[key].description,
        fields: TRIGGER_CATALOG[key].fields.map((f) => ({
          ...f,
          operators: opsOf(f),
        })),
      })),
      operators: OPERATORS.map((key) => ({ key, label: OPERATOR_LABELS[key] })),
      reward_kinds: REWARD_KINDS,
    };
  }

  async list(
    query: EarningRulesQueryDto,
  ): Promise<PageResult<EarningRuleView>> {
    const rows = await this.rules.list({
      cohort_id: query.cohort_id,
      trigger: query.trigger,
      status: query.include_archived ? undefined : 'active',
      enabled: query.enabled,
    });
    return new PageResult(
      rows.slice(query.skip, query.skip + query.limit).map(viewOf),
      rows.length,
      query,
    );
  }

  async get(id: string): Promise<EarningRuleView> {
    return viewOf(await this.require(id));
  }

  /** Goes last in its cohort; HO moves it with `reorder`. */
  async create(
    dto: CreateEarningRuleDto,
    by: string,
  ): Promise<EarningRuleView> {
    const cohort = await this.cohorts.get(dto.cohort_id);
    if (cohort.status !== 'active') throw cohortArchived();
    const conditions = checkConditions(dto.trigger, dto.conditions ?? []);
    if (cohort.rules.length >= MAX_RULES_PER_COHORT) throw rulesFull();
    const saved = await this.rules.add(cohort._id, {
      _id: randomUUID(),
      name: dto.name,
      trigger: dto.trigger,
      conditions,
      reward: { kind: dto.reward.kind, amount: dto.reward.amount },
      order: nextRuleOrder(cohort.rules),
      status: 'active',
      enabled: dto.enabled ?? true,
      version: 1,
      created_by: by,
      updated_by: by,
      archived_by: null,
      archived_at: null,
    });
    if (saved) return viewOf(saved);
    // Archived or filled up by another screen since the read above.
    const now = await this.cohorts.get(cohort._id);
    if (now.status !== 'active') throw cohortArchived();
    throw rulesFull();
  }

  /**
   * Name, conditions, reward, the ON/OFF switch. The trigger and cohort stay —
   * archive and add a new rule instead.
   */
  async update(
    id: string,
    dto: UpdateEarningRuleDto,
    by: string,
  ): Promise<EarningRuleView> {
    const current = await this.require(id);
    if (current.status !== 'active') {
      throw conflict(
        'EARNING_ARCHIVED',
        'This rule is archived and can no longer be edited.',
      );
    }
    const set: EarningRulePatch = {};
    if (dto.name !== undefined) set.name = dto.name;
    if (dto.conditions !== undefined)
      set.conditions = checkConditions(current.trigger, dto.conditions);
    if (dto.reward !== undefined)
      set.reward = { kind: dto.reward.kind, amount: dto.reward.amount };
    if (dto.enabled !== undefined) set.enabled = dto.enabled;
    if (Object.keys(set).length === 0) {
      throw badRequest('VALIDATION_FAILED', 'Nothing to change was sent.');
    }
    const saved = await this.rules.save(id, dto.version, set, by);
    if (!saved) {
      throw conflict(
        'VERSION_CONFLICT',
        'This rule was changed on another screen. Reload and try again.',
      );
    }
    return viewOf(saved);
  }

  /** Stops paying from now; rewards it already gave stay. */
  async archive(id: string, by: string): Promise<EarningRuleView> {
    const saved = await this.rules.archive(id, by);
    if (!saved) {
      await this.require(id);
      throw conflict('EARNING_ARCHIVED', 'This rule is already archived.');
    }
    return viewOf(saved);
  }

  /** Every active rule of the cohort, once, first looked at first. */
  async reorder(
    dto: ReorderEarningRulesDto,
    by: string,
  ): Promise<{ cohort_id: string; ids: string[] }> {
    const cohort = await this.cohorts.get(dto.cohort_id);
    const active = activeRules(cohort.rules).map((r) => r._id);
    const error = orderError(dto.ids, active);
    if (error) throw conflict('EARNING_ORDER_CHANGED', error, [error]);
    await this.rules.setOrder(dto.cohort_id, dto.ids, by);
    return { cohort_id: dto.cohort_id, ids: dto.ids };
  }

  private async require(id: string): Promise<EarningRuleRecord> {
    const rule = await this.rules.find(id);
    if (!rule) throw notFound(NOT_FOUND);
    return rule;
  }
}

const cohortArchived = () =>
  conflict(
    'EARNING_ARCHIVED',
    'This cohort is archived — rules can be added only to an active cohort.',
  );

const rulesFull = () =>
  badRequest(
    'VALIDATION_FAILED',
    `A cohort holds at most ${MAX_RULES_PER_COHORT} rules, archived ones too. Add the rule to a new cohort.`,
  );

/** Each condition checked against the catalog; every problem is listed. */
function checkConditions(
  trigger: EarningTrigger,
  input: readonly RuleConditionDto[],
): RuleCondition[] {
  const out: RuleCondition[] = [];
  const errors: string[] = [];
  for (const c of input) {
    const checked = checkCondition(trigger, c);
    if ('error' in checked) errors.push(checked.error);
    else out.push(checked.ok);
  }
  if (errors.length) throw badRequest('VALIDATION_FAILED', errors[0], errors);
  return out;
}

function viewOf(r: EarningRuleRecord): EarningRuleView {
  const { _id, ...rest } = r;
  return {
    id: _id,
    ...rest,
    enabled: ruleEnabled(r),
    summary: describeConditions(r.trigger, r.conditions),
  };
}
