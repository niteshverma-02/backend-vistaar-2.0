import { randomUUID } from 'node:crypto';

import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';

import type { PartnerRef } from '@common/auth/current-partner.decorator';
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  serviceUnavailable,
} from '@common/errors/api-error';
import type { LocationDto } from '@common/dto/location.dto';
import { PageResult } from '@common/http/page-result';
import { toPoint, type GeoPoint } from '@common/utils/geo.util';
import { DAY_MS, istDayStart } from '@common/utils/ist-day.util';
import { normalizeMobile } from '@common/utils/phone.util';
import { AccessService } from '@modules/access/services/access.service';
import {
  AgentsService,
  type AgentRecord,
  type PartnerCard,
} from '@modules/agents/services/agents.service';
import {
  EarningCohortsService,
  type Holdings,
} from '@modules/earning/services/earning-cohorts.service';
import { RewardsService } from '@modules/rewards/services/rewards.service';
import {
  SettingsService,
  type FarmerConsent,
} from '@modules/settings/services/settings.service';
import { PiiService } from '@modules/spine/services/pii.service';
import { PincodeService } from '@modules/spine/services/pincode.service';

import {
  ADMIN_LEAD_SORTS,
  type AddActivityDto,
  type AddFarmerDto,
  type AdminLeadQueryDto,
  type FarmerLeadQueryDto,
  type LeadPlacesQueryDto,
  type TransferLeadDto,
  type UpdateLeadDto,
} from '../dto/lead.dto';
import {
  EX_EMPLOYEE_COHORT,
  LEAD_SOURCE,
  MAX_ACTIVITIES,
  MAX_HOLDER_HISTORY,
  MAX_STAGE_HISTORY,
  STAGE_LABELS,
  contactDocOf,
  contactUpdateOf,
  farmerCopyOf,
  fixFits,
  holderOf,
  isOpenStage,
  leadDocOf,
  leadUpdateOf,
  releaseAtOf,
  replaceableBy,
  inviteOrder,
  searchOf,
  stageMoveError,
  titleCase,
  type FarmerInput,
  type HoldEnd,
  type Holder,
  type LeadOwner,
  type LeadStage,
  type LocationSource,
  type ReleaseWindow,
} from '../leads.domain';
import { OrgLeadsRepository } from '../repositories/org-leads.repository';
import {
  VistaarLeadsRepository,
  type LeadListFilter,
  type VistaarLeadRecord,
} from '../repositories/vistaar-leads.repository';
import {
  detailOf,
  placeOf as farmerPlace,
  viewOf,
  type LeadDetail,
  type LeadView,
} from '../lead-views';
import type { HolderMove, LeadActivity } from '../schemas/vistaar-lead.schema';
import { LeadOtpService } from './lead-otp.service';

export type { LeadDetail, LeadView };

/** One farmer a partner can invite to a meeting. */
export interface InviteeCard {
  pii_id: string;
  name: string;
  phone: string;
  village: string;
  stage: LeadStage;
}

/** Far above one partner's book; only a bound on a runaway read. */
const INVITEE_CAP = 2000;

/** `created` — new to Katyayani; `linked` — an existing Katyayani farmer, now yours; `updated` — yours already. */
export interface SavedLead extends LeadDetail {
  result: 'created' | 'linked' | 'updated';
}

export interface PartnerLeadView extends LeadView {
  partner: PartnerCard | null;
}

/** A farmer's place as a save decides it. */
interface Spot {
  location: GeoPoint | null;
  location_source: LocationSource | null;
  location_at: Date | null;
}

/** HO's view of one farmer: the lead, its partner and the partners before. */
export interface AdminLeadDetail extends LeadDetail {
  partner: PartnerCard | null;
  holder_history: HolderMove[];
}

/** What the Add-lead screen shows before saving. */
export type CheckStatus =
  | 'new'
  | 'yours'
  | 'other_partner'
  | 'released'
  | 'katyayani'
  | 'not_farmer'
  | 'self';

const COUNTRY_CODE = '+91';
/** As sign-in: the app shows "resend" after this. */
const RESEND_AFTER_SECONDS = 30;
/** Tries before giving up on ids the shared counter hands out already taken. */
const ID_TRIES = 3;

