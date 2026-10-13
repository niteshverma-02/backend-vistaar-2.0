# Farmer leads — HO portal

> **Updated 2026-10-13 (2) — release and transfer.** New: `POST /admin/leads/:piiId/transfer`
> (capability `leads.transfer`); on every lead `releases_at`, `held_since`,
> `last_worked_at`, `last_order_at`; on the detail `holder_history`; settings
> `lead_release_days` (15) and `customer_release_days` (45). See *Release and transfer*.
> Nothing removed.
>
> *Earlier on 2026-10-13:* what *one farmer, one partner* means for the screen (*Rules*).

**For the HO portal dev.** The Vistaar screens of the HO portal are being remade; this is
what the new **Leads** screen and its settings are built on. PRD: §6.6 admin counterpart,
C2 / C4 / C9, §10 (consent), AD8 (ownership), AD12 (joins by id). App side: LEADS-APP.md.

**Base URL:** `{VISTAAR_API}/api/v2` · bearer = the portal's **SSO** token · capability
`leads.read` (heads: USR-1037 Offline Head, USR-1000 / 1001). HO watches, and can move a
farmer to another partner (`leads.transfer`); partners add and work their farmers in the
app. There is no HO "add farmer" — only a
partner standing with the farmer can take the farmer's consent (PRD §10).

Every answer is the envelope `{ success, data }`; lists are
`{ items, page, limit, total, has_more }` (`limit` ≤ 200). Join everything by id —
`pii_id` for the farmer, `agent_id` (`VST-…`) for the partner — never by name or phone
(PRD AD12).

## Routes

| Method | Path | Answer |
|---|---|---|
| GET | `/admin/leads` | `Page<LeadRow>`, newest first — filters below |
| GET | `/admin/leads/summary` | `LeadSummary` |
| GET | `/admin/leads/:piiId` | `AdminLeadDetail` — the row + `stage_history` + `activities` + `holder_history` |
| POST | `/admin/leads/:piiId/transfer` | `{ agent_id: "VST-…", reason }` → `AdminLeadDetail` — move the farmer to another approved partner |
| GET / PUT | `/admin/settings` | `farmer_consent`, `lead_owner_agent_id`, `lead_release_days`, `customer_release_days` (see *Settings*) |
| GET | `/admin/agents?stage=approved` | partners, for the partner filter (ONBOARDING-HO.md) |

### `GET /admin/leads` filters

| Query | |
|---|---|
| `q` | name, village, crop, or digits of the mobile (10 digits = exact number) |
| `agent_id` | one partner, `VST-000001` |
| `stage` | `prospect` · `contacted` · `interested` · `negotiation` · `won` · `lost` |
| `origin` | `created` (new to Katyayani) · `linked` (an existing Katyayani farmer a partner took) |
| `state` | full state name, any case — `madhya pradesh` |
| `from` / `to` | added on or after / on or before. Send **IST** date-times: `2026-10-13T00:00:00+05:30`, `2026-10-13T23:59:59.999+05:30` (a bare `YYYY-MM-DD` is read as a UTC day) |
| `page`, `limit` | `limit` ≤ 200 |

## Types

```ts
type LeadStage = "prospect" | "contacted" | "interested" | "negotiation" | "won" | "lost";
type LeadOrigin = "created" | "linked";
type FoundVia = "meeting" | "referral" | "walk_in" | "self" | "campaign";
type LeadActivityType = "call" | "visit" | "whatsapp" | "note" | "stage_change";

interface LeadRow {
  pii_id: string;                 // the farmer, and the lead's id everywhere — PII-1620671
  lead_id: string | null;         // org lead L-…; for `linked`, the other channel's lead; null if the farmer had only a contact
  origin: LeadOrigin;
  agent_id: string;               // the partner, VST-…
  partner: { agent_id: string; name: string | null } | null;
  name: string;
  phone: string;                  // 10 digits
  village: string;
  district: string | null;
  state: string | null;           // UPPER CASE
  pincode: string | null;
  crops: string[];                // ≥ 1, main crop first
  acreage: number;                // acres, > 0
  found_via: FoundVia | null;
  expected_value: number | null;  // ₹ expected first order
  stage: LeadStage;
  next_follow_up: string | null;  // ISO
  lost_reason: string | null;
  consent_version: number;        // consent wording version the farmer agreed to
  customer_at: string | null;     // first order (Customers epic)
  last_order_at: string | null;   // last order (Customers epic)
  held_since: string | null;      // since when this partner holds the farmer (null = created_at)
  last_worked_at: string | null;  // the partner's last work on the lead
  releases_at: string;            // from then another partner may take the farmer
  created_at: string;
  updated_at: string;
}

interface LeadDetail extends LeadRow {
  stage_history: { from: LeadStage | null; to: LeadStage; at: string; by: string }[]; // oldest first
  activities: { id: string; type: LeadActivityType; text: string; at: string; by: string }[]; // newest first, last 100
}

interface AdminLeadDetail extends LeadDetail {
  holder_history: {                // partners who held the farmer before, oldest first (last 20)
    agent_id: string;              // the earlier partner
    from: string; to: string;
    reason: "released" | "partner_blocked" | "transferred";
    by: string;                    // VST-… who took over, or the HO user's email (transfer)
    note?: string;                 // HO's reason (transfer)
  }[];
}

interface LeadSummary {
  total: number;
  today: number;                  // added today, IST
  last_7_days: number;            // today + the 6 days before, IST
  partners: number;               // partners holding at least one farmer
  by_stage: { key: LeadStage; count: number }[];   // stages with 0 are absent
  by_partner: { key: string; name: string | null; count: number }[]; // top 10
}

interface Settings {               // GET /admin/settings — the lead fields
  lead_owner_agent_id: string | null;
  farmer_consent: { version: number; text: { en: string; hi?: string } };
  lead_release_days: number;       // default 15
  customer_release_days: number;   // default 45
}
```

