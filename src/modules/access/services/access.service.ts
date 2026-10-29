import { Injectable } from '@nestjs/common';

import type { AdminPrincipal } from '@common/interfaces/principal.interface';

import {
  OFFLINE_HEAD_ROLE,
  capabilitiesFor,
  roleOf,
  type Capability,
  type Role,
} from '../access.domain';
import {
  StaffAccountRepository,
  type StaffRecord,
} from '../repositories/staff-account.repository';
import { OfflineCrmSettingsRepository } from '../repositories/offline-crm-settings.repository';

export interface AdminAccess {
  email: string;
  agent_id: string | null;
  name: string;
  /** null — signed in to SSO, but no Vistaar access. */
  role: Role | null;
  role_code: string | null;
  capabilities: Capability[];
}

const MAX_CACHED = 1_000;

/**
 * The caller's role, **read once per token** (franchise-offline-hub's rule:
 * a session keeps the role it was issued with until it expires). Keyed on
 * `email|iat` and dropped at `exp`; concurrent requests share one read.
 */
@Injectable()
export class AccessService {
  private readonly cache = new Map<
    string,
    { exp: number; access: Promise<AdminAccess> }
  >();

  constructor(
    private readonly staff: StaffAccountRepository,
    private readonly crmSettings: OfflineCrmSettingsRepository,
  ) {}

  accessFor(admin: AdminPrincipal): Promise<AdminAccess> {
    const key = `${admin.email}|${admin.iat}`;
    const now = Date.now() / 1000;
    const hit = this.cache.get(key);
    if (hit && hit.exp > now) return hit.access;

    if (this.cache.size >= MAX_CACHED) this.sweep(now);
    const access = this.read(admin.email).catch((error: unknown) => {
      this.cache.delete(key);
      throw error;
    });
    this.cache.set(key, { exp: admin.exp, access });
    return access;
  }

  /**
   * The Offline Head (`USR-1037`) who owns the offline leads — the same one
   * the POS and prasar file under (user, 2026-10-28): the head head office
   * picked in franchise-offline-hub, else the one active head. `null` when
   * the pick is no longer an active head, or there are several and none is
   * picked.
   */
  async offlineHead(): Promise<StaffRecord | null> {
    const picked = await this.crmSettings.pickedLeadOwner();
    if (picked) {
      const head = (await this.staffByIds([picked])).get(picked);
      return head?.is_active && head.user_role === OFFLINE_HEAD_ROLE
        ? head
        : null;
    }
    const heads = await this.staff.findActiveByRole(OFFLINE_HEAD_ROLE, 2);
    return heads.length === 1 && heads[0].agent_id ? heads[0] : null;
  }

  /** Staff by `agent_id`, for owner names and the owner picker. */
  async staffByIds(agentIds: string[]): Promise<Map<string, StaffRecord>> {
    const rows = await this.staff.findByAgentIds([...new Set(agentIds)]);
    return new Map(
      rows.filter((r) => r.agent_id).map((r) => [r.agent_id as string, r]),
    );
  }

  private async read(email: string): Promise<AdminAccess> {
    const account = await this.staff.findByEmail(email);
    const role = roleOf(account?.user_role, account?.is_active === true);
    return {
      email,
      agent_id: account?.agent_id ?? null,
      name: account?.name ?? '',
      role,
      role_code: account?.user_role ?? null,
      capabilities: role ? capabilitiesFor(role, email) : [],
    };
  }

  private sweep(now: number): void {
    for (const [key, entry] of this.cache)
      if (entry.exp <= now) this.cache.delete(key);
    if (this.cache.size >= MAX_CACHED) this.cache.clear();
  }
}