const CHECK_STATUS: Record<Holder, CheckStatus> = {
  none: 'new',
  mine: 'yours',
  other_partner: 'other_partner',
  released: 'released',
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

/** A farmer as HO's cart lists name them. */
export interface FarmerCard {
  pii_id: string;
  name: string;
  phone: string;
  village: string;
  district: string | null;
}

/**
 * Farmers partners add, and the partner's work on them (PRD C2, C4, C9).
 * ko-sales' `/leads/upsert` is the reference for the org records, written
 * directly as prasar does; the partner's side lives in `vistaar_v2_leads`.
 */
@Injectable()
export class LeadsService implements OnModuleInit {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    private readonly org: OrgLeadsRepository,
    private readonly rows: VistaarLeadsRepository,
    private readonly agents: AgentsService,
    private readonly piis: PiiService,
    private readonly pincodes: PincodeService,
    private readonly settings: SettingsService,
    private readonly access: AccessService,
    private readonly earning: EarningCohortsService,
    private readonly leadOtp: LeadOtpService,
    private readonly rewards: RewardsService,
  ) {}

  /** Earning cohorts match on what a partner holds; they read it through here. */
  onModuleInit(): void {
    this.earning.useHoldings((agentIds) => this.holdings(agentIds));
  }

  /** Open leads and customers per partner (`VST-` id), now. */
  async holdings(
    agentIds: readonly string[] | null,
  ): Promise<Map<string, Holdings>> {
    const rows = await this.rows.holdings(agentIds);
    return new Map(
      rows.map((r) => [
        r.agent_id,
        { open_leads: r.open_leads, customers: r.customers },
      ]),
    );
  }

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

  /** The farmer's OTP, before adding them (mandatory, TL 2026-10-16). */
  async sendFarmerOtp(
    partner: PartnerRef,
    rawPhone: string,
    resend: boolean,
  ): Promise<{ sent: true; resend_after_seconds: number }> {
    await this.requireWorkingPartner(partner.agent_id);
    await this.leadOtp.send(this.phoneOf(rawPhone), resend);
    return { sent: true, resend_after_seconds: RESEND_AFTER_SECONDS };
  }

  /** A right OTP → the token `POST /leads` takes for this mobile, for 15 minutes. */
  async verifyFarmerOtp(
    partner: PartnerRef,
    rawPhone: string,
    otp: string,
  ): Promise<{ otp_token: string; expires_at: Date }> {
    await this.requireWorkingPartner(partner.agent_id);
    return this.leadOtp.verify(partner.agent_id, this.phoneOf(rawPhone), otp);
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
    // Before anything is looked up or written: the farmer's own OTP said yes.
    const otpVerifiedAt = this.leadOtp.check(by, phone, dto.otp_token, now);

    const known = await this.piis.findIdByPhone(phone);
    if (known === partner.pii_id) throw selfLead();
    const found = known ? await this.found(known) : null;
    const lapse = await this.lapseOf(found?.link ?? null, by, now);
    const holder = holderOf({
      link: found?.link ?? null,
      released: lapse !== null,
      lead: found?.lead ?? null,
      contact: found?.contact ?? null,
      agentId: by,
    });
    if (holder === 'other_partner') throw taken();
    if (holder === 'not_farmer') throw notFarmer();

    // Taking over a farmer another partner let go: the org's records stay theirs.
    const origin =
      holder === 'released'
        ? 'linked'
        : (found?.link?.origin ??
          (holder === 'katyayani' ? 'linked' : 'created'));
    // A missing owner refuses before anything is written.
    const owner =
      origin === 'created' && !found?.lead ? await this.leadOwner() : null;
    const piiId =
      known ?? (await this.piis.resolve(phone, COUNTRY_CODE)).pii_id;

    const farmer: FarmerInput = { ...dto, phone };
    const place = await this.placeOf(dto, agent);
    const copy = farmerCopyOf(farmer, place);
    const note = dto.note ? [this.activity('note', dto.note, by, now)] : [];
    const spot = await this.spotFrom(dto.location, copy.pincode, 'add', now);

    let result: SavedLead['result'];
    const released = holder === 'released' ? found?.link : null;
    if (released && lapse) {
      const fresh = this.freshHold(released.stage, by, by, now);
      const saved = await this.rows.takeOver(piiId, released, {
        $set: {
          ...fresh,
          ...copy,
          origin,
          found_via: dto.found_via ?? null,
          expected_value: dto.expected_value ?? null,
          next_follow_up: isOpenStage(fresh.stage) ? followUp : null,
          activities: note,
          consent: { version: consent.version, at: now },
          ex_employee_declared_at: dto.ex_employee_declared ? now : null,
          otp_verified_at: otpVerifiedAt,
        },
        $push: {
          holder_history: {
            $each: [this.holdEnd(released, lapse, by, now)],
            $slice: -MAX_HOLDER_HISTORY,
          },
        },
      });
      // The holder worked the farmer (or someone else took them) meanwhile.
      if (!saved) throw taken();
      result = 'linked';
    } else {
      result = await this.claimOrUpdate({
        found: found?.link ?? null,
        piiId,
        by,
        origin,
        leadId: found?.lead?.lead_id ?? null,
        copy,
        dto,
        followUp,
        note,
        consentVersion: consent.version,
        otpVerifiedAt,
        now,
      });
    }

    const row = await this.rows.findByPii(piiId);
    if (!row) throw notFound('Farmer not found.');
    if (row.origin === 'created' && row.agent_id === by) {
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
    if (row.agent_id === by && (await this.applySpot(piiId, by, spot))) {
      Object.assign(row, spot);
    }
    // A farmer new to this partner (and gone from the one who let them go).
    if (result !== 'updated') {
      // First, so the reward is the cohort's at the moment of the event —
      // the recompute below may move the partner on this very lead.
      await this.rewards.leadCreated(by, {
        pii_id: row.pii_id,
        name: row.name,
        crops: row.crops,
        acreage: row.acreage,
        district: row.district,
        state: row.state,
      });
      this.earning.recomputeLater(
        released ? [by, released.agent_id] : [by],
        'holdings_changed',
      );
    }
    return { ...detailOf(row, await this.window()), result };
  }

  /** A new row for the farmer, or the partner's own row refreshed. */
  private async claimOrUpdate(input: {
    found: VistaarLeadRecord | null;
    piiId: string;
    by: string;
    origin: 'created' | 'linked';
    leadId: string | null;
    copy: ReturnType<typeof farmerCopyOf>;
    dto: AddFarmerDto;
    followUp: Date | null;
    note: LeadActivity[];
    consentVersion: number;
    otpVerifiedAt: Date;
    now: Date;
  }): Promise<SavedLead['result']> {
    const { found, piiId, by, origin, copy, dto, followUp, note, now } = input;
    const consent = { version: input.consentVersion, at: now };
    const claimed = found
      ? false
      : await this.rows.insert({
          _id: randomUUID(),
          pii_id: piiId,
          agent_id: by,
          lead_id: input.leadId,
          origin,
          ...copy,
          found_via: dto.found_via ?? null,
          expected_value: dto.expected_value ?? null,
          stage: 'prospect',
          stage_history: [{ from: null, to: 'prospect', at: now, by }],
          next_follow_up: followUp,
          lost_reason: null,
          activities: note,
          consent,
          ex_employee_declared_at: dto.ex_employee_declared ? now : null,
          otp_verified_at: input.otpVerifiedAt,
          customer_at: null,
          last_order_at: null,
          held_since: now,
          last_worked_at: now,
          holder_history: [],
          location: null,
          location_source: null,
          location_at: null,
        });
    if (claimed) return origin === 'created' ? 'created' : 'linked';

    const saved = await this.rows.update(piiId, by, {
      $set: {
        ...copy,
        ...(dto.found_via && { found_via: dto.found_via }),
        ...(dto.expected_value !== undefined && {
          expected_value: dto.expected_value,
        }),
        ...(followUp && { next_follow_up: followUp }),
        consent,
        ...(dto.ex_employee_declared && { ex_employee_declared_at: now }),
        otp_verified_at: input.otpVerifiedAt,
        last_worked_at: now,
      },
      ...(note.length && {
        $push: { activities: { $each: note, $slice: -MAX_ACTIVITIES } },
      }),
    });
    // The row exists but is not this partner's: another one claimed first.
    if (!saved) throw taken();
    return 'updated';
  }

  async listMine(
    partner: PartnerRef,
    query: FarmerLeadQueryDto,
  ): Promise<PageResult<LeadView>> {
    const now = new Date();
    const filter: LeadListFilter = {
      ...searchOf(query.q),
      agent_id: partner.agent_id,
      stage: query.stage,
      due_before: query.due
        ? new Date(istDayStart(now).getTime() + DAY_MS - 1)
        : undefined,
    };
    const [{ items, total }, window] = await Promise.all([
      this.rows.listByUrgency(filter, query, now),
      this.window(),
    ]);
    return new PageResult(
      items.map((r) => viewOf(r, window)),
      total,
      query,
    );
  }

  /** The leads screen's cards and Home "follow-ups due" (Lovable Leads.tsx). */
  async summaryMine(partner: PartnerRef) {
    const now = new Date();
    const s = await this.rows.partnerSummary(
      partner.agent_id,
      new Date(istDayStart(now).getTime() + DAY_MS - 1),
    );
    // The app's tile: won of all leads (Lovable Leads.tsx), not of closed ones.
    return {
      ...s,
      conversion_pct: s.total ? Math.round((s.won * 100) / s.total) : 0,
    };
  }

  /**
   * My Performance: leads added in `[from, to)` and how they ended, and
   * follow-ups overdue now (before today, IST).
   */
  async performance(
    agentId: string,
    from: Date,
    to: Date,
  ): Promise<{
    total: number;
    won: number;
    lost: number;
    /** Won of all leads added, as the leads screen's tile. */
    conversion_pct: number | null;
    overdue_follow_ups: number;
  }> {
    const r = await this.rows.performance(
      agentId,
      from,
      to,
      istDayStart(new Date()),
    );
    return {
      total: r.total,
      won: r.won,
      lost: r.lost,
      conversion_pct: r.total ? Math.round((r.won * 100) / r.total) : null,
      overdue_follow_ups: r.overdue,
    };
  }

  /**
   * Is this farmer one the partner holds — a lead, or a customer from one?
   * The cart's "Ordering for" asks; the org lead's `lead_owner` is the HO
   * head, so it cannot answer this.
   */
  /** `PII-` id → the farmer as a partner holds them, for HO's cart lists. */
  async farmersByPii(
    piiIds: readonly string[],
  ): Promise<Map<string, FarmerCard>> {
    if (piiIds.length === 0) return new Map();
    const rows = await this.rows.findByPiis([...new Set(piiIds)]);
    return new Map(
      rows.map((r) => [
        r.pii_id,
        {
          pii_id: r.pii_id,
          name: r.name,
          phone: r.phone,
          village: r.village,
          district: r.district ?? null,
        },
      ]),
    );
  }

  /**
   * Whom a partner can invite to a meeting: their own customers and open
   * leads (lost ones left out), the meeting's village first.
   */
  async invitees(
    agentId: string,
    q: string | undefined,
    village: string | undefined,
  ): Promise<InviteeCard[]> {
    const rows = await this.rows.all(
      { ...searchOf(q), agent_id: agentId },
      INVITEE_CAP,
    );
    return inviteOrder(
      rows.filter((r) => r.stage !== 'lost'),
      village,
    ).map((r) => ({
      pii_id: r.pii_id,
      name: r.name,
      phone: r.phone,
      village: r.village,
      stage: r.stage,
    }));
  }

  /** Mobile → the partner's own lead or customer, for a meeting's attendee list. */
  async mineByPhones(
    agentId: string,
    phones: readonly string[],
  ): Promise<Map<string, { pii_id: string; stage: LeadStage }>> {
    if (phones.length === 0) return new Map();
    const rows = await this.rows.findMineByPhones(agentId, [
      ...new Set(phones),
    ]);
    return new Map(
      rows.map((r) => [r.phone, { pii_id: r.pii_id, stage: r.stage }]),
    );
  }

  async holds(agentId: string, piiId: string): Promise<boolean> {
    return this.rows.isHeldBy(piiId.toUpperCase(), agentId.toUpperCase());
  }

  async getMine(partner: PartnerRef, piiId: string): Promise<LeadDetail> {
    return detailOf(await this.mine(partner, piiId), await this.window());
  }

  /**
   * Stage, follow-up, lost reason, expected value, and the farmer's details
   * (name, village, district, pincode, crops, acreage) — only what is sent.
   */
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

    const edit = await this.editOf(row, dto);
    if (edit) Object.assign(set, farmerCopyOf(edit.farmer, edit.place));

    const window = await this.window();
    if (Object.keys(set).length === 0) return detailOf(row, window);
    // Any change is work on the lead: it renews the partner's hold.
    set.last_worked_at = now;
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
    // Lost is not an open lead: moving in or out of it changes the count.
    if (moving && (stage === 'lost' || row.stage === 'lost')) {
      this.earning.recomputeLater([by], 'holdings_changed');
    }
    // A farmer Vistaar created: the org's lead, contact and address follow.
    if (edit && saved.origin === 'created') {
      await this.writeOrgRecords(
        edit.farmer,
        saved.pii_id,
        by,
        edit.place,
        now,
        null,
      );
    }
    if (dto.location || (dto.pincode && dto.pincode !== row.pincode)) {
      const spot = await this.spotFrom(dto.location, saved.pincode, 'add', now);
      if (await this.applySpot(saved.pii_id, by, spot))
        Object.assign(saved, spot);
    }
    return detailOf(saved, window);
  }

  /**
   * The partner drops a lead (added by mistake, wrong farmer): their row goes
   * and the farmer is free for anyone. The org's records stay — Katyayani
   * keeps the farmer. A customer cannot be removed: orders hang on them.
   */
  async remove(partner: PartnerRef, piiId: string): Promise<{ removed: true }> {
    const row = await this.mine(partner, piiId);
    if (row.stage === 'won') {
      throw conflict(
        'STAGE_NOT_ALLOWED',
        'A customer cannot be removed — they have an order.',
      );
    }
    if (!(await this.rows.remove(row.pii_id, row.agent_id))) {
      throw conflict(
        'STAGE_CHANGED',
        'This lead changed meanwhile — reload it.',
      );
    }
    // Its lead-added rewards still waiting for HO go with it.
    await this.rewards.leadRemoved(row.agent_id, row.pii_id);
    this.earning.recomputeLater([row.agent_id], 'holdings_changed');
    return { removed: true };
  }

  /** The farmer as edited, and where they are; `null` when no detail was sent. */
  private async editOf(
    row: VistaarLeadRecord,
    dto: UpdateLeadDto,
  ): Promise<{
    farmer: FarmerInput;
    place: { state: string; district: string | null };
  } | null> {
    const { name, village, district, pincode, crops, acreage } = dto;
    if (
      [name, village, district, pincode, crops, acreage].every(
        (v) => v === undefined,
      )
    ) {
      return null;
    }
    const farmer: FarmerInput = {
      phone: row.phone,
      name: name ?? row.name,
      village: village ?? row.village,
      district: district ?? row.district ?? undefined,
      pincode: pincode ?? row.pincode ?? undefined,
      crops: crops ?? row.crops,
      acreage: acreage ?? row.acreage,
    };
    // A new pincode moves the state (and the district, unless one is sent).
    const found =
      pincode && pincode !== row.pincode
        ? await this.pincodes.lookup(pincode)
        : null;
    return {
      farmer,
      place: {
        state: (found?.state ?? row.state ?? '').trim().toUpperCase(),
        district: district || found?.district || row.district,
      },
    };
  }

  /** Call / visit / WhatsApp / note on the lead's log. */
  async addActivity(
    partner: PartnerRef,
    piiId: string,
    dto: AddActivityDto,
  ): Promise<LeadDetail> {
    const now = new Date();
    const saved = await this.rows.update(
      piiId.toUpperCase(),
      partner.agent_id,
      {
        $set: { last_worked_at: now },
        $push: {
          activities: {
            $each: [this.activity(dto.type, dto.text, partner.agent_id, now)],
            $slice: -MAX_ACTIVITIES,
          },
        },
      },
    );
    if (!saved) throw notFound('Farmer not found.');
    // Logging an activity never moves `next_follow_up`, so the row still
    // holds the follow-up as it was due when the partner did this.
    await this.rewards.followUpDone(
      partner.agent_id,
      { pii_id: saved.pii_id, name: saved.name },
      saved.next_follow_up,
      dto.type,
      now,
    );
    // At a farm visit the partner stands at the farm: the best fix there is.
    if (dto.type === 'visit' && dto.location) {
      const spot = await this.spotFrom(
        dto.location,
        saved.pincode,
        'visit',
        now,
      );
      if (await this.applySpot(saved.pii_id, partner.agent_id, spot)) {
        Object.assign(saved, spot);
      }
    }
    return detailOf(saved, await this.window());
  }

  /**
   * A phone fix taken while ordering for the farmer (the cart's "Ordering
   * for"). The weakest source: it never moves a dot set at a visit or an add.
   */
  async recordLocation(
    agentId: string,
    piiId: string,
    fix: LocationDto,
  ): Promise<boolean> {
    const row = await this.rows.findByPii(piiId.toUpperCase());
    if (!row || row.agent_id !== agentId) return false;
    const spot = await this.spotFrom(fix, row.pincode, 'order', new Date());
    return this.applySpot(row.pii_id, agentId, spot);
  }

  /**
   * One-off: farmers with no place, or only a pincode's, get their pincode's
   * centre as the book has it now (a GPS place is never touched). Safe to run
   * again. Answers how many changed (or would).
   */
  async placeByPincode(apply: boolean): Promise<number> {
    let changed = 0;
    for (const row of await this.rows.placedByPincodeOrNot(50_000)) {
      const spot = await this.spotFrom(
        undefined,
        row.pincode,
        'pincode',
        new Date(),
      );
      if (!spot.location) continue;
      const [lng, lat] = spot.location.coordinates;
      const same =
        row.location?.coordinates[0] === lng &&
        row.location?.coordinates[1] === lat;
      if (same) continue;
      changed += 1;
      if (apply) await this.applySpot(row.pii_id, row.agent_id, spot);
    }
    return changed;
  }

  async list(query: AdminLeadQueryDto): Promise<PageResult<PartnerLeadView>> {
    const to = query.to ? new Date(query.to) : undefined;
    if (to && query.to?.length === 10) to.setUTCHours(23, 59, 59, 999);
    const filter: LeadListFilter = {
      ...searchOf(query.q),
      agent_id: query.agent_id?.toUpperCase(),
      stage: query.stage,
      origin: query.origin,
      state: query.state?.trim().toUpperCase() || undefined,
      district: query.district || undefined,
      due_before: query.due ? endOfToday() : undefined,
      from: query.from ? new Date(query.from) : undefined,
      to,
    };
    const [{ items, total }, window] = await Promise.all([
      this.rows.listRecent(
        // Sorted by follow-up = the leads that have one, soonest first.
        query.sort.replace(/^-/, '') === 'next_follow_up'
          ? { ...filter, has_follow_up: true }
          : filter,
        query,
        adminSort(query.sort),
      ),
      this.window(),
    ]);
    const partners = await this.agents.partnersByAgentIds([
      ...new Set(items.map((r) => r.agent_id)),
    ]);
    return new PageResult(
      items.map((r) => ({
        ...viewOf(r, window),
        partner: partners.get(r.agent_id) ?? null,
      })),
      total,
      query,
    );
  }

  /** HO's map: every farmer with a place (at most 5,000; narrow by partner, stage or place). */
  async places(query: LeadPlacesQueryDto): Promise<{
    items: {
      pii_id: string;
      agent_id: string;
      name: string;
      stage: LeadStage;
      village: string;
      district: string | null;
      state: string | null;
      crops: string[];
      lat: number;
      lng: number;
      exact: boolean;
      /** When the place was set (the GPS fix, or the pincode placing). */
      at: Date | null;
    }[];
    capped: boolean;
  }> {
    const rows = await this.rows.places(
      {
        agent_id: query.agent_id?.toUpperCase(),
        stage: query.stage,
        state: query.state?.trim().toUpperCase() || undefined,
        district: query.district || undefined,
      },
      MAP_CAP + 1,
    );
    return {
      items: rows.slice(0, MAP_CAP).flatMap((r) => {
        const place = farmerPlace(r);
        return place
          ? [
              {
                pii_id: r.pii_id,
                agent_id: r.agent_id,
                name: r.name,
                stage: r.stage,
                village: r.village,
                district: r.district ?? null,
                state: r.state ?? null,
                crops: r.crops ?? [],
                lat: place.lat,
                lng: place.lng,
                exact: place.exact,
                at: place.at,
              },
            ]
          : [];
      }),
      capped: rows.length > MAP_CAP,
    };
  }

  /** Farmers and customers per partner (`VST-` id) — HO's board. */
  async countsByPartner(): Promise<
    Map<string, { farmers: number; customers: number }>
  > {
    const rows = await this.rows.countsByPartner();
    return new Map(
      rows.map((r) => [
        r.agent_id,
        { farmers: r.farmers, customers: r.customers },
      ]),
    );
  }

  /** `VST-` id → the partner's id and name, for another list in this module. */
  partnerNames(agentIds: readonly string[]) {
    return this.agents.partnersByAgentIds(agentIds);
  }

  /** HO cards; "today" is the IST day. */
  async summary() {
    const today = istDayStart(new Date());
    const counts = await this.rows.adminSummary({
      today,
      week: new Date(today.getTime() - 6 * DAY_MS),
      tomorrow: new Date(today.getTime() + DAY_MS),
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

  async get(piiId: string): Promise<AdminLeadDetail> {
    const row = await this.rows.findByPii(piiId.toUpperCase());
    if (!row) throw notFound('Farmer not found.');
    return this.adminDetailOf(row);
  }

  /**
   * HO moves a farmer to another partner (PRD AD8) — e.g. the partner left,
   * or the farmer asked. The new partner starts over, as on a release; the
   * farmer's consent was given to Katyayani and stays.
   */
  async transfer(
    piiId: string,
    dto: TransferLeadDto,
    by: string,
  ): Promise<AdminLeadDetail> {
    const row = await this.rows.findByPii(piiId.toUpperCase());
    if (!row) throw notFound('Farmer not found.');
    const target = dto.agent_id.toUpperCase();
    if (target === row.agent_id) {
      throw badRequest(
        'VALIDATION_FAILED',
        'This farmer is already with that partner.',
      );
    }
    const agent = await this.agents.requireByAgentId(target);
    if (agent.stage !== 'approved' || !agent.is_active) {
      throw badRequest(
        'PARTNER_NOT_APPROVED',
        'Pick an approved partner — this one is not approved, or is blocked.',
      );
    }
    const now = new Date();
    const fresh = this.freshHold(row.stage, target, by, now);
    const saved = await this.rows.takeOver(row.pii_id, row, {
      $set: {
        ...fresh,
        origin: 'linked',
        found_via: null,
        expected_value: null,
        activities: [
          this.activity(
            'note',
            `Moved to you by Katyayani: ${dto.reason}`,
            by,
            now,
          ),
        ],
        ex_employee_declared_at: null,
      },
      $push: {
        holder_history: {
          $each: [this.holdEnd(row, 'transferred', by, now, dto.reason)],
          $slice: -MAX_HOLDER_HISTORY,
        },
      },
    });
    if (!saved) {
      throw conflict(
        'STAGE_CHANGED',
        'This lead changed meanwhile — reload it and try again.',
      );
    }
    this.earning.recomputeLater([row.agent_id, target], 'holdings_changed');
    return this.adminDetailOf(saved);
  }

  private async adminDetailOf(
    row: VistaarLeadRecord,
  ): Promise<AdminLeadDetail> {
    const [partners, window] = await Promise.all([
      this.agents.partnersByAgentIds([row.agent_id]),
      this.window(),
    ]);
    return {
      ...detailOf(row, window),
      partner: partners.get(row.agent_id) ?? null,
      holder_history: row.holder_history ?? [],
    };
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
    const lapse = await this.lapseOf(link, agentId, new Date());
    return holderOf({ link, released: lapse !== null, lead, contact, agentId });
  }

  /**
   * Why another partner's hold on this farmer has ended, or `null` while it
   * stands: no work (or order) in the release window, or that partner is
   * blocked. Nothing is changed here; the next partner to add them takes over.
   */
  private async lapseOf(
    link: VistaarLeadRecord | null,
    agentId: string,
    now: Date,
  ): Promise<HoldEnd | null> {
    if (!link || link.agent_id === agentId) return null;
    if (releaseAtOf(link, await this.window()) <= now) return 'released';
    return (await this.agents.isOutOfWork(link.agent_id))
      ? 'partner_blocked'
      : null;
  }

  private async window(): Promise<ReleaseWindow> {
    const s = await this.settings.get();
    return {
      lead_days: s.lead_release_days,
      customer_days: s.customer_release_days,
    };
  }

  /**
   * Where a save puts the farmer: the phone's fix when it fits (precise, in
   * India), else the pincode's centre, else nowhere. Pure lookups — the
   * pincode book is in memory.
   */
  private async spotFrom(
    fix: LocationDto | undefined,
    pincode: string | null | undefined,
    source: LocationSource,
    now: Date,
  ): Promise<Spot> {
    if (fix && fixFits(fix)) {
      const at = fix.at ? new Date(fix.at) : now;
      return {
        location: toPoint(fix.lat, fix.lng),
        location_source: source,
        location_at: at.getTime() > now.getTime() ? now : at,
      };
    }
    const centre = await this.pincodes.centre(pincode);
    if (centre) {
      return {
        location: toPoint(centre.lat, centre.lng),
        location_source: 'pincode',
        location_at: now,
      };
    }
    return { location: null, location_source: null, location_at: null };
  }

  /**
   * Stores the spot unless a stronger source placed the farmer already. A
   * real fix also lands on the org address row Vistaar filed (`geo`), so the
   * org's maps see the farm too. `false` = nothing changed.
   */
  private async applySpot(
    piiId: string,
    agentId: string,
    spot: Spot,
  ): Promise<boolean> {
    if (!spot.location || !spot.location_source || !spot.location_at) {
      return false;
    }
    const changed = await this.rows.setLocation(
      piiId,
      agentId,
      {
        location: spot.location,
        location_source: spot.location_source,
        location_at: spot.location_at,
      },
      replaceableBy(spot.location_source),
    );
    if (changed && spot.location_source !== 'pincode') {
      const [lng, lat] = spot.location.coordinates;
      await this.piis.setAddressGeo(piiId, LEAD_SOURCE, { lat, lng });
    }
    return changed;
  }

  /** The new partner starts over; a customer stays a customer. */
  private freshHold(
    previous: LeadStage,
    agentId: string,
    by: string,
    now: Date,
  ) {
    const stage: LeadStage = previous === 'won' ? 'won' : 'prospect';
    return {
      agent_id: agentId,
      stage,
      stage_history: [{ from: null, to: stage, at: now, by }],
      next_follow_up: null,
      lost_reason: null,
      held_since: now,
      last_worked_at: now,
    };
  }

  private holdEnd(
    row: VistaarLeadRecord,
    reason: HoldEnd,
    by: string,
    now: Date,
    note?: string,
  ): HolderMove {
    return {
      agent_id: row.agent_id,
      from: row.held_since ?? row.created_at,
      to: now,
      reason,
      by,
      ...(note && { note }),
    };
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

  private unavailable() {
    return serviceUnavailable(
      'LEADS_UNAVAILABLE',
      'Could not save the farmer right now. Please try again.',
    );
  }
}

/** HO's map shows at most this many dots per call. */
const MAP_CAP = 5_000;

const endOfToday = (): Date =>
  new Date(istDayStart(new Date()).getTime() + DAY_MS - 1);

/** `sort` as `GET /admin/leads` takes it; anything else is a 400. */
function adminSort(sort: string): Record<string, 1 | -1> {
  const key = sort.replace(/^-/, '');
  if (!(ADMIN_LEAD_SORTS as readonly string[]).includes(key)) {
    throw badRequest(
      'VALIDATION_FAILED',
      'This list can be sorted by created_at, last_order_at or next_follow_up.',
    );
  }
  return { [key]: sort.startsWith('-') ? -1 : 1 };
}
