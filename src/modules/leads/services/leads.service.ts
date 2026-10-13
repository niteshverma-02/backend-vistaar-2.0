import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import type { PartnerRef } from '@common/auth/current-partner.decorator';
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  serviceUnavailable,
} from '@common/errors/api-error';
import { PageResult } from '@common/http/page-result';
import { normalizeMobile } from '@common/utils/phone.util';
import { AccessService } from '@modules/access/services/access.service';
import {
  AgentsService,
  type AgentRecord,
  type PartnerCard,
} from '@modules/agents/services/agents.service';
import {
  SettingsService,
  type FarmerConsent,
} from '@modules/settings/services/settings.service';
import { PiiService } from '@modules/spine/services/pii.service';
import { PincodeService } from '@modules/spine/services/pincode.service';

import type {
  AddActivityDto,
  AddFarmerDto,
  AdminLeadQueryDto,
  FarmerLeadQueryDto,
  UpdateLeadDto,
} from '../dto/lead.dto';
import {
  EX_EMPLOYEE_COHORT,
  LEAD_SOURCE,
  MAX_ACTIVITIES,
  MAX_STAGE_HISTORY,
  STAGE_LABELS,
  contactDocOf,
  contactUpdateOf,
  farmerCopyOf,
  holderOf,
  isOpenStage,
  leadDocOf,
  leadUpdateOf,
  stageMoveError,
  titleCase,
  type FarmerInput,
  type Holder,
  type LeadOwner,
  type LeadStage,
} from '../leads.domain';
import { OrgLeadsRepository } from '../repositories/org-leads.repository';
import {
  VistaarLeadsRepository,
  type LeadListFilter,
  type VistaarLeadBrief,
  type VistaarLeadRecord,
} from '../repositories/vistaar-leads.repository';
import type { LeadActivity, StageMove } from '../schemas/vistaar-lead.schema';

/** A lead as the app and the HO portal see it. */
export type LeadView = Omit<
  VistaarLeadBrief,
  '_id' | 'consent' | 'ex_employee_declared_at'
> & {
  consent_version: number;
};

export interface LeadDetail extends LeadView {
  stage_history: StageMove[];
  /** Newest first. */
  activities: LeadActivity[];
}

/** `created` — new to Katyayani; `linked` — an existing Katyayani farmer, now yours; `updated` — yours already. */
export interface SavedLead extends LeadDetail {
  result: 'created' | 'linked' | 'updated';
}

export interface PartnerLeadView extends LeadView {
  partner: PartnerCard | null;
}

/** What the Add-lead screen shows before saving. */
export type CheckStatus =
  'new' | 'yours' | 'other_partner' | 'katyayani' | 'not_farmer' | 'self';

const COUNTRY_CODE = '+91';
/** Tries before giving up on ids the shared counter hands out already taken. */
const ID_TRIES = 3;
const IST_OFFSET_MS = 5.5 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;

const CHECK_STATUS: Record<Holder, CheckStatus> = {
  none: 'new',
  mine: 'yours',
  other_partner: 'other_partner',
  katyayani: 'katyayani',
  not_farmer: 'not_farmer',
};

const taken = () =>
  conflict(
    'FARMER_TAKEN',
    'Another Vistaar partner has already added this farmer.',
  );

const selfLead = () =>
  badRequest('SELF_LEAD', 'You cannot add your own number as a farmer.');

const notFarmer = () =>
  conflict(
    'NOT_A_FARMER',
    'This number is registered with Katyayani as a retailer or business, not a farmer.',
  );

/** Midnight IST that starts the day `now` falls in. */
function istDayStart(now: Date): Date {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  ist.setUTCHours(0, 0, 0, 0);
  return new Date(ist.getTime() - IST_OFFSET_MS);
}

function viewOf(row: VistaarLeadBrief): LeadView {
  const {
    _id: _row,
    consent,
    ex_employee_declared_at: _declared,
    ...view
  } = row;
  return { ...view, consent_version: consent.version };
}

function detailOf(row: VistaarLeadRecord): LeadDetail {
  return {
    ...viewOf(row),
    stage_history: row.stage_history ?? [],
    activities: [...(row.activities ?? [])].reverse(),
  };
}

/**
 * Farmers partners add, and the partner's work on them (PRD C2, C4, C9).
 * ko-sales' `/leads/upsert` is the reference for the org records, written
 * directly as prasar does; the partner's side lives in `vistaar_v2_leads`.
 */
