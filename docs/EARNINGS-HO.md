# Earnings — HO portal contract

Partners earn three ways (user + TL, 2026-10-16): **commission** on orders, **gig** ₹
for actions, and **coins** (points) for actions. All three depend on the partner's
**earning cohort**. This doc covers the cohorts, their commission and meeting-gig pay,
their coin / gig **rules** and the **rewards** desk (pending → approved / rejected). The
full commission-plan contract is `COMMISSION-HO.md` §1; the app side is `EARNINGS-APP.md`.

> An earning cohort is **not** the onboarding cohort (`/admin/cohorts` — the partner
> type and its form). The two are separate lists.

Capabilities (heads and admins today): `earning.read` to see, `earning.write` to add,
edit, reorder and archive. Partners move to their new cohort as soon as a change is
saved (worked out right after the answer; a few seconds for 10,000 partners).

## How a partner gets a cohort

- HO builds a cohort from an ordered list of **conditions** — the same
  `{ field, op, value }` shape the rules use. The fields are the partner facts:
  `state`, `district`, `pincode` (the partner's **profile** place — mapped at
  approval — not GPS), `open_leads` (open leads held **now**: not won, not lost)
  and `customers` (leads at `won`, held **now**). Not lifetime, not monthly.
  Build the form from `GET /admin/earning-cohorts/catalog` (below), not from
  this list.
- **All** conditions must hold; a condition whose value is a **list** holds when
  **any** of its entries matches. A non-default cohort needs at least one
  condition, and takes at most **12**.
- The old **`filters`** object (`states[]`, `districts[]`, `pincodes[]`,
  `min_leads`, `min_customers`) is still accepted on create and PATCH **when
  `conditions` is absent**: the server converts it to conditions (states →
  `{state, any_of}`, districts → `{district, any_of}`, pincodes →
  `{pincode, any_of}`, `min_leads` → `{open_leads, gte}`, `min_customers` →
  `{customers, gte}`) and stores those. Responses always return **both**: the
  stored `conditions`, and a `filters` view derived back from the conditions
  that fit the old shape (one that does not — an `lte`, say — just does not
  appear in `filters`). Cohorts stored before conditions existed are converted
  on read and inside the matcher, so nothing breaks before a migration.
- A partner is in exactly **one** cohort: the first one, in HO's priority order,
  whose conditions all hold. The built-in **`ec_default`** ("Everyone else") has
  no conditions, is always looked at last and catches everyone else. It cannot
  be archived and its conditions cannot be set; its name, description,
  meeting-gig payout and rules can.
- Only approved partners are placed. A partner is looked at again when: HO approves or
  unblocks them; they add a farmer (or take one over); a lead moves into or out of
  `lost`; a lead is won (first order); they remove a lead; HO transfers a farmer (both
  partners); HO adds, edits conditions of, reorders or archives a cohort (everyone).
- A lapsed hold still counts (the farmer stays the partner's until another partner
  takes them over), so a partner does not drop out of a cohort just by time passing.
- Every stretch a partner spends in a cohort is kept (`history`), because commission
  follows the cohort the partner was in **when the order was placed**.

## Cohort routes

| Method | Path | Capability | Body | Returns |
|---|---|---|---|---|
| `GET` | `/api/v2/admin/earning-cohorts?include_archived=&page=&limit=` | `earning.read` | — | `PageResult<EarningCohort>` — priority order, `ec_default` last, then archived (newest first) |
| `GET` | `/api/v2/admin/earning-cohorts/catalog` | `earning.read` | — | `CohortCatalog` — the fields and operators a condition can use |
| `GET` | `/api/v2/admin/earning-cohorts/:id` | `earning.read` | — | `EarningCohort` |
| `POST` | `/api/v2/admin/earning-cohorts` | `earning.write` | `CreateCohort` | `201` `EarningCohort` |
| `PATCH` | `/api/v2/admin/earning-cohorts/:id` | `earning.write` | `UpdateCohort` | `EarningCohort` |
| `POST` | `/api/v2/admin/earning-cohorts/:id/archive` | `earning.write` | — | `EarningCohort` — the delete (see below) |
| `PUT` | `/api/v2/admin/earning-cohorts/order` | `earning.write` | `{ "ids": ["ec_…", …] }` | `{ "ids": [...] }` |
| `POST` | `/api/v2/admin/earning-cohorts/recompute` | `earning.write` | — | `{ "partners": 812, "changed": 37 }` — every approved partner now (awaited) |
| `GET` | `/api/v2/admin/agents/:agentId/earning-cohort` | `earning.read` | — | `PartnerEarning` |

