# Farmer leads (Vistaar app)

**Base URL:** `{API_BASE}/api/v2` · bearer = partner `access_token` (AUTH-APP.md).
Only an **approved** partner can add farmers. Screens: Add lead, Leads (list / board), Lead
detail, Home "follow-ups due" (PRD C2, C4, C9, H5).

> **Updated 2026-10-13 (2) — a farmer is released when not worked.** New on the lead:
> `releases_at`, `held_since`, `last_worked_at`, `last_order_at`. New `GET /leads/check`
> status `released`. See *One farmer, one partner* and *Keeping a farmer*. Nothing removed.
>
> *Earlier on 2026-10-13:* added *From the app's `Lead` model* (field mapping) and
> *Ordering for a lead* (the cart accepts every farmer you hold, linked ones too).

A partner adds **farmers only**. One farmer belongs to **one partner**. A lead becomes a
customer — stage `won` — with its first order; the partner never sets `won`.

## One farmer, one partner

A farmer (one mobile number = one person) can be with only **one** Vistaar partner; a
partner can have any number of farmers (PRD C2, R1).

- Partner A adds a mobile → that farmer is A's.
- Partner B checks the same mobile → `GET /leads/check` says `other_partner`: tell B before
  they fill the form. If B saves anyway → `409 FARMER_TAKEN`.
- Only A can order for that farmer; for B the cart answers `404 NOT_FOUND`.
- Two partners saving the same farmer at the same second: one wins, the other gets
  `FARMER_TAKEN`.
- **Not forever:** if A does not work the farmer, they are released (below) and B can add
  them — `GET /leads/check` then says `released`, and B's save takes the farmer over.
- HO can also move a farmer to another partner (e.g. a partner left). Never from the app.

## Keeping a farmer

A partner keeps a farmer only while working them (user's rule, 2026-10-13; HO can change
the days):

| Farmer | Released after |
|---|---|
| Lead (no order yet) | **15 days** with no work |
| Customer (has ordered) | **45 days** with no order |
| Any, if the partner is blocked | at once |

- **Work** = saving the lead again, a stage change, a follow-up or expected-value change
  (`PATCH`), or a logged call / visit / WhatsApp / note. Opening the lead is not work. A
  follow-up date far ahead does **not** keep the farmer — only logged work does.
- `releases_at` on every lead says when. Nothing happens at that moment: the farmer stays
  yours, and any work renews it, until another partner adds them after it.
- Once another partner takes the farmer, they leave your lists and your cart (`404`).
- The new partner starts fresh at Prospect (a customer stays `won`) and does not see your
  notes.

**Show in the app:** "Releases in N days" on a lead when `releases_at` is within 3 days
(red when past); and when a follow-up being set is later than `releases_at`, warn: "Log a
call or visit before <date> or another partner can take this farmer."

## Routes

| Method | Path | |
|---|---|---|
| GET | `/leads/consent` | `{ version, text: { en, hi } }` — show beside the consent tick, send `version` back |
| GET | `/leads/check?phone=` | before saving: `{ status, pii_id }` (table below) — writes nothing |
| POST | `/leads` | add a farmer, or update one you hold (same mobile) → the lead + `result` |
| GET | `/leads?stage&due&q&page&limit` | my leads, **most urgent first** |
| GET | `/leads/summary` | the Leads cards and Home "follow-ups due" |
| GET | `/leads/:piiId` | one lead with `stage_history` and `activities` |
| PATCH | `/leads/:piiId` | stage · lost reason · follow-up · expected value |
| POST | `/leads/:piiId/activities` | log a call / visit / WhatsApp / note |

`pii_id` is the lead's id everywhere — the cart's "Ordering for" takes the same id
(`PUT /cart/customer`). "Place first order" = set the cart customer to the lead's `pii_id`.

### Ordering for a lead

`PUT /cart/customer { "pii_id": "<lead's pii_id>" }` (CART-APP.md) accepts **every farmer in
your `GET /leads`** — ones you created and Katyayani farmers you linked — in any stage.
Any other `pii_id` is `404 NOT_FOUND` ("This customer could not be found."). The "Ordering
for" picker should list your leads (and later your customers) from `GET /leads`.

### From the app's `Lead` model

The Flutter `Lead` (`features/customers/domain/entities/lead.dart`) maps like this:

| App (`Lead`) | API | Note |
|---|---|---|
| `id` | `pii_id` | the id in every route |
| `name`, `phone`, `village` | `name`, `phone`, `village` | required on save |
| `district` | `district` | may be `null` → show `""` |
| `crop` | `crops[0]` | send `crops: [crop]`; more crops may follow |
| `acreage` | `acreage` | acres, > 0 |
| `source` (`LeadSource`) | `found_via` | same wire values; may be `null` if never sent |
| `stage` (`LeadStage`) | `stage` | same wire values |
| `expectedValue` | `expected_value` | `null` → `0` |
| `nextFollowUp` | `next_follow_up` | send local time with `+05:30`; answers come in UTC (`…Z`) |
| `lostReason` | `lost_reason` | |
| `createdAt` | `created_at` | |
| `activities` (`LeadActivity`) | `activities` | only in `GET /leads/:piiId` and write answers; list rows have none. Types `call` · `visit` · `whatsapp` · `note` · `stage_change` |
| consent tick | `consent_version` | the `version` from `GET /leads/consent`; show its `text` (`hi` when the app is in Hindi) |
| ex-employee declaration | `ex_employee_declared` | send `true` when the partner's cohort is `ex_employee` |

### `GET /leads/check?phone=`

