# Farmer leads (Vistaar app)

**Base URL:** `{API_BASE}/api/v2` · bearer = partner `access_token` (AUTH-APP.md).
Only an **approved** partner can add farmers. Screens: Add lead, Leads (list / board), Lead
detail, Home "follow-ups due" (PRD C2, C4, C9, H5).

A partner adds **farmers only**. One farmer belongs to **one partner**. A lead becomes a
customer — stage `won` — with its first order; the partner never sets `won`.

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

### `GET /leads/check?phone=`

| `status` | Meaning — what to show |
|---|---|
| `new` | not with Katyayani — save adds them |
| `yours` | already your lead — save updates them ("Already in your leads") |
| `katyayani` | a Katyayani farmer (app, KKD…) no partner holds — save makes them yours |
| `other_partner` | another partner's farmer — save is refused |
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
`linked` (an existing Katyayani farmer, now yours) · `updated` (yours already).

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
