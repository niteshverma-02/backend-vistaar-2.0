import { Injectable, Logger } from '@nestjs/common';

import { badRequest } from '@common/errors/api-error';
import { OFFLINE_HEAD_ROLE } from '@modules/access/access.domain';
import { AccessService } from '@modules/access/services/access.service';
import {
  partnerTimeline,
  type Stage,
  type TimelineEntry,
} from '@modules/agents/agents.domain';
import {
  AgentsService,
  type NameChangeResult,
  type PendingName,
  type ProfileEdit,
} from '@modules/agents/services/agents.service';
import { EarningCohortsService } from '@modules/earning/services/earning-cohorts.service';
import {
  EarningRulesService,
  type AppEarningCohort,
} from '@modules/earning/services/earning-rules.service';
import { PincodeService } from '@modules/spine/services/pincode.service';
import { StorageService } from '@modules/uploads/services/storage.service';

import type { UpdateMeDto } from '../dto/me.dto';
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
  /** Signed for an hour; `null` without a photo. */
  photo_url: string | null;
  /** A new name waiting for HO; `profile.name` stays until it is approved. */
  pending_name: PendingName | null;
  /** HO's last decision on a name change (a refusal carries its reason). */
  name_change: Omit<NameChangeResult, 'by'> | null;
  /** The partner's HO owner, for the Profile and Help cards. */
  reporting_officer: ReportingOfficer | null;
  timeline: TimelineEntry[];
  member_since: Date;
}

export interface ReportingOfficer {
  agent_id: string;
  name: string;
  phone: string | null;
  /** The role's name; `null` for a role this server does not name. */
  role: string | null;
}

const ROLE_NAMES: Record<string, string> = {
  [OFFLINE_HEAD_ROLE]: 'Offline Head',
  'USR-1000': 'Super Admin',
  'USR-1001': 'Admin',
};

const NEXT: Record<Stage, NextAction> = {
  signed_up: 'choose_cohort',
  onboarding: 'complete_onboarding',
  changes_requested: 'fix_requested_changes',
  kyc_review: 'wait_for_review',
  approved: 'approved',
  rejected: 'rejected',
  blocked: 'blocked',
};

/** The profile keys an earning cohort's conditions test. */
const PLACE_KEYS = ['state', 'district', 'pincode'] as const;

/** Same rule as onboarding files: the person's own folder, nothing clever in the path. */
const ownPath = (path: string, piiId: string | null): boolean =>
  !!piiId &&
  path.startsWith(`KO-documents/${piiId}/`) &&
  !path.includes('..') &&
  path.length < 300;

/** The app's home/status screen in one call, and the partner's own profile edit. */
@Injectable()
export class MeService {
  private readonly logger = new Logger(MeService.name);

  constructor(
    private readonly agents: AgentsService,
    private readonly onboarding: OnboardingRepository,
    private readonly earning: EarningRulesService,
    private readonly access: AccessService,
    private readonly pincodes: PincodeService,
    private readonly storage: StorageService,
    private readonly cohorts: EarningCohortsService,
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
    const photo = agent.profile?.photo ?? null;
    const [officer, urls] = await Promise.all([
      this.officer(agent.owner_agent_id),
      photo ? this.storage.sign([photo]) : null,
    ]);
    const nameChange = agent.name_change ?? null;
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
      profile: agent.profile ? maskedProfile(agent.profile) : null,
      earning_cohort,
      photo_url: (photo && urls?.get(photo)) ?? null,
      pending_name: agent.pending_name ?? null,
      name_change: nameChange
        ? {
            value: nameChange.value,
            approved: nameChange.approved,
            reason: nameChange.reason,
            at: nameChange.at,
          }
        : null,
      reporting_officer: officer,
      timeline: partnerTimeline(agent),
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

  /**
   * Approved partners only. A pincode's state and district (pincode book)
   * win over typed ones; a new name waits for HO. Only `vistaar_v2_agents`
   * is written — never the shared `piis`.
   */
  async update(
    agentRef: string,
    agentId: string,
    dto: UpdateMeDto,
  ): Promise<MeView> {
    const agent = await this.agents.requireWorkingPartner(
      agentId,
      'edit your profile',
    );
    const { name, photo, pincode, ...typed } = dto;
    const edit: ProfileEdit = Object.fromEntries(
      Object.entries(typed).filter(([, v]) => v !== undefined),
    );
    if (pincode !== undefined) {
      edit.pincode = pincode;
      const place = await this.pincodes.lookup(pincode);
      if (place?.state) edit.state = place.state;
      if (place?.district) edit.district = place.district;
    }
    if (photo !== undefined) {
      await this.requirePhoto(agent.pii_id, photo);
      edit.photo = photo;
    }
    const current = agent.profile?.name ?? agent.preview?.name ?? null;
    const pendingName = name && name !== current ? name : null;

    await this.agents.editProfile(agent, edit, pendingName);
    // Cohorts test the profile's state / district / pincode, so a move can
    // change what the partner earns; the answer then carries the new cohort.
    if (PLACE_KEYS.some((key) => edit[key] !== undefined)) {
      await this.cohorts
        .recompute(agentId, 'profile_changed')
        .catch((error: unknown) =>
          this.logger.warn(
            `Earning cohort of ${agentId} not recomputed after a profile edit: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
    }
    return this.get(agentRef);
  }

  private async officer(
    ownerAgentId: string | null,
  ): Promise<ReportingOfficer | null> {
    if (!ownerAgentId) return null;
    const staff = (await this.access.staffByIds([ownerAgentId])).get(
      ownerAgentId,
    );
    if (!staff) return null;
    return {
      agent_id: ownerAgentId,
      name: staff.name,
      phone: staff.phone,
      role: ROLE_NAMES[staff.user_role ?? ''] ?? null,
    };
  }

  /** An uploaded image in the partner's own folder (POST /uploads), not a PDF. */
  private async requirePhoto(piiId: string | null, path: string) {
    const notFound = () =>
      badRequest(
        'IMAGE_NOT_FOUND',
        'The photo was not found. Please upload it again.',
      );
    if (!ownPath(path, piiId)) throw notFound();
    const file = await this.storage.stat(path);
    if (!file) throw notFound();
    if (!file.contentType.startsWith('image/')) {
      throw badRequest(
        'FILE_TYPE_NOT_ALLOWED',
        'Please choose a photo (JPG, PNG, WEBP or HEIC) for your profile.',
      );
    }
  }
}

/** The partner sees the last 4 digits of the payout account, never the number. */
function maskedProfile(
  profile: NonNullable<
    Awaited<ReturnType<AgentsService['requireByAgentId']>>['profile']
  >,
): Record<string, unknown> {
  const details = profile.details;
  const bank = details?.bank_account as Record<string, unknown> | undefined;
  if (!details || !bank) return { ...profile };
  const number =
    typeof bank.account_number === 'string' ? bank.account_number : '';
  return {
    ...profile,
    details: {
      ...details,
      bank_account: {
        account_holder: bank.account_holder ?? null,
        account_last4: number ? number.slice(-4) : null,
        ifsc: bank.ifsc ?? null,
      },
    },
  };
}