| `status` | Meaning — what to show |
|---|---|
| `new` | not with Katyayani — save adds them |
| `yours` | already your lead — save updates them ("Already in your leads") |
| `katyayani` | a Katyayani farmer (app, KKD…) no partner holds — save makes them yours |
| `other_partner` | another partner's farmer — save is refused |
| `released` | was another partner's, not worked in time — save makes them yours (result `linked`) |
| `not_farmer` | registered as a retailer / business — save is refused |
| `self` | your own number |

## `POST /leads`

```jsonc
{
  "phone": "9876543210",            // required (+91 / spaces / dashes fine)
  "name": "Ramesh Patel",           // required
  "village": "Rampur",              // required
  "crops": ["Wheat"],               // required — main crop first, 1–10
  "acreage": 5,                     // required — acres, > 0
  "consent_version": 1,             // required — from GET /leads/consent
  "district": "Bhopal",             // optional
  "pincode": "462026",              // optional — sets state (and district if not sent)
  "found_via": "meeting",           // optional — meeting | referral | walk_in | self | campaign
  "expected_value": 2500,           // optional — expected first order, ₹
  "next_follow_up": "2026-10-15T10:00:00+05:30",   // optional — future only
  "note": "Needs a fungicide",      // optional — saved as the first activity
  "ex_employee_declared": true      // required for ex-employee partners (12-month declaration)
}
```

Without a pincode the farmer's state is the partner's own state. Sending a mobile you
already hold updates the farmer (name, village, crops, acreage, and any of `found_via`,
`expected_value`, `next_follow_up`, `note` sent) — so an offline sync can safely resend.

Answer `200` — the lead (shape below) plus `result`: `created` (new to Katyayani) ·
`linked` (an existing Katyayani farmer, or a released one, now yours) · `updated` (yours
already).

## The lead

```jsonc
{
  "pii_id": "PII-1620671", "lead_id": "L-4187725", "origin": "created",   // created | linked
  "agent_id": "VST-000001",
  "name": "Ramesh Patel", "phone": "9876543210", "village": "Rampur",
  "district": "BHOPAL", "state": "MADHYA PRADESH", "pincode": "462026",
  "crops": ["Wheat"], "acreage": 5,
  "found_via": "meeting", "expected_value": 2500,
  "stage": "prospect",              // prospect | contacted | interested | negotiation | won | lost
  "next_follow_up": "2026-10-15T04:30:00.000Z", "lost_reason": null,
  "consent_version": 1, "customer_at": null,
  "held_since": "…",                // since when you hold this farmer
  "last_worked_at": "…",            // your last work on it
  "last_order_at": null,            // last order (customers)
  "releases_at": "2026-10-28T…Z",   // another partner may take it from then, unless you work it
  "created_at": "…", "updated_at": "…",
  // GET /leads/:piiId, PATCH, activities, POST only:
  "stage_history": [{ "from": null, "to": "prospect", "at": "…", "by": "VST-000001" }],
  "activities": [{ "id": "…", "type": "note", "text": "…", "at": "…", "by": "VST-000001" }]  // newest first, last 100
}
```

## Lists and cards

`GET /leads` — `stage` (one stage), `due=true` (open leads with a follow-up today or
overdue), `q` (name, village, crop, or digits of the mobile). Order = the app's
`byUrgency`: open leads first — overdue, then with a follow-up, then without — closed last;
within each, the soonest follow-up (else the oldest lead) first. List rows leave out
`stage_history` / `activities`.

`GET /leads/summary`:

```jsonc
{ "total": 12, "open": 9, "pipeline_value": 42000,   // Σ expected_value of open leads
  "won": 2, "lost": 1, "conversion_pct": 67,           // won ÷ (won + lost)
  "due": 3,                                            // due today incl. overdue
  "by_stage": [{ "key": "prospect", "count": 5 }, …] }
```

## `PATCH /leads/:piiId`

Only what is sent changes; `null` clears.

```jsonc
{ "stage": "contacted" }
{ "stage": "lost", "lost_reason": "Price too high" }   // reason required; clears the follow-up
{ "next_follow_up": "2026-10-16T09:00:00+05:30" }     // future; open leads only
{ "next_follow_up": null, "expected_value": 3000 }
```

- `won` is refused (`409 STAGE_NOT_ALLOWED`) — it comes from the first order. A won lead's
  stage is fixed.
- A lost lead reopens by moving it to any other stage (the reason is cleared).
- Each stage move is logged in `stage_history` and as a `stage_change` activity.

`POST /leads/:piiId/activities` `{ "type": "call|visit|whatsapp|note", "text": "…" }` (≤ 500).

## Errors

| Code | HTTP | Show |
|---|---|---|
| `VALIDATION_FAILED` | 400 | `details[0]` / `message` (missing crop, past follow-up, lost without reason, missing ex-employee declaration…) |
| `INVALID_PHONE` | 400 | not a 10-digit Indian mobile |
| `SELF_LEAD` | 400 | your own number |
| `FARMER_TAKEN` | 409 | another partner's farmer |
| `NOT_A_FARMER` | 409 | registered as a retailer / business |
| `CONSENT_OUTDATED` | 409 | wording changed — reload `GET /leads/consent`, show it, ask again |
| `STAGE_NOT_ALLOWED` | 409 | `won` (first order only), or the lead is already a customer |
| `STAGE_CHANGED` | 409 | the lead changed meanwhile — reload it |
| `PARTNER_NOT_APPROVED` / `ACCOUNT_BLOCKED` | 403 | |
| `NOT_FOUND` | 404 | not one of your leads |
| `LEADS_NOT_CONFIGURED` | 503 | adding **new** farmers is off (no lead owner set) — linking still works |
| `LEADS_UNAVAILABLE` | 503 | try again |
