# Farmer leads (Vistaar app)

**Base URL:** `{API_BASE}/api/v2` · bearer = partner `access_token` (AUTH-APP.md).
Only an **approved** partner can add farmers. Screens: Add lead, Leads (list / board), Lead
detail, Home "follow-ups due" (PRD C2, C4, C9, H5).

> ⚠️ **BREAKING — Updated 2026-10-16: the farmer's OTP is mandatory on every
> `POST /leads`.** Add Lead gets a new step: `POST /leads/otp/send` → the farmer reads the
> code → `POST /leads/otp/verify` → `otp_token`, sent with `POST /leads`. Without it the
> save is `400 LEAD_OTP_REQUIRED`; a wrong / expired / other mobile's token is
> `400 LEAD_OTP_INVALID`. An app build without this step **cannot add farmers** against
> this backend. See *Farmer OTP* below. Also new: adding a farmer and logging a call /
> visit / WhatsApp on a due follow-up can earn coin / gig rewards (EARNINGS-APP.md) —
> the server makes them; nothing extra to send.
>
> **Updated 2026-10-16 — follow-up shared with Katyayani.** The follow-up you set is also
> copied to Katyayani's own record of a farmer you added (cleared when you clear it, the
> lead is lost or won, or the farmer leaves you). No route or field changed.
>
> **Updated 2026-10-14 (3) — where the farmer is.** `POST /leads`, `PATCH /leads/:piiId` and
> `POST /leads/:piiId/activities` (a `visit`) take an optional `location` — the phone's GPS
> then; every lead now has `location { lat, lng, exact, source, at }` (or `null`). It feeds
> the radar (RADAR-APP.md). Nothing removed.
>
> **Updated 2026-10-14 (2) — full CRUD.** `PATCH /leads/:piiId` now also edits the farmer
> (name, village, district, pincode, crops, acreage — not the mobile): the Lovable edit
> screen. New `DELETE /leads/:piiId` removes a lead added by mistake (not a customer).
> `conversion_pct` is now **won ÷ all leads**, as the app's tile. Don't send a `note` with
> `PATCH` — stage moves are logged by the server.
>
> **Updated 2026-10-14 — won is automatic.** When Katyayani confirms the first order you
> placed for a farmer, the lead moves to `won` by itself (`by: system`), with
> `customer_at` and `last_order_at` set; it then also shows in `GET /customers`
> (CUSTOMERS-APP.md). No route or field changed.
>
> **Updated 2026-10-13 (2) — a farmer is released when not worked.** New on the lead:
> `releases_at`, `held_since`, `last_worked_at`, `last_order_at`. New `GET /leads/check`
> status `released`. See *One farmer, one partner* and *Keeping a farmer*. Nothing removed.
>
> *Earlier on 2026-10-13:* added *From the app's `Lead` model* (field mapping) and
> *Ordering for a lead* (the cart accepts every farmer you hold, linked ones too).

A partner adds **farmers only**. One farmer belongs to **one partner**. A lead becomes a
customer — stage `won` — when the first order the partner placed for them is **confirmed**
by Katyayani; the partner never sets `won` (CUSTOMERS-APP.md).

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
| POST | `/leads/otp/send` | **new** — SMS the farmer an OTP `{ phone, resend? }` → `{ sent, resend_after_seconds }` |
| POST | `/leads/otp/verify` | **new** — `{ phone, otp }` → `{ otp_token, expires_at }` (15 minutes) |
| POST | `/leads` | add a farmer, or update one you hold (same mobile) → the lead + `result`; **needs `otp_token`** |
| GET | `/leads?stage&due&q&page&limit` | my leads, **most urgent first** |
| GET | `/leads/summary` | the Leads cards and Home "follow-ups due" |
| GET | `/leads/:piiId` | one lead with `stage_history` and `activities` |
| PATCH | `/leads/:piiId` | stage · lost reason · follow-up · expected value · the farmer's details |
| DELETE | `/leads/:piiId` | remove a lead added by mistake → `{ removed: true }` — not a customer |
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

## Farmer OTP — ⚠️ new mandatory step (2026-10-16)

Every `POST /leads` needs proof that the farmer's mobile answered an OTP **just now, for
you**. The Add Lead flow becomes:

1. `GET /leads/check?phone=` — stop here on `other_partner`, `not_farmer` or `self`
   (no SMS for a farmer you cannot add).
2. `POST /leads/otp/send`

   ```jsonc
   { "phone": "9876543210", "resend": false }   // resend: true for "send again"
   ```
   → `200 { "sent": true, "resend_after_seconds": 30 }`. Approved partners only (`403
   PARTNER_NOT_APPROVED` / `ACCOUNT_BLOCKED`). 3 sends (resends included) per mobile per
   10 minutes → `429 OTP_LIMIT` (`details: ["retry_after_seconds=…"]`). `503
   OTP_UNAVAILABLE`: the SMS service is down — try again.
3. The farmer reads out the code. `POST /leads/otp/verify`

   ```jsonc
   { "phone": "9876543210", "otp": "6942" }
   ```
   → `200 { "otp_token": "eyJ2Ijox….Qm9…", "expires_at": "2026-10-16T05:45:00.000Z" }`.
   Wrong / expired code → `401 OTP_INVALID`; 5 tries per mobile per 10 minutes → `429
   OTP_LIMIT`.
