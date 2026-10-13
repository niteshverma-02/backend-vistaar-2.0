/**
 * Farmer leads partners add (PRD C2, C4, C9; Lovable add-lead / leads / lead
 * detail screens).
 *
 * Two records per farmer:
 * - the org's — `piis`, `leads_v2`, `contacts_v2`, `addresses` — written
 *   directly, as prasar-backend does, in the shape ko-sales' `/leads/upsert`
 *   gives a profiled farmer, and only for a person Katyayani does not have yet;
 * - the partner's — one `vistaar_v2_leads` row: who holds the farmer (one
 *   farmer, one partner), the stage, follow-ups, activity and consent. It
 *   keeps a copy of the farmer basics the partner typed, for the lists.
 */

/** `leads_v2.source` of a farmer a partner added. */
export const LEAD_SOURCE = 'vistaar';

/** `agent_category` on the lead and contact, as prasar writes `prasar`. */
export const LEAD_AGENT_CATEGORY = 'vistaar';

/** Partners add farmers only (TL, 2026-10-12). */
export const FARMER_PROFILE = 'farmer';

/** `contacts_v2.profile` values that are a farmer. */
const FARMER_PROFILES: ReadonlySet<string> = new Set([
  'farmer',
  'key_account_farmer',
]);

/** ko-sales sizes farmers in acres. */
export const AREA_UNIT = 'Acre';

export const MAX_CROPS = 10;
export const MAX_ACTIVITIES = 100;
export const MAX_STAGE_HISTORY = 50;

/** The cohort whose partners declare they did not handle the farmer at Katyayani (PRD C6). */
export const EX_EMPLOYEE_COHORT = 'ex_employee';

export const LEAD_STAGES = [
  'prospect',
  'contacted',
  'interested',
  'negotiation',
  'won',
  'lost',
] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

/** What a partner may move a lead to; `won` comes only from the first order (PRD C2). */
export const PARTNER_STAGES = LEAD_STAGES.filter(
  (s): s is Exclude<LeadStage, 'won'> => s !== 'won',
);

export const CLOSED_STAGES: readonly LeadStage[] = ['won', 'lost'];

/** The app's stage names (`leadStageMeta`), for the activity log. */
export const STAGE_LABELS: Record<LeadStage, string> = {
  prospect: 'Prospect',
  contacted: 'Contacted',
  interested: 'Interested',
  negotiation: 'Negotiation',
  won: 'Won',
  lost: 'Lost',
};

/** How the partner found the farmer (the app's `LeadSource`). */
export const FOUND_VIA = [
  'meeting',
  'referral',
  'walk_in',
  'self',
  'campaign',
] as const;
export type FoundVia = (typeof FOUND_VIA)[number];

export const ACTIVITY_TYPES = ['call', 'visit', 'whatsapp', 'note'] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number] | 'stage_change';

export interface FarmerInput {
  /** Ten digits, already normalised. */
  phone: string;
  name: string;
  village: string;
  district?: string;
  pincode?: string;
  crops: string[];
  /** Total acres. */
  acreage: number;
}

/**
 * Who has this person already, for a partner adding them:
 * - `none` — nobody: Vistaar creates the farmer;
 * - `mine` — this partner: an update;
 * - `other_partner` — another partner holds them;
 * - `katyayani` — a farmer from another channel (app, KKD, telecalling) not
 *   held by a partner: linked to this partner, the org's records untouched (C9);
 * - `not_farmer` — registered as a retailer, dealer, … (farmers only).
 */
export type Holder =
  'none' | 'mine' | 'other_partner' | 'katyayani' | 'not_farmer';

export function holderOf(found: {
  link: { agent_id: string } | null;
  lead: { source?: string | null; created_by?: string | null } | null;
  contact: { profile?: string | null } | null;
  agentId: string;
}): Holder {
  const { link, lead, contact, agentId } = found;
  if (link) return link.agent_id === agentId ? 'mine' : 'other_partner';
  // A Vistaar lead whose partner row is missing still belongs to its creator.
  if (lead?.source === LEAD_SOURCE) {
    return lead.created_by === agentId ? 'mine' : 'other_partner';
  }
  if (contact && !isFarmerProfile(contact.profile)) return 'not_farmer';
  return lead || contact ? 'katyayani' : 'none';
}

/** No profile yet, or a farmer one. */
export function isFarmerProfile(profile: string | null | undefined): boolean {
  const value = profile?.trim().toLowerCase();
  return !value || FARMER_PROFILES.has(value);
}

/** Why a partner may not move a lead from `from` to `to`, or `null`. */
export function stageMoveError(from: LeadStage, to: LeadStage): string | null {
  if (to === 'won')
    return 'A lead is won by its first order — place an order for this farmer.';
  if (from === 'won') return 'This farmer is already a customer.';
  return null;
}

export const isOpenStage = (stage: LeadStage): boolean =>
  !CLOSED_STAGES.includes(stage);

/** ko-sales' bands (`farmer_sub_profile_from_acres`). */
export function farmerBand(acres: number): string {
  if (acres <= 5) return 'small_farmer';
  if (acres <= 30) return 'medium_farmer';
  return 'super_farmer';
}

const tidy = (text: string): string => text.trim().replace(/\s+/g, ' ');

export const titleCase = (text: string): string =>
  tidy(text)
    .toLowerCase()
    .replace(
      /(^|[\s(/-])(\p{L})/gu,
      (_m, lead: string, ch: string) => lead + ch.toUpperCase(),
    );

/** One entry per crop, Title Case as ko-sales stores crop names, first spelling first. */
export function cropsOf(crops: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const crop of crops) {
    const name = titleCase(crop);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
  }
  return out;
}

