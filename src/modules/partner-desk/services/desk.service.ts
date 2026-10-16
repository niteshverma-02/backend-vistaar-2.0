import { Injectable } from '@nestjs/common';

import { badRequest } from '@common/errors/api-error';
import { PageResult } from '@common/http/page-result';
import { haversineKm } from '@common/utils/geo.util';
import { AccessService } from '@modules/access/services/access.service';
import {
  AgentsService,
  type AgentRecord,
} from '@modules/agents/services/agents.service';
import {
  OnboardingService,
  type DeskOnboardingView,
} from '@modules/onboarding/services/onboarding.service';
import { SettingsService } from '@modules/settings/services/settings.service';

import { DESK_SORTS, type AgentListQueryDto } from '../dto/desk.dto';
import {
  NetworkRepository,
  type NetworkHit,
} from '../repositories/network.repository';

const NEARBY_LIMIT = 20;

export interface DeskRow {
  agent_id: string | null;
  pii_id: string | null;
  phone: string;
  name: string | null;
  cohort: string | null;
  district: string | null;
  state: string | null;
  stage: string;
  otp_verified: boolean;
  is_approved: boolean;
  completion_pct: number;
  submitted_at: Date | null;
  owner: { agent_id: string; name: string } | null;
  /** From the profile mapped at approval; null before it. */
  email: string | null;
  village: string | null;
  pincode: string | null;
  sub_cohort: string | null;
  /** When HO approved or rejected — the approval date for an active agent. */
  decided_at: Date | null;
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface NearbyReport {
  radius_km: number;
  center: { lat: number; lng: number } | null;
  vistaar: {
    agent_id: string | null;
    name: string | null;
    stage: string;
    distance_km: number;
  }[];
  network: NetworkHit[];
  /** Anything inside the radius — the warning the approve button shows. */
  has_conflicts: boolean;
}

export interface DeskDetail {
  agent: Omit<AgentRecord, 'stage_history'> & {
    stage_history: AgentRecord['stage_history'];
  };
  owner: { agent_id: string; name: string; email: string } | null;
  onboarding: DeskOnboardingView | null;
  nearby: NearbyReport;
}

/**
 * The HO portal's partner pipeline: tab counts, the list, one partner in
 * full (with the nearby-network warning), and the decisions. Composes the
 * agents and onboarding modules; owns no collection.
 */
@Injectable()
export class DeskService {
  constructor(
    private readonly agents: AgentsService,
    private readonly onboarding: OnboardingService,
    private readonly access: AccessService,
    private readonly settings: SettingsService,
    private readonly network: NetworkRepository,
  ) {}

  summary() {
    return this.agents.stageCounts();
  }

  async list(query: AgentListQueryDto): Promise<PageResult<DeskRow>> {
    const sortKey = query.sort.replace(/^-/, '');
    if (!(DESK_SORTS as readonly string[]).includes(sortKey)) {
      throw badRequest(
        'VALIDATION_FAILED',
        'This list cannot be sorted that way. Please sort by created, updated, decided or last login date.',
      );
    }
    const to = query.to ? new Date(query.to) : undefined;
    if (to && query.to?.length === 10) to.setUTCHours(23, 59, 59, 999);

    const { items, total } = await this.agents.list(
      {
        stage: query.stage,
        cohort: query.cohort,
        state: query.state,
        district: query.district,
        owner_agent_id: query.owner_agent_id,
        q: query.q,
        from: query.from ? new Date(query.from) : undefined,
        to,
        include_unverified: query.include_unverified,
      },
      { skip: query.skip, limit: query.limit, sort: query.sortSpec },
    );

    // Two batched reads for the whole page, never one per row.
    const [progress, owners] = await Promise.all([
      this.onboarding.progressFor(
        items.filter((a) => a.onboarding_id).map((a) => a._id),
      ),
      this.access.staffByIds(
        items.map((a) => a.owner_agent_id).filter((x): x is string => !!x),
      ),
    ]);

    const rows = items.map<DeskRow>((a) => {
      const p = progress.get(a._id);
      const owner = a.owner_agent_id ? owners.get(a.owner_agent_id) : undefined;
      return {
        agent_id: a.agent_id,
        pii_id: a.pii_id,
        phone: a.phone,
        name: a.profile?.name ?? a.preview?.name ?? null,
        cohort: a.cohort,
        district: a.profile?.district ?? a.preview?.district ?? null,
        state: a.profile?.state ?? a.preview?.state ?? null,
        stage: a.stage,
        otp_verified: a.otp_verified,
        is_approved: a.is_approved,
        completion_pct: p?.completion_pct ?? 0,
        submitted_at: p?.submitted_at ?? null,
        owner: a.owner_agent_id
          ? { agent_id: a.owner_agent_id, name: owner?.name ?? '' }
          : null,
        email: a.profile?.email ?? null,
        village: a.profile?.village ?? null,
        pincode: a.profile?.pincode ?? a.preview?.pincode ?? null,
        sub_cohort: a.profile?.sub_cohort ?? null,
        decided_at: a.decided_at,
        last_login_at: a.last_login_at,
        created_at: a.created_at,
        updated_at: a.updated_at,
      };
    });
    return new PageResult(rows, total, query);
  }