### `EarningCohort`

```jsonc
{
  "id": "ec_paddy_belt",            // never changes
  "name": "Paddy belt, 10+ leads",
  "description": null,
  "conditions": [                   // authoritative: all must hold; a list value on any entry
    { "field": "state", "op": "any_of", "value": ["MADHYA PRADESH"] },
    { "field": "open_leads", "op": "gte", "value": 10 }
  ],
  "summary": "State has any of MADHYA PRADESH · Open leads at least 10",
  "filters": {                      // the legacy view, derived from conditions (best effort)
    "states": ["MADHYA PRADESH"],
    "districts": [],
    "pincodes": [],
    "min_leads": 10,                // null = not used
    "min_customers": null
  },
  "priority": 1,                    // 1 = looked at first; ec_default's (0) is ignored — always last
  "status": "active",               // active · archived
  "meeting_gig_payout": 300,        // ₹; null = settings gig_payout
  "version": 3,
  "is_default": false,
  "partners_count": 42,             // approved partners in it now
  "created_by": "…", "updated_by": "…", "archived_by": null, "archived_at": null,
  "created_at": "…", "updated_at": "…"
}
```

`ec_default`'s `conditions` is `[]` and its `summary` is "Every partner". A
`summary` shortens a long list ("462001, … +1,994 more").

### `GET /admin/earning-cohorts/catalog`

The fields a condition can use and the operators each takes — build the form
from it, exactly like the rules catalog (same field shape):

```jsonc
{
  "fields": [
    { "key": "state",      "label": "State",      "type": "string", "upper": true,
      "operators": ["eq", "any_of"], "max_values": 40,  "hint": "Profile state (kept upper case)" },
    { "key": "district",   "label": "District",   "type": "string",
      "operators": ["eq", "any_of"], "max_values": 800, "hint": "Profile district, any case" },
    { "key": "pincode",    "label": "Pincode",    "type": "string",
      "operators": ["eq", "any_of"], "max_values": 2000,
      "pattern": "^[1-9]\\d{5}$", "pattern_hint": "each pincode is 6 digits", "hint": "Profile pincode" },
    { "key": "open_leads", "label": "Open leads", "type": "number",
      "operators": ["gte", "lte"], "hint": "Leads held now, not won, not lost" },
    { "key": "customers",  "label": "Customers",  "type": "number",
      "operators": ["gte", "lte"], "hint": "Won leads held now" }
  ],
  "operators": [ { "key": "eq", "label": "is" }, { "key": "in", "label": "is one of" },
                 { "key": "any_of", "label": "has any of" }, { "key": "gte", "label": "at least" },
                 { "key": "lte", "label": "at most" } ]
}
```

`eq` takes one word; `any_of` a list of 1–`max_values` words (compared without
case; `state` values kept upper case); `gte` / `lte` a number from 0.

### `POST /admin/earning-cohorts`

```jsonc
{
  "name": "Paddy belt, 10+ leads",     // required, ≤ 60
  "key": "paddy_belt",                 // optional — the id (`ec_` added); left out = made from the name
  "description": "…",                  // optional, ≤ 300
  "conditions": [                      // 1–12, all must hold
    { "field": "state", "op": "any_of", "value": ["madhya pradesh"] },
    { "field": "open_leads", "op": "gte", "value": 10 }
  ],
  "meeting_gig_payout": 300            // optional ₹ 0–1,00,000; null = settings gig_payout
}
```