4. `POST /leads` with `"otp_token"` (below). The token is good for **15 minutes**, for
   **this mobile** and **this partner** only; within that time a retry of the same save
   (offline sync, a timeout) reuses it. After it, verify again.

The farmer's OTP has its own limits — it never uses up the partner's sign-in tries. On
beta, test farmer mobiles listed in `OTP_TEST_NUMBERS` take `OTP_TEST_CODE` and get no
SMS, exactly as sign-in. The lead keeps when the mobile was verified
(`otp_verified_at`, server side).

## `POST /leads`

```jsonc
{
  "otp_token": "eyJ2Ijox….Qm9…",     // required — from POST /leads/otp/verify, ≤ 15 min old
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
  "ex_employee_declared": true,     // required for ex-employee partners (12-month declaration)
  "location": { "lat": 23.21, "lng": 77.41, "accuracy_m": 20 }   // optional — the phone's GPS now (RADAR-APP.md)
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
  "location": { "lat": 23.21, "lng": 77.41, "exact": true, "source": "add", "at": "…" },  // or null; exact false = pincode area
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
  "won": 2, "lost": 1, "conversion_pct": 17,           // won ÷ all leads (the app's tile); won + lost = "closed"
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
// Edit farmer (Lovable edit screen) — any of these; the mobile cannot change:
{ "name": "Ramesh Kumar", "village": "Rampur", "district": "Bhopal",
  "pincode": "462026", "crops": ["Wheat", "Soybean"], "acreage": 6 }
```

- `won` is refused (`409 STAGE_NOT_ALLOWED`) — it comes from the first confirmed order. A won lead's
  stage is fixed.
- A lost lead reopens by moving it to any other stage (the reason is cleared).
- Each stage move is logged in `stage_history` and as a `stage_change` activity — the app
  does not write its own note (there is no `note` field; sending one is a 400).
- Editing the farmer: a new `pincode` moves the state (and the district, unless one is
  sent); `crops` replaces the list. Works for a customer too. Counts as work (renews the
  hold).

`POST /leads/:piiId/activities` `{ "type": "call|visit|whatsapp|note", "text": "…" }` (≤ 500).
With a `visit`, send `location` (the phone's GPS at the farm) — the best place for the
farmer. `PATCH` takes `location` too ("set the farm here").
Activities are a log: added and read, never edited or deleted.
A call / visit / WhatsApp logged on a lead whose `next_follow_up` is due today (IST) or
overdue completes that follow-up and can earn a reward (coin or gig ₹, by the
partner's earning-cohort rules), once per due day (EARNINGS-APP.md). Logging does not move `next_follow_up` — set the next one with
`PATCH`.

## `DELETE /leads/:piiId`

For a lead added by mistake (wrong number, wrong farmer). Your row goes; the farmer is free
again (`GET /leads/check` → `katyayani` for anyone). Katyayani's own records of the farmer
stay. A customer (`won`) cannot be removed — `409 STAGE_NOT_ALLOWED`.

## Errors

| Code | HTTP | Show |
|---|---|---|
| `VALIDATION_FAILED` | 400 | `details[0]` / `message` (missing crop, past follow-up, lost without reason, missing ex-employee declaration…) |
| `LEAD_OTP_REQUIRED` | 400 | `POST /leads` without `otp_token` — run the farmer OTP step |
| `LEAD_OTP_INVALID` | 400 | the token is expired, or for another mobile / partner — verify the farmer's OTP again (`details: ["reason=expired" \| "reason=mismatch" \| …]`) |
| `OTP_INVALID` | 401 | `POST /leads/otp/verify`: wrong or expired code |
| `OTP_LIMIT` | 429 | farmer OTP send / verify limit — wait `retry_after_seconds` |
| `OTP_UNAVAILABLE` | 503 | the SMS service did not answer — try again |
| `INVALID_PHONE` | 400 | not a 10-digit Indian mobile |
| `SELF_LEAD` | 400 | your own number |
| `PARTNER_NUMBER` | 409 | the number is a Vistaar partner's — `GET /leads/check`, `POST /leads/otp/send` and `POST /leads` all refuse it |
| `FARMER_TAKEN` | 409 | another partner's farmer |
| `NOT_A_FARMER` | 409 | registered as a retailer / business |
| `CONSENT_OUTDATED` | 409 | wording changed — reload `GET /leads/consent`, show it, ask again |
| `STAGE_NOT_ALLOWED` | 409 | `won` (set by the first confirmed order), the lead is already a customer, or removing a customer |
| `STAGE_CHANGED` | 409 | the lead changed meanwhile — reload it |
| `PARTNER_NOT_APPROVED` / `ACCOUNT_BLOCKED` | 403 | |
| `NOT_FOUND` | 404 | not one of your leads |
| `LEADS_NOT_CONFIGURED` | 503 | adding **new** farmers is off (no lead owner set) — linking still works |
| `LEADS_UNAVAILABLE` | 503 | try again |