  async detail(agentId: string, radiusKm?: number): Promise<DeskDetail> {
    const agent = await this.agents.requireByAgentId(agentId);
    const [onboarding, owners] = await Promise.all([
      this.onboarding.forDesk(agent),
      this.access.staffByIds(
        agent.owner_agent_id ? [agent.owner_agent_id] : [],
      ),
    ]);
    const owner = agent.owner_agent_id
      ? owners.get(agent.owner_agent_id)
      : undefined;
    const point = agent.location ?? onboarding?.location ?? null;
    return {
      // Partners from before calls were logged have no list yet.
      agent: { ...agent, verification_calls: agent.verification_calls ?? [] },
      owner:
        owner && agent.owner_agent_id
          ? {
              agent_id: agent.owner_agent_id,
              name: owner.name,
              email: owner.email,
            }
          : null,
      onboarding,
      nearby: await this.nearby(agent, point, radiusKm),
    };
  }

  async nearby(
    agent: AgentRecord,
    point: { coordinates: [number, number] } | null,
    radiusKm?: number,
  ): Promise<NearbyReport> {
    const radius = clampRadius(
      radiusKm ?? (await this.settings.get()).conflict_radius_km,
    );
    if (!point)
      return {
        radius_km: radius,
        center: null,
        vistaar: [],
        network: [],
        has_conflicts: false,
      };

    const [lng, lat] = point.coordinates;
    const geo = { type: 'Point' as const, coordinates: point.coordinates };
    const [approved, applicants, network] = await Promise.all([
      this.agents.near(geo, radius, agent._id, NEARBY_LIMIT),
      this.onboarding.nearby(geo, radius, agent._id, NEARBY_LIMIT),
      this.network.near(lat, lng, radius, NEARBY_LIMIT),
    ]);

    const seen = new Set<string>();
    const vistaar = [
      ...approved.map((a) => ({
        ref: a._id,
        agent_id: a.agent_id,
        name: a.profile?.name ?? a.preview?.name ?? null,
        stage: a.stage,
        coords: a.location?.coordinates,
      })),
      ...applicants.map((d) => ({
        ref: d.agent_ref,
        agent_id: d.agent_id,
        name: null,
        stage: 'applicant',
        coords: d.location?.coordinates,
      })),
    ]
      .filter((v) => !seen.has(v.ref) && seen.add(v.ref) && v.coords)
      .map(({ agent_id, name, stage, coords }) => ({
        agent_id,
        name,
        stage,
        distance_km:
          Math.round(
            haversineKm(
              lat,
              lng,
              (coords as [number, number])[1],
              (coords as [number, number])[0],
            ) * 100,
          ) / 100,
      }))
      .sort((a, b) => a.distance_km - b.distance_km);

    return {
      radius_km: radius,
      center: { lat, lng },
      vistaar,
      network,
      has_conflicts: vistaar.length + network.length > 0,
    };
  }

  // ── decisions ──────────────────────────────────────────────────────────

  editOnboarding(agentId: string, data: Record<string, unknown>, by: string) {
    return this.withAgent(agentId, (a) =>
      this.onboarding.deskEdit(a, data, by),
    );
  }

  reviewDocument(
    agentId: string,
    key: string,
    decision: 'verified' | 'rejected',
    reason: string | undefined,
    by: string,
  ) {
    return this.withAgent(agentId, (a) =>
      this.onboarding.reviewDocument(a, key, decision, reason, by),
    );
  }

  requestChanges(agentId: string, remarks: Record<string, string>, by: string) {
    return this.withAgent(agentId, (a) =>
      this.onboarding.requestChanges(a, remarks, by),
    );
  }

  approve(agentId: string, by: string) {
    return this.withAgent(agentId, (a) => this.onboarding.approve(a, by));
  }

  reject(agentId: string, reason: string, by: string) {
    return this.withAgent(agentId, (a) =>
      this.agents.reject(a, by, reason.trim()),
    );
  }

  block(agentId: string, reason: string, by: string) {
    return this.withAgent(agentId, (a) =>
      this.agents.move(a, 'block', by, { reason: reason.trim() }),
    );
  }

  unblock(agentId: string, reason: string | undefined, by: string) {
    return this.withAgent(agentId, (a) => this.agents.unblock(a, by, reason));
  }

  reopen(agentId: string, reason: string | undefined, by: string) {
    return this.withAgent(agentId, (a) =>
      this.agents.move(a, 'reopen', by, {
        ...(reason ? { reason } : {}),
        set: { is_approved: false, rejection_reason: null },
      }),
    );
  }

  async setOwner(agentId: string, ownerAgentId: string, by: string) {
    const owner = (await this.access.staffByIds([ownerAgentId])).get(
      ownerAgentId,
    );
    if (!owner?.is_active)
      throw badRequest(
        'OWNER_NOT_FOUND',
        'No active staff member was found with this ID. Please check the owner.',
      );
    return this.withAgent(agentId, (a) =>
      this.agents.setOwner(a, ownerAgentId, by),
    );
  }

  private async withAgent<T>(
    agentId: string,
    run: (agent: AgentRecord) => Promise<T>,
  ): Promise<T> {
    return run(await this.agents.requireByAgentId(agentId));
  }
}

const clampRadius = (km: number): number =>
  Number.isFinite(km) ? Math.min(Math.max(km, 0.5), 50) : 5;