- The id is `ec_` + the key, or a slug of the name (`ec_paddy_belt_10_leads`, then
  `_2`, `_3` … when taken). A key in use, or `default`, is `409 COHORT_EXISTS`.
- A new cohort goes **just above the default** (lowest priority of the active ones);
  move it with `PUT /order`.
- Each condition is checked against the catalog: an unknown field, an operator the
  field does not take, a value of the wrong type or an empty list is
  `400 VALIDATION_FAILED`; `details` lists every problem, one line each.
- No condition at all is `400 VALIDATION_FAILED` — that cohort would take everyone.
- Legacy: the old `filters` object is accepted **instead of** `conditions` (never
  both — `400 VALIDATION_FAILED`) and converted as above.

### `PATCH /admin/earning-cohorts/:id`

`{ "version": 3, … }` plus any of `name`, `description` (`null` clears),
`conditions`, `meeting_gig_payout` (`null` = settings). `conditions` is the
**whole list** — it replaces what is stored, like a rule's conditions.

- `version` is the one HO read; another screen saved meanwhile → `409 VERSION_CONFLICT`
  (reload and edit again).
- `conditions` (or `filters`) on `ec_default` → `400 EARNING_COHORT_LOCKED`.
- An archived cohort → `409 EARNING_ARCHIVED`.
- Only a change to `conditions` moves partners; name, description and payout do not.
- Legacy: `filters` is accepted when `conditions` is absent. Its keys **merge** over
  the stored legacy view (send only the filters that change; `[]` / `null` stops
  using one), and the merged result converts to conditions. A condition the legacy
  shape cannot say (an `lte`) is dropped by such an edit — a legacy screen cannot
  see it either, so move the screen to `conditions`.

### Archive (the delete)

`POST /:id/archive` — nothing is deleted: past assignments and the commission of
orders placed while partners were in it point at it. Its partners move to the next
cohort that takes them (often the default). Its rules stay but never pay again.
`ec_default` → `400 EARNING_COHORT_LOCKED`; already archived → `409 EARNING_ARCHIVED`.
An archived cohort cannot be restored (create a new one).

### Order

`PUT /order { "ids": [...] }` takes **every active cohort except `ec_default`**, once,
first looked at first (priority 1, 2, …). A list that misses one or names another →
`409 EARNING_ORDER_CHANGED` (someone added or archived meanwhile — reload).

### `GET /admin/agents/:agentId/earning-cohort`

```jsonc
{
  "agent_id": "VST-000006",
  "current": { "cohort_id": "ec_paddy_belt", "name": "Paddy belt, 10+ leads", "since": "…" }, // null = not approved yet
  "facts": { "state": "MADHYA PRADESH", "district": "Bhopal", "pincode": "462026",
             "open_leads": 12, "customers": 3 },   // what the cohort is matched on, now
  "history": [                                      // newest first, ≤ 100
    { "cohort_id": "ec_paddy_belt", "name": "…", "from": "…", "to": null,  "reason": "holdings_changed" },
    { "cohort_id": "ec_default",    "name": "…", "from": "…", "to": "…",   "reason": "partner_approved" }
  ]
}
```

