import { Injectable, Logger } from '@nestjs/common';

import type { Stage } from '@modules/agents/agents.domain';
import { AgentsService } from '@modules/agents/services/agents.service';
import {
  EarningRulesService,
  type AppEarningCohort,
} from '@modules/earning/services/earning-rules.service';

import { OnboardingRepository } from '../repositories/onboarding.repository';

export type NextAction =
  | 'choose_cohort'
  | 'complete_onboarding'
  | 'fix_requested_changes'
  | 'wait_for_review'
  | 'approved'
  | 'rejected'
  | 'blocked';

export interface MeView {
  agent_id: string | null;
  pii_id: string | null;
  phone: string;
  country_code: string;
  stage: Stage;
  is_approved: boolean;
  next_action: NextAction;
  /** Ordering also needs Product Knowledge L1 (later); today: approved. */
  ordering_unlocked: boolean;
  rejection_reason: string | null;
  onboarding: {
    onboarding_id: string;
    cohort: string;
    completion_pct: number;
    submitted_at: Date | null;
    fields_to_fix: number;
  } | null;
  profile: Record<string, unknown> | null;
  /** The partner's earning cohort and what it pays for; `null` until approved. */
  earning_cohort: AppEarningCohort | null;
  member_since: Date;
}

const NEXT: Record<Stage, NextAction> = {
  signed_up: 'choose_cohort',
  onboarding: 'complete_onboarding',
  changes_requested: 'fix_requested_changes',
  kyc_review: 'wait_for_review',
  approved: 'approved',
  rejected: 'rejected',
  blocked: 'blocked',
};

/** The app's home/status screen in one call. */
@Injectable()
export class MeService {
  private readonly logger = new Logger(MeService.name);

  constructor(
    private readonly agents: AgentsService,
    private readonly onboarding: OnboardingRepository,
    private readonly earning: EarningRulesService,
  ) {}

  async get(agentRef: string): Promise<MeView> {
    // `agent_ref` is the token's `sub`, so both reads go out together.
    const [agent, doc] = await Promise.all([
      this.agents.require(agentRef),
      this.onboarding.findByAgent(agentRef),
    ]);
    const earning_cohort =
      agent.stage === 'approved' && agent.agent_id
        ? await this.earningOf(agent.agent_id)
        : null;
    return {
      agent_id: agent.agent_id,
      pii_id: agent.pii_id,
      phone: agent.phone,
      country_code: agent.country_code,
      stage: agent.stage,
      is_approved: agent.is_approved,
      next_action: NEXT[agent.stage],
      ordering_unlocked: agent.is_approved && agent.stage === 'approved',
      rejection_reason:
        agent.stage === 'rejected' ? agent.rejection_reason : null,
      onboarding: doc
        ? {
            onboarding_id: doc._id,
            cohort: doc.cohort,
            completion_pct: doc.completion_pct,
            submitted_at: doc.submitted_at,
            fields_to_fix:
              agent.stage === 'changes_requested'
                ? Object.keys(doc.remarks ?? {}).length
                : 0,
          }
        : null,
      profile: agent.profile ? { ...agent.profile } : null,
      earning_cohort,
      member_since: agent.created_at,
    };
  }

  /** Never fails `/me` — the app routes on it; the cohort is extra. */
  private async earningOf(agentId: string): Promise<AppEarningCohort | null> {
    try {
      return await this.earning.appCohort(agentId);
    } catch (error) {
      this.logger.warn(
        `Earning cohort of ${agentId} not read: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }
}