`by` in history / activities = the partner's `VST-…`, `system` (the first order), or the HO
user's email (a transfer note).

## Screen: Leads

One page: cards on top, then the list; a row opens the lead in a drawer.

**Cards** (`/admin/leads/summary`) — each click filters the list:

| Card | Value | Click |
|---|---|---|
| Farmers | `total` | clears filters |
| Added today | `today` | `from` / `to` = today, IST |
| Last 7 days | `last_7_days` | `from` = 6 days ago 00:00 IST |
| Partners adding | `partners` | — |
| Pipeline by stage | `by_stage` (funnel / bar, Prospect → Negotiation, then Won, Lost) | `stage` |
| Top partners | `by_partner` | `agent_id` |

**Filters:** search (`q`, debounced) · partner (`agent_id`) · stage · origin · state · added
between (`from` / `to`). Keep them in the URL so a filtered list can be shared.

**Table** (`/admin/leads`, server-paged, row key `pii_id`):

| Column | Field |
|---|---|
| Farmer | `name`, sub-line `pii_id` |
| Phone | `phone` (call / WhatsApp) |
| Partner | `partner.name` ?? `agent_id`, sub-line `agent_id` |
| Stage | `stage` tag; Lost shows `lost_reason` |
| Follow-up | `next_follow_up` — red when past and the stage is open |
| Crops | `crops[0]`, `+n` |
| Land | `acreage` acres |
| Village | `village`, sub-line `district` |
| State | `state` |
| Added | `created_at` |
| Releases | `releases_at` — "in N days"; amber within 3 days, red when past (free for another partner) |
| Optional | `pincode`, `origin`, `found_via`, `expected_value`, `held_since` |

**Export:** page through `/admin/leads?…&limit=200` until `has_more` is false; CSV of the
table's columns.

**Drawer** (`/admin/leads/:piiId`):

- **Header:** name, village · district · state, stage tag. Actions: call, WhatsApp,
  "Partner's farmers" (sets `agent_id`), open the partner (`/admin/agents/:agentId`),
  **"Move to another partner"** (only with `leads.transfer`): pick an approved partner
  (`/admin/agents?stage=approved`) + a reason (required, ≤ 200) → `POST …/transfer`;
  confirm first ("The new partner starts over at Prospect").
- **Details:** Farmer ID (`pii_id`), Org lead (`lead_id`, `—` when none), Phone,
  Partner, Village, District, State, Pincode, Crops (tags), Land, How found
  (`found_via`), Expected first order, Next follow-up, Origin, Consent (version
  `consent_version`), Added on, Became customer (`customer_at`).
- **Stage & activity:** `stage_history` as a timeline (from → to, when, by), then
  `activities` newest first (type icon, text, when, by).
- **Partners before:** `holder_history`, newest on top — partner, from → to, why
  (Released · Partner blocked · Moved by HO + `note`). Hide when empty.
- **Hold:** "With this partner since `held_since` · last work `last_worked_at` · releases
  `releases_at`".

Empty states: no farmers yet ("Farmers partners add in the app appear here"); nothing
matches (offer reset).

## Settings

On the Vistaar settings screen; `PUT /admin/settings` (capability `settings.write`), send
only what changed:

| Field | UI |
|---|---|
| `farmer_consent_text: { en, hi? }` | "Farmer consent" — English (required) and Hindi text areas, ≤ 600 chars each; show `farmer_consent.version`. New words make a new version: partners must tick the new wording before their next add (the app gets `409 CONSENT_OUTDATED` and reloads it); leads keep the version they were given under. The app picks it up within a minute. Confirm before saving — it changes what every partner shows farmers |
| `lead_owner_agent_id` | "Farmer-lead owner (override)" — an active `A0-…` account; empty = the Offline Head (below). `400 OWNER_NOT_FOUND` if it is not an active account |
| `lead_release_days` | "Release a lead after N days without work" — whole number 1–365, default 15 |
| `customer_release_days` | "Release a customer after N days without an order" — whole number 1–365, default 45 |