`reason`: `partner_approved` · `partner_unblocked` · `profile_changed` ·
`holdings_changed` · `cohorts_changed` · `first_assignment` (an approved partner first
seen after this feature shipped) · `recompute` (HO's button). A partner approved before
this feature is placed on their first app open, on this route, or on the recompute
button — run it once after deploy.

`profile_changed` is written only by the `backfill-partner-place` script. A partner's own
place edit (`PATCH /me`, ONBOARDING-APP.md §6) does not re-place them today: they move on
the next holdings change, cohort change or recompute — press recompute after a batch of
place edits if a place-based cohort must follow at once.

## Commission per cohort

A cohort's commission is a **plan** on the commission-plans routes, the same ones as the
partner-type plans — body, fields, `PATCH` and errors in `COMMISSION-HO.md` §1, rules in
`COMMISSION-LOGIC.md` (*Earning cohorts*). Capability `commission.read` /
`commission.plans` (not `earning.*`).

- `POST /api/v2/admin/commission-plans` with `"cohort": "ec_…"`; the plan's id is
  `ec_…@YYYY-MM` — from that month on, until the cohort's next plan; past months are
  locked.
- `kind: "fixed"` (one `rate` on every order, whatever the month's sales) or `"slabs"`
  (a slab table; the slab is reached by the partner's whole delivered sales of the month).
- `min_order_value` (optional, ₹ of base — after discount and coins, before GST): an
  order below it earns `ec_default`'s plan of that month. Not allowed on `ec_default`.
- A cohort with no plan of its own inherits `ec_default`'s. While `ec_default` has none
  either, every partner stays on their partner-type plan — **nothing changes until HO
  saves an `ec_default` plan**, and saving one moves every approved partner's new orders
  onto it (agree it with Finance first).
- `GET /api/v2/admin/commission-plans/in-effect?month=&scope=earning` — the cohort table
  for a month, active cohorts in priority order, `ec_default` last, each row with
  `inherits`: `null` (its own plan) · `"ec_default"` · `"partner_type"` (no plan here or
  on the default — `slabs: []`).
- The plan an order earns on is fixed by the cohort the partner was in **when the order
  was placed** and that cohort's plan for the **month placed**; the slab level comes from
  the partner's total delivered sales of the **delivery** month. Orders placed before a
  partner's first earning cohort keep their partner-type plan.
- A plan for an unknown `ec_…` → `400 COHORT_NOT_FOUND`; for an archived cohort →
  `409 EARNING_ARCHIVED`.

## Meeting-gig payout per cohort

`meeting_gig_payout` (₹; `null` = settings `gig_payout`) is what a partner of the cohort
earns for a meeting gig whose payout HO left empty (`payout_source: "cohort"` —
`GIGS-HO.md` *Pay*):

- It is fixed on the gig when the partner accepts it or HO assigns it: the taker's cohort
  then, else settings `gig_payout`. Changing `meeting_gig_payout` later never touches a
  gig already taken.
- A payout set on the gig itself wins, whoever takes it.
- Give-back or HO reopen clears it, so the next taker gets their own cohort's rate.

## Coin and gig rules — the light rule engine

HO writes any number of rules per cohort (the default too). A **trigger** is an event
the code knows; HO chooses its **conditions** and the **reward**.

- When the event happens, the partner's **current** cohort's active rules for that
  trigger are checked **in HO's order**. Per reward kind, the **first** rule whose
  conditions all hold pays. So one event can pay a coin rule **and** a gig rule, never
  two coin rules (or two gig rules).
- A rule with no conditions pays every time (put it last as a catch-all).
- What a reward is worth is fixed when the event happens (amount and cohort then); it
  waits for HO on the rewards desk (below).
- A new trigger needs code; conditions and rewards never do.

| Method | Path | Capability | Body | Returns |
|---|---|---|---|---|
| `GET` | `/api/v2/admin/earning-rules/catalog` | `earning.read` | — | `Catalog` |
| `GET` | `/api/v2/admin/earning-rules?cohort_id=&trigger=&include_archived=&page=&limit=` | `earning.read` | — | `PageResult<EarningRule>` — by cohort, then order |
| `GET` | `/api/v2/admin/earning-rules/:id` | `earning.read` | — | `EarningRule` |
| `POST` | `/api/v2/admin/earning-rules` | `earning.write` | `CreateRule` | `201` `EarningRule` |
| `PATCH` | `/api/v2/admin/earning-rules/:id` | `earning.write` | `{ version, name?, conditions?, reward? }` | `EarningRule` |
| `POST` | `/api/v2/admin/earning-rules/:id/archive` | `earning.write` | — | `EarningRule` — the delete |
| `PUT` | `/api/v2/admin/earning-rules/order` | `earning.write` | `{ "cohort_id": "ec_…", "ids": [...] }` | `{ cohort_id, ids }` |

### Catalog (v1)

`GET /catalog` returns exactly what the form needs — build the form from it, not from
this table:

```jsonc
{
  "triggers": [
    { "key": "lead_created", "label": "Farmer lead added", "description": "…",
      "fields": [
        { "key": "crops", "label": "Crops", "type": "string[]", "operators": ["any_of"], "hint": "Any case" },
        { "key": "acreage", "label": "Acreage", "type": "number", "operators": ["eq", "gte", "lte"], "hint": "Acres" },
        { "key": "farmer_district", "label": "Farmer district", "type": "string", "operators": ["eq", "in"] },
        { "key": "farmer_state", "label": "Farmer state", "type": "string", "operators": ["eq", "in"], "upper": true }
      ] },
    { "key": "follow_up_done", "label": "Follow-up done", "description": "…",
      "fields": [
        { "key": "activity_type", "label": "Activity", "type": "enum", "values": ["call", "visit", "whatsapp"], "operators": ["eq", "in"] },
        { "key": "days_overdue", "label": "Days overdue", "type": "number", "operators": ["eq", "gte", "lte"], "hint": "0 = due today" }
      ] }
  ],
  "operators": [ { "key": "eq", "label": "is" }, { "key": "in", "label": "is one of" },
                 { "key": "any_of", "label": "has any of" }, { "key": "gte", "label": "at least" },
                 { "key": "lte", "label": "at most" } ],
  "reward_kinds": ["coin", "gig"]
}
```

| Trigger | When | Once per | Usually |
|---|---|---|---|
| `lead_created` | the partner adds a new farmer, verified by the farmer's OTP | farmer, ever | coins |
| `follow_up_done` | the partner logs a call / visit / WhatsApp on a lead whose follow-up is due today (IST) or overdue | lead + due day | a gig (₹) |
| `lead_stage_advanced` | the partner moves a lead forward (`won` and `lost` never fire it); fields: `to_stage`, `from_stage` | lead + stage reached | coins |
| `reorder` | the order service confirms a customer's repeat order (`POST /hooks/orders/confirmed`, result `updated`, newer than the last); field: `gap_days` | order | coins |
| `meeting_attendee_captured` | the partner captures a meeting attendee as a lead (the new lead may also pay `lead_created`); fields: `crops`, `acreage` | meeting + attendee | coins |
| `gig_approved` | HO approves submitted gig work — a bonus over the gig's own ₹ payout; fields: `attendees`, `photos` | gig | coins |
| `event_registered` | the partner takes a seat at an HO event (leaving and re-registering never pays again); field: `event_id` | event + partner, ever | coins |
| `attendance_streak` | the partner punches out with an unbroken run of field days (counted back 60 days at most); field: `streak_days` — an `is N` rule pays the day a streak reaches N, `at least N` pays every day it holds | IST day | coins |
| `onboarding_approved` | HO approves the partner's KYC (fired after they are placed in a cohort); fields: `partner_type`, `state` | partner, ever | coins |
| `story_created` | the partner saves a brand-new My Story (an edit or re-share never fires it); field: `template` | story | coins |

| Type | Operators | `value` |
|---|---|---|
| `string` | `eq`, `in` | a word (≤ 100) / a list of 1–200 words; compared without case |
| `enum` | `eq`, `in` | one / a list of the field's `values` |
| `number` | `eq`, `gte`, `lte` | a number from 0 |
| `string[]` | `any_of` | a list of 1–200 words; holds when the event has any of them (no case) |

### `POST /admin/earning-rules`

```jsonc
{
  "cohort_id": "ec_paddy_belt",          // an active cohort (archived → 409 EARNING_ARCHIVED)
  "name": "Paddy farmer, 2+ acres",      // ≤ 80
  "trigger": "lead_created",
  "conditions": [                        // ≤ 10, all must hold; [] or left out = every time
    { "field": "crops", "op": "any_of", "value": ["Paddy"] },
    { "field": "acreage", "op": "gte", "value": 2 }
  ],
  "reward": { "kind": "coin", "amount": 20 }   // whole, 1–1,00,000 (coins, or ₹ for gig)
}
```

- Each condition is checked against the catalog: a field the trigger does not have, an
  operator its type does not take, or a value of the wrong type is
  `400 VALIDATION_FAILED`; `details` lists every problem, one line each.
- The rule goes **last** in its cohort; move it with `PUT /order`.
- A state value is kept upper case.

### `EarningRule`

```jsonc
{
  "id": "6c1e…",                // UUID
  "cohort_id": "ec_paddy_belt", "name": "Paddy farmer, 2+ acres", "trigger": "lead_created",
  "conditions": [ … ],
  "reward": { "kind": "coin", "amount": 20 },
  "order": 1, "status": "active", "version": 1,
  "summary": "Crops has any of Paddy · Acreage at least 2",
  "created_by": "…", "updated_by": "…", "archived_by": null, "archived_at": null,
  "created_at": "…", "updated_at": "…"
}
```

- `PATCH` changes only what is sent; `conditions` is the whole list. The `trigger` and
  `cohort_id` never change — archive the rule and add a new one. Stale `version` →
  `409 VERSION_CONFLICT`; archived → `409 EARNING_ARCHIVED`.
- Archive = the delete: the rule stops paying; rewards it already gave stay.
- `PUT /order { cohort_id, ids }` takes every **active** rule of that cohort once
  (all triggers together); otherwise `409 EARNING_ORDER_CHANGED`.

## Rewards — the approval desk

Every reward an event earns is recorded **at that moment** in `vistaar_v2_rewards` —
the rule, its name, the amount and the partner's cohort then — as **`pending`**. HO
approves or rejects it here. Nothing is paid before approval.

- **Coins** are points: approved coins add to the partner's balance in the app. There
  is no redeem or spend yet, and coins never reach the wallet.
- **Gig ₹** (follow-ups): an approved gig reward is earned **at approval** and joins the
  partner's wallet exactly like an approved meeting gig — and, like it, only while
  settings `gig_pay_enabled` is on (off until Finance confirms the TDS section; one
  switch for both). Approvals made while it is off count from the moment it is
  switched on.
- **One per event and kind**, whatever happens: a farmer's `lead_created` pays once
  ever (also after a release, a takeover or a remove and re-add — the first reward
  stands); a `follow_up_done` once per lead per **due day** (IST). The row id says so:
  `<trigger>:<the event's once-only key>:<kind>` — e.g. `lead_created:<pii_id>:<kind>`,
  `follow_up_done:<pii_id>:<YYYY-MM-DD>:<kind>`, `reorder:<order_id>:<kind>`,
  `attendance_streak:<agent_id>:<day>:<kind>` (the *Once per* column above).
- When a partner **removes a lead**, its `lead_created` rewards still `pending` are
  rejected by the system: `reason: "lead removed"`, `reviewed_by: "system"`. Approved
  ones stay.
- A reward is never deleted (an approved gig is money; a rejected one is the answer the
  partner sees). HO cannot create one by hand.

Capabilities (heads and admins today): `rewards.read` to see, `rewards.review` to
approve or reject.

| Method | Path | Capability | Body | Returns |
|---|---|---|---|---|
| `GET` | `/api/v2/admin/rewards?status=&kind=&trigger=&agent_id=&from=&to=&page=&limit=` | `rewards.read` | — | `PageResult<Reward>` — newest first |
| `GET` | `/api/v2/admin/rewards/summary?from=&to=` | `rewards.read` | — | `RewardsSummary` |
| `GET` | `/api/v2/admin/rewards/:id` | `rewards.read` | — | `Reward` |
| `POST` | `/api/v2/admin/rewards/:id/approve` | `rewards.review` | — | `Reward` |
| `POST` | `/api/v2/admin/rewards/:id/reject` | `rewards.review` | `{ "reason": "…" }` (1–300) | `Reward` |
| `POST` | `/api/v2/admin/rewards/approve` | `rewards.review` | `{ "ids": [...] }` (1–200) | `BulkResult` |
| `POST` | `/api/v2/admin/rewards/reject` | `rewards.review` | `{ "ids": [...], "reason": "…" }` | `BulkResult` |

Filters: `status` `pending` · `approved` · `rejected`; `kind` `coin` · `gig`; `trigger`
any trigger key of the catalog; `agent_id` `VST-…`; `from` / `to` IST days
(`YYYY-MM-DD`, both included) on when the reward was earned. The queue is
`?status=pending`.

### `Reward`

```jsonc
{
  "id": "follow_up_done:PII-1620070:2026-10-14:gig",
  "kind": "gig",                          // coin · gig
  "trigger": "follow_up_done",            // any trigger key of the catalog
  "trigger_label": "Follow-up done",
  "rule_id": "6c1e…", "rule_name": "Any follow-up on time",   // as the rule was then
  "cohort_id": "ec_paddy_belt",           // the partner's earning cohort then
  "pii_id": "PII-1620070", "farmer_name": "Ramesh Patel",     // the farmer, as then (null on a trigger not about one)
  "ref_id": null,                         // the order / meeting / gig / event / story / day / agent it is about; else null
  "due_day": "2026-10-14",                // follow_up_done: the IST day it was due; else null
  "amount": 15,                           // coins, or ₹ for a gig
  "status": "pending",                    // pending · approved · rejected
  "reason": null,                         // rejected: why (the partner sees it)
  "reviewed_by": null, "reviewed_at": null,   // HO email or "system"
  "agent_id": "VST-000006",
  "partner": { "agent_id": "VST-000006", "name": "Asha Verma" },
  "created_at": "2026-10-16T05:31:02.000Z"
}
```

### Approve / reject

- Only a **`pending`** reward moves, once: the status is part of the write, so two HO
  screens cannot both decide it. Already decided → `409 REWARD_NOT_PENDING`
  (`details: ["status=approved"]`); unknown id → `404`.
- Bulk takes up to 200 ids and never fails as a whole:

```jsonc
// BulkResult
{
  "changed": ["lead_created:PII-1620070:coin", "…"],
  "skipped": [
    { "id": "lead_created:PII-77:coin", "status": "approved" },  // already decided
    { "id": "lead_created:PII-0:coin",  "status": null }         // no such reward
  ]
}
```

### `RewardsSummary`

```jsonc
{
  "coin": { "pending":  { "count": 12, "amount": 240 },
            "approved": { "count": 80, "amount": 1600 },
            "rejected": { "count": 3,  "amount": 60 } },
  "gig":  { "pending":  { "count": 5,  "amount": 75 }, "approved": { … }, "rejected": { … } },
  "pending": 17                            // both kinds: the queue's badge
}
```

## Errors

| HTTP | `error.code` | When |
|---|---|---|
| 400 | `VALIDATION_FAILED` | body shape; a cohort with no condition (or no legacy filter), or with both shapes at once; a condition the catalog refuses (`details` lists them) |
| 400 | `EARNING_COHORT_LOCKED` | conditions (or legacy filters) on, or archive of, `ec_default` |
| 404 | `NOT_FOUND` | no such cohort, rule or partner |
| 409 | `COHORT_EXISTS` | the key is taken (or `default`) |
| 409 | `VERSION_CONFLICT` | edited on another screen since it was read |
| 409 | `EARNING_ARCHIVED` | edit / archive an archived cohort or rule; a rule for an archived cohort |
| 409 | `EARNING_ORDER_CHANGED` | a reorder's `ids` are not exactly the active list now |
| 409 | `REWARD_NOT_PENDING` | approve / reject a reward already approved or rejected |