@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    private readonly org: OrgLeadsRepository,
    private readonly rows: VistaarLeadsRepository,
    private readonly agents: AgentsService,
    private readonly piis: PiiService,
    private readonly pincodes: PincodeService,
    private readonly settings: SettingsService,
    private readonly access: AccessService,
  ) {}

  /** Before saving: what adding this number would do. Writes nothing. */
  async check(
    partner: PartnerRef,
    rawPhone: string,
  ): Promise<{ status: CheckStatus; pii_id: string | null }> {
    const phone = this.phoneOf(rawPhone);
    const piiId = await this.piis.findIdByPhone(phone);
    if (!piiId) return { status: 'new', pii_id: null };
    if (piiId === partner.pii_id) return { status: 'self', pii_id: piiId };
    const holder = await this.holder(piiId, partner.agent_id);
    return { status: CHECK_STATUS[holder], pii_id: piiId };
  }

  async consent(): Promise<FarmerConsent> {
    return (await this.settings.get()).farmer_consent;
  }

  /**
   * Add a farmer, or update one the partner holds (same mobile). Every
   * refusal comes before the first write; the partner's row is claimed before
   * the org records, so one farmer can never end up with two partners.
   */
  async upsert(partner: PartnerRef, dto: AddFarmerDto): Promise<SavedLead> {
    const agent = await this.requireWorkingPartner(partner.agent_id);
    const now = new Date();
    const { farmer_consent: consent } = await this.settings.get();
    if (dto.consent_version !== consent.version) {
      throw conflict(
        'CONSENT_OUTDATED',
        'The consent wording has changed — show the farmer the new text and ask again.',
        [`current_version=${consent.version}`],
      );
    }
    if (
      agent.cohort === EX_EMPLOYEE_COHORT &&
      dto.ex_employee_declared !== true
    ) {
      throw badRequest(
        'VALIDATION_FAILED',
        'Confirm you did not handle this farmer while at Katyayani in the last 12 months.',
      );
    }
    const followUp = dto.next_follow_up
      ? this.futureOf(dto.next_follow_up, now)
      : null;
    const phone = this.phoneOf(dto.phone);
    const by = partner.agent_id;

    const known = await this.piis.findIdByPhone(phone);
    if (known === partner.pii_id) throw selfLead();
    const found = known ? await this.found(known) : null;
    const holder = holderOf({
      link: found?.link ?? null,
      lead: found?.lead ?? null,
      contact: found?.contact ?? null,
      agentId: by,
    });
    if (holder === 'other_partner') throw taken();
    if (holder === 'not_farmer') throw notFarmer();

    const origin =
      found?.link?.origin ?? (holder === 'katyayani' ? 'linked' : 'created');
    // A missing owner refuses before anything is written.
    const owner =
      origin === 'created' && !found?.lead ? await this.leadOwner() : null;
    const piiId =
      known ?? (await this.piis.resolve(phone, COUNTRY_CODE)).pii_id;

    const farmer: FarmerInput = { ...dto, phone };
    const place = await this.placeOf(dto, agent);
    const copy = farmerCopyOf(farmer, place);
    const note = dto.note ? [this.activity('note', dto.note, by, now)] : [];

    let result: SavedLead['result'];
    const claimed = found?.link
      ? false
      : await this.rows.insert({
          _id: randomUUID(),
          pii_id: piiId,
          agent_id: by,
          lead_id: found?.lead?.lead_id ?? null,
          origin,
          ...copy,
          found_via: dto.found_via ?? null,
          expected_value: dto.expected_value ?? null,
          stage: 'prospect',
          stage_history: [{ from: null, to: 'prospect', at: now, by }],
          next_follow_up: followUp,
          lost_reason: null,
          activities: note,
          consent: { version: consent.version, at: now },
          ex_employee_declared_at: dto.ex_employee_declared ? now : null,
          customer_at: null,
        });
    if (claimed) {
      result = origin === 'created' ? 'created' : 'linked';
    } else {
      const saved = await this.rows.update(piiId, by, {
        $set: {
          ...copy,
          ...(dto.found_via && { found_via: dto.found_via }),
          ...(dto.expected_value !== undefined && {
            expected_value: dto.expected_value,
          }),
          ...(followUp && { next_follow_up: followUp }),
          consent: { version: consent.version, at: now },
          ...(dto.ex_employee_declared && { ex_employee_declared_at: now }),
        },
        ...(note.length && {
          $push: { activities: { $each: note, $slice: -MAX_ACTIVITIES } },
        }),
      });
      // The row exists but is not this partner's: another one claimed first.
      if (!saved) throw taken();
      result = 'updated';
    }

    const row = await this.rows.findByPii(piiId);
    if (!row) throw notFound('Farmer not found.');
    if (row.origin === 'created') {
      const leadId = await this.writeOrgRecords(
        farmer,
        piiId,
        by,
        place,
        now,
        owner,
      );
      if (leadId !== row.lead_id) {
        await this.rows.update(piiId, by, { $set: { lead_id: leadId } });
        row.lead_id = leadId;
      }
    }
    return { ...detailOf(row), result };
  }

  async listMine(
    partner: PartnerRef,
    query: FarmerLeadQueryDto,
  ): Promise<PageResult<LeadView>> {
    const now = new Date();
    const filter: LeadListFilter = {
      ...this.search(query.q),
      agent_id: partner.agent_id,
      stage: query.stage,
      due_before: query.due
        ? new Date(istDayStart(now).getTime() + DAY_MS - 1)
        : undefined,
    };
    const { items, total } = await this.rows.listByUrgency(filter, query, now);
    return new PageResult(items.map(viewOf), total, query);
  }

  /** The leads screen's cards and Home "follow-ups due" (Lovable Leads.tsx). */
  async summaryMine(partner: PartnerRef) {
    const now = new Date();
    const s = await this.rows.partnerSummary(
      partner.agent_id,
      new Date(istDayStart(now).getTime() + DAY_MS - 1),
    );
    const closed = s.won + s.lost;
    return {
      ...s,
      conversion_pct: closed ? Math.round((s.won * 100) / closed) : 0,
    };
  }

  /**
   * Is this farmer one the partner holds — a lead, or a customer from one?
   * The cart's "Ordering for" asks; the org lead's `lead_owner` is the HO
   * head, so it cannot answer this.
   */
  async holds(agentId: string, piiId: string): Promise<boolean> {
    return this.rows.isHeldBy(piiId.toUpperCase(), agentId.toUpperCase());
  }

  async getMine(partner: PartnerRef, piiId: string): Promise<LeadDetail> {
    return detailOf(await this.mine(partner, piiId));
  }

  /** Stage, follow-up, lost reason, expected value — only what is sent. */
  async update(
    partner: PartnerRef,
    piiId: string,
    dto: UpdateLeadDto,
  ): Promise<LeadDetail> {
    const row = await this.mine(partner, piiId);
    const now = new Date();
    const by = partner.agent_id;
    const set: Record<string, unknown> = {};
    const push: Record<string, unknown> = {};

    const moving = dto.stage !== undefined && dto.stage !== row.stage;
    const stage: LeadStage = moving ? (dto.stage as LeadStage) : row.stage;
    if (moving) {
      const refusal = stageMoveError(row.stage, stage);
      if (refusal) throw conflict('STAGE_NOT_ALLOWED', refusal);
      if (stage === 'lost' && !dto.lost_reason) {
        throw badRequest('VALIDATION_FAILED', 'Pick why the lead was lost.');
      }
      set.stage = stage;
      set.lost_reason = stage === 'lost' ? dto.lost_reason : null;
      if (stage === 'lost') set.next_follow_up = null;
      push.stage_history = {
        $each: [{ from: row.stage, to: stage, at: now, by }],
        $slice: -MAX_STAGE_HISTORY,
      };
      push.activities = {
        $each: [
          this.activity(
            'stage_change',
            stage === 'lost'
              ? `Marked lost — ${dto.lost_reason}`
              : `Moved to ${STAGE_LABELS[stage]}`,
            by,
            now,
          ),
        ],
        $slice: -MAX_ACTIVITIES,
      };
    } else if (dto.lost_reason !== undefined) {
      if (row.stage !== 'lost') {
        throw badRequest(
          'VALIDATION_FAILED',
          'Only a lost lead has a lost reason.',
        );
      }
      set.lost_reason = dto.lost_reason;
    }

    if (dto.next_follow_up !== undefined) {
      if (dto.next_follow_up === null) {
        set.next_follow_up = null;
      } else {
        if (!isOpenStage(stage)) {
          throw badRequest(
            'VALIDATION_FAILED',
            'A closed lead has no follow-up.',
          );
        }
        set.next_follow_up = this.futureOf(dto.next_follow_up, now);
      }
    }
    if (dto.expected_value !== undefined)
      set.expected_value = dto.expected_value;

    if (Object.keys(set).length === 0) return detailOf(row);
    const saved = await this.rows.update(
      row.pii_id,
      by,
      { $set: set, ...(Object.keys(push).length && { $push: push }) },
      { stage: row.stage },
    );
    if (!saved) {
      throw conflict(
        'STAGE_CHANGED',
        'This lead changed meanwhile — reload it.',
      );
    }
    return detailOf(saved);
  }

  /** Call / visit / WhatsApp / note on the lead's log. */
  async addActivity(
    partner: PartnerRef,
    piiId: string,
    dto: AddActivityDto,
  ): Promise<LeadDetail> {
    const saved = await this.rows.update(
      piiId.toUpperCase(),
      partner.agent_id,
      {
        $push: {
          activities: {
            $each: [
              this.activity(dto.type, dto.text, partner.agent_id, new Date()),
            ],
            $slice: -MAX_ACTIVITIES,
          },
        },
      },
    );
    if (!saved) throw notFound('Farmer not found.');
    return detailOf(saved);
  }

  async list(query: AdminLeadQueryDto): Promise<PageResult<PartnerLeadView>> {
    const to = query.to ? new Date(query.to) : undefined;
    if (to && query.to?.length === 10) to.setUTCHours(23, 59, 59, 999);
    const filter: LeadListFilter = {
      ...this.search(query.q),
      agent_id: query.agent_id?.toUpperCase(),
      stage: query.stage,
      origin: query.origin,
      state: query.state?.trim().toUpperCase() || undefined,
      from: query.from ? new Date(query.from) : undefined,
      to,
    };
    const { items, total } = await this.rows.listRecent(filter, query);
    const partners = await this.agents.partnersByAgentIds([
      ...new Set(items.map((r) => r.agent_id)),
    ]);
    return new PageResult(
      items.map((r) => ({
        ...viewOf(r),
        partner: partners.get(r.agent_id) ?? null,
      })),
      total,
      query,
    );
  }

  /** HO cards; "today" is the IST day. */
  async summary() {
    const today = istDayStart(new Date());
    const counts = await this.rows.adminSummary({
      today,
      week: new Date(today.getTime() - 6 * DAY_MS),
    });
    const names = await this.agents.partnersByAgentIds(
      counts.by_partner.map((p) => p.key),
    );
    return {
      ...counts,
      by_partner: counts.by_partner.map((p) => ({
        ...p,
        name: names.get(p.key)?.name ?? null,
      })),
    };
  }

  async get(
    piiId: string,
  ): Promise<LeadDetail & { partner: PartnerCard | null }> {
    const row = await this.rows.findByPii(piiId.toUpperCase());
    if (!row) throw notFound('Farmer not found.');
    const partners = await this.agents.partnersByAgentIds([row.agent_id]);
    return { ...detailOf(row), partner: partners.get(row.agent_id) ?? null };
  }

  private async mine(
    partner: PartnerRef,
    piiId: string,
  ): Promise<VistaarLeadRecord> {
    const row = await this.rows.findByPii(piiId.toUpperCase());
    if (!row || row.agent_id !== partner.agent_id)
      throw notFound('Farmer not found.');
    return row;
  }

  private async found(piiId: string) {
    const [link, lead, contact] = await Promise.all([
      this.rows.findByPii(piiId),
      this.org.leadOf(piiId),
      this.org.contactOf(piiId),
    ]);
    return { link, lead, contact };
  }

  private async holder(piiId: string, agentId: string): Promise<Holder> {
    const { link, lead, contact } = await this.found(piiId);
    return holderOf({ link, lead, contact, agentId });
  }

  /**
   * The org's lead, contact and address for a farmer Vistaar created: made
   * when missing, refreshed when ours. Another writer's rows are left as they
   * are. Answers the lead id.
   */
  private async writeOrgRecords(
    farmer: FarmerInput,
    piiId: string,
    agentId: string,
    place: { state: string; district: string | null },
    now: Date,
    owner: LeadOwner | null,
  ): Promise<string | null> {
    const lead = await this.org.leadOf(piiId);
    let leadId: string | null = lead?.lead_id ?? null;
    if (lead) {
      if (lead.source === LEAD_SOURCE && lead.created_by === agentId) {
        await this.org.updateLead(
          lead.lead_id,
          leadUpdateOf(farmer, { agentId, state: place.state, now }),
        );
      }
    } else {
      leadId = await this.createLead(
        farmer,
        piiId,
        agentId,
        owner ?? (await this.leadOwner()),
        place.state,
        now,
      );
    }

    const contact = await this.org.contactOf(piiId);
    if (!contact) {
      await this.createContact(farmer, piiId, agentId, now);
    } else if (contact.source === LEAD_SOURCE) {
      await this.org.updateContact(
        piiId,
        contactUpdateOf(farmer, { agentId, now }),
      );
    }

    await this.piis.saveAddress(
      piiId,
      {
        village: titleCase(farmer.village),
        district: place.district,
        state: place.state,
        pincode: farmer.pincode ?? null,
      },
      { source: LEAD_SOURCE, by: agentId },
    );
    return leadId;
  }

  private async createLead(
    farmer: FarmerInput,
    piiId: string,
    agentId: string,
    owner: LeadOwner,
    state: string,
    now: Date,
  ): Promise<string | null> {
    for (let attempt = 0; attempt < ID_TRIES; attempt++) {
      const leadId = `L-${100000 + (await this.piis.nextOrgNumber('leads'))}`;
      const result = await this.org.insertLead(
        leadDocOf(farmer, { leadId, piiId, agentId, owner, state, now }),
      );
      if (result === 'ok') return leadId;
      // Another writer gave this person a lead meanwhile: link to it.
      if (result === 'taken_person')
        return (await this.org.leadOf(piiId))?.lead_id ?? null;
      this.logger.warn(`app_counters.leads minted ${leadId}, already taken.`);
    }
    throw this.unavailable();
  }

  private async createContact(
    farmer: FarmerInput,
    piiId: string,
    agentId: string,
    now: Date,
  ): Promise<void> {
    for (let attempt = 0; attempt < ID_TRIES; attempt++) {
      const contactId = `C0-${await this.piis.nextOrgNumber('contacts')}`;
      const result = await this.org.insertContact(
        contactDocOf(farmer, { contactId, piiId, agentId, now }),
      );
      if (result !== 'taken_id') return;
      this.logger.warn(
        `app_counters.contacts minted ${contactId}, already taken.`,
      );
    }
    throw this.unavailable();
  }

  /**
   * The HO portal head owns every farmer lead (user, 2026-10-13): the one
   * active Offline Head, unless HO named an owner in the settings.
   */
  private async leadOwner(): Promise<LeadOwner> {
    const { lead_owner_agent_id: named } = await this.settings.get();
    const owner = named
      ? (await this.access.staffByIds([named])).get(named)
      : await this.access.offlineHead();
    if (!owner?.agent_id || !owner.is_active) {
      throw serviceUnavailable(
        'LEADS_NOT_CONFIGURED',
        'Adding new farmers is not switched on yet: no single active Offline Head (USR-1037) to own the leads.',
      );
    }
    return { agent_id: owner.agent_id, ref: owner.ref };
  }

  /** Approved partners only; a blocked one is told so. */
  private async requireWorkingPartner(agentId: string): Promise<AgentRecord> {
    const agent = await this.agents.requireByAgentId(agentId);
    if (agent.stage === 'blocked' || !agent.is_active) {
      throw forbidden(
        'ACCOUNT_BLOCKED',
        'This account is blocked. Contact Katyayani support.',
      );
    }
    if (agent.stage !== 'approved') {
      throw forbidden(
        'PARTNER_NOT_APPROVED',
        'You can add farmers once your account is approved.',
      );
    }
    return agent;
  }

  /** State from the pincode, else the partner's own state (the farmer is local). */
  private async placeOf(
    dto: AddFarmerDto,
    agent: AgentRecord,
  ): Promise<{ state: string; district: string | null }> {
    const found = dto.pincode ? await this.pincodes.lookup(dto.pincode) : null;
    const state =
      found?.state ?? agent.profile?.state ?? agent.preview?.state ?? '';
    return {
      state: state.trim().toUpperCase(),
      district: dto.district || found?.district || null,
    };
  }

  private phoneOf(raw: string): string {
    const phone = normalizeMobile(raw);
    if (!phone) {
      throw badRequest(
        'INVALID_PHONE',
        'Enter a valid 10-digit mobile number.',
      );
    }
    return phone;
  }

  private futureOf(iso: string, now: Date): Date {
    const at = new Date(iso);
    if (!(at.getTime() > now.getTime())) {
      throw badRequest(
        'VALIDATION_FAILED',
        'Pick a future date and time for the follow-up.',
      );
    }
    return at;
  }

  private activity(
    type: LeadActivity['type'],
    text: string,
    by: string,
    at: Date,
  ): LeadActivity {
    return { id: randomUUID(), type, text, at, by };
  }

  /** Digits look in the mobile; anything else, in the name, village and crops. */
  private search(
    q: string | undefined,
  ): Pick<LeadListFilter, 'text' | 'phone'> {
    if (!q) return {};
    if (/^[\d\s+-]+$/.test(q)) {
      const digits = q.replace(/\D/g, '');
      return { phone: digits.length > 10 ? digits.slice(-10) : digits };
    }
    return { text: q };
  }

  private unavailable() {
    return serviceUnavailable(
      'LEADS_UNAVAILABLE',
      'Could not save the farmer right now. Please try again.',
    );
  }
}