## Labels

| Field | Values |
|---|---|
| `stage` | Prospect · Contacted · Interested · Negotiation · Won · Lost |
| `origin` | `created` New to Katyayani · `linked` Existing Katyayani farmer |
| `found_via` | Meeting · Referral · Walk-in · Self · Campaign |
| activity `type` | Call · Visit · WhatsApp · Note · Stage changed |

Open stages = Prospect … Negotiation. Won = became a customer with the first order (the
partner never sets it).

## Errors

| Code | HTTP | Show |
|---|---|---|
| `UNAUTHORIZED` | 401 | SSO token missing / expired — sign in again |
| `NO_ADMIN_ACCESS` | 403 | the account has no Vistaar role |
| `ROLE_NOT_ALLOWED` | 403 | the role is not a head (no `leads.read` / `leads.transfer` / `settings.write`) |
| `NOT_FOUND` | 404 | no partner holds this farmer |
| `VALIDATION_FAILED` | 400 | a bad filter or setting — `details[0]` |
| `OWNER_NOT_FOUND` | 400 | settings: the owner is not an active account |
| `PARTNER_NOT_APPROVED` | 400 | transfer: the partner picked is not approved, or is blocked |
| `VALIDATION_FAILED` | 400 | transfer: already with that partner, or no reason |
| `STAGE_CHANGED` | 409 | transfer: the lead changed meanwhile — reload and try again |

## Lead owner

A new farmer's org lead (`leads_v2.lead_owner`) is the **HO portal head**: the one active
`agents_v2` account with role **USR-1037 (Offline Head)** — written `{ agent_id,
agent_ref }`. Super Admin / Admin (USR-1000 / 1001) have full HO access but are never the
owner. No owner (no active Offline Head, or more than one, and no setting) = adding **new**
farmers answers `503 LEADS_NOT_CONFIGURED` in the app; linking an existing Katyayani farmer
still works. Owning a lead gives no access; partners never reach `/admin/*`.

## Rules

- **One farmer, one partner** (PRD C2, R1): a farmer (one mobile = one person) is with only
  one partner; a partner has any number of farmers. So every row in `/admin/leads` is one
  farmer with exactly one `partner` — the same farmer never shows twice. The first partner
  to add the farmer has them; another partner trying the same mobile is refused, and only
  the holding partner can order for the farmer. Not forever — see *Release and transfer*.
- Farmers only: a number registered as a retailer / business is refused.
- A Katyayani farmer from another channel can be taken by a partner (PRD C9): only the
  partner's row is written; the org's lead and contact are never changed.
- New farmers are also org records (`leads_v2` / `contacts_v2`, source `vistaar`,
  `created_by` = the partner's `VST-` id), so the CRM sees them too.
- Offline channel: Vistaar leads are kept away from telecaller routing — owner is the head,
  not the A0-1126 pool, and the lead carries no `profiled_at` (the "Profiled Farmer" cohort
  needs it). For a guarantee, sales-operation should add source `vistaar` to its cohort and
  router exclusions.
- No ko-sales pipeline, LQS or webhook — as prasar's direct insert.

## Release and transfer

A partner keeps a farmer only while working them (user's rule, 2026-10-13):

| Farmer | Free for another partner after | Setting |
|---|---|---|
| Lead (no order yet) | 15 days with no work | `lead_release_days` |
| Customer (has ordered) | 45 days with no order | `customer_release_days` |
| Any, partner blocked | at once | — |

- Work = the partner saving the lead again, a stage / follow-up / expected-value change, or
  a logged call, visit, WhatsApp or note. A far follow-up date does not keep the farmer.
- Nothing runs at `releases_at`: the farmer stays with the partner (and any work renews
  it) until another partner adds them. That partner then holds the farmer, starting at
  Prospect (a customer stays Won); the earlier partner goes into `holder_history`.
- **Transfer** (PRD AD8): HO moves a farmer by hand, any time — e.g. the partner left or the
  farmer asked. Same fresh start; the reason is kept in `holder_history.note` and as the
  first note the new partner sees. The farmer's consent moves with them.
- The org's lead (`leads_v2`: `created_by`, owner) never changes on a release or transfer.

## Not in v2 yet

| | When |
|---|---|
| Charts by day / crop / village / state | summary facets — backend, on request |
| Partners with no farmer yet | backend, on request |
| Lead → customer page link | Customers epic |
| A partner asking HO for a farmer ("request transfer") | later |
| Ex-employee lock list | HRMS (PRD AD8) |