/** First word, then the rest — lower case, as ko-sales' lead schema stores names. */
export function splitName(name: string): {
  first_name: string;
  last_name: string;
} {
  const [first = '', ...rest] = tidy(name).toLowerCase().split(' ');
  return { first_name: first, last_name: rest.join(' ') };
}

export function farmDetailsOf(farmer: FarmerInput) {
  return {
    farm_area: farmer.acreage,
    farm_area_type: AREA_UNIT,
    sub_profile: farmerBand(farmer.acreage),
    crops: cropsOf(farmer.crops).map((crop_name) => ({ crop_name })),
  };
}

/** The org account that owns the farmer's lead: `agents_v2` id and `_id`. */
export interface LeadOwner {
  agent_id: string;
  ref: string;
}

const zeroCalls = () => ({
  answered: 0,
  missed_call: 0,
  not_connected: 0,
  switched_off: 0,
});

/**
 * A new `leads_v2` row: ko-sales' schema defaults, then what its upsert sets
 * for a profiled farmer with an explicit owner. No `profiled_at`: with it the
 * lead would match the "Profiled Farmer" cohort and be routed to telecallers —
 * an offline channel's farmer must not be (prasar's leads carry none either).
 * No pipeline and no score, as with prasar's direct insert.
 */
export function leadDocOf(
  farmer: FarmerInput,
  ctx: {
    leadId: string;
    piiId: string;
    agentId: string;
    owner: LeadOwner;
    state: string;
    now: Date;
  },
) {
  return {
    lead_id: ctx.leadId,
    pii_id: ctx.piiId,
    lead_owner: { agent_id: ctx.owner.agent_id, agent_ref: ctx.owner.ref },
    profiled_agent: null,
    ...splitName(farmer.name),
    state: ctx.state,
    pin_code: farmer.pincode ?? '',
    tags: [],
    source: LEAD_SOURCE,
    interakt_id: null,
    agent_category: LEAD_AGENT_CATEGORY,
    call_status: '',
    call_count: zeroCalls(),
    disposition: null,
    follow_up_date: null,
    assigned_date: ctx.now,
    assigned_by: ctx.owner.agent_id,
    status: 'contact_created',
    incoming_msg_count: 0,
    last_incoming_msg_at: null,
    rating: null,
    pipeline_id: null,
    updated_data: [],
    owner_history: [],
    last_updated_by: null,
    updated_by: null,
    created_by: ctx.agentId,
    phone_verified: false,
    is_profiled: true,
    last_call_at: null,
    bucket_id: null,
    with_doc: false,
    has_app: false,
    is_kyc: false,
    probability_doc: null,
    role: null,
    contact_profile: FARMER_PROFILE,
    lqs: {},
    created_at: ctx.now,
    updated_at: ctx.now,
    __v: 0,
  };
}

/** A new `contacts_v2` row: ko-sales' schema defaults and a farmer profile. */
export function contactDocOf(
  farmer: FarmerInput,
  ctx: { contactId: string; piiId: string; agentId: string; now: Date },
) {
  const farm = farmDetailsOf(farmer);
  return {
    contact_id: ctx.contactId,
    pii_id: ctx.piiId,
    eg_id: null,
    notes: [],
    profile: FARMER_PROFILE,
    profile_details: { name: titleCase(farmer.name) },
    profile_category: farm.sub_profile,
    status: 'active',
    farm_details: farm,
    query: [],
    prescription_count: 0,
    last_updated_by: ctx.agentId,
    call_status: null,
    call_count: zeroCalls(),
    disposition: null,
    follow_up_date: null,
    prospect_value: 0,
    licences: [],
    profile_image: false,
    agent_category: LEAD_AGENT_CATEGORY,
    source: LEAD_SOURCE,
    pipeline_id: null,
    fps: 0,
    rps: 0,
    updated_data: [],
    tags: [],
    created_at: ctx.now,
    updated_at: ctx.now,
    __v: 0,
  };
}

/** What a partner's re-submit changes on a lead Vistaar created … */
export function leadUpdateOf(
  farmer: FarmerInput,
  ctx: { agentId: string; state: string; now: Date },
) {
  return {
    ...splitName(farmer.name),
    state: ctx.state,
    pin_code: farmer.pincode ?? '',
    updated_by: ctx.agentId,
    last_updated_by: ctx.agentId,
    updated_at: ctx.now,
  };
}

/** … and on its contact. */
export function contactUpdateOf(
  farmer: FarmerInput,
  ctx: { agentId: string; now: Date },
) {
  const farm = farmDetailsOf(farmer);
  return {
    'profile_details.name': titleCase(farmer.name),
    profile_category: farm.sub_profile,
    farm_details: farm,
    last_updated_by: ctx.agentId,
    updated_at: ctx.now,
  };
}

/** The farmer basics copied onto the partner's row (lists and search read them). */
export function farmerCopyOf(
  farmer: FarmerInput,
  place: { state: string; district: string | null },
) {
  return {
    name: titleCase(farmer.name),
    phone: farmer.phone,
    village: titleCase(farmer.village),
    district: place.district,
    state: place.state || null,
    pincode: farmer.pincode ?? null,
    crops: cropsOf(farmer.crops),
    acreage: farmer.acreage,
  };
}
