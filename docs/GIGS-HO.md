# Gigs — HO portal contract

Paid farmer meetings HO posts for partners (PRD AD14): post a gig, a partner takes it
(or HO gives it), checks in at the venue, lists the farmers and adds photos; HO
approves or rejects the proof. The app side is `GIGS-APP.md`.

Capabilities (heads and admins today): `gigs.read` to see, `gigs.write` to post,
edit, assign, reopen, cancel and delete, `gigs.review` to approve or reject —
approval is what pays the partner.

| Method | Path | Capability | Body | Returns |
|---|---|---|---|---|
| `GET` | `/api/v2/admin/gigs?status=&agent_id=&state=&district=&from=&to=&page=&limit=` | `gigs.read` | — | `PageResult<AdminGigRow>` — latest `starts_at` first |
| `GET` | `/api/v2/admin/gigs/summary?` same filters | `gigs.read` | — | `GigSummary` |
| `GET` | `/api/v2/admin/gigs/:id` | `gigs.read` | — | `AdminGigView` |
| `POST` | `/api/v2/admin/gigs` | `gigs.write` | `CreateGig` | `201` `AdminGigView` |
| `PATCH` | `/api/v2/admin/gigs/:id` | `gigs.write` | any `CreateGig` field | `AdminGigView` — only while open and nobody holds it |
| `DELETE` | `/api/v2/admin/gigs/:id` | `gigs.write` | — | `{ "deleted": true }` — only if nobody ever took it |
| `POST` | `/api/v2/admin/gigs/:id/assign` | `gigs.write` | `{ "agent_id": "VST-000006" }` | `AdminGigView` |
| `POST` | `/api/v2/admin/gigs/:id/reopen` | `gigs.write` | — | `AdminGigView` |
| `POST` | `/api/v2/admin/gigs/:id/cancel` | `gigs.write` | `{ "reason": "…" }` (1–300) | `AdminGigView` |
| `POST` | `/api/v2/admin/gigs/:id/approve` | `gigs.review` | — | `AdminGigView` |
| `POST` | `/api/v2/admin/gigs/:id/reject` | `gigs.review` | `{ "reason": "…" }` (1–300) | `AdminGigView` |

| Param | Rule |
|---|---|
| `status` | `open`, `accepted`, `checked_in`, `submitted`, `approved`, `rejected`, `cancelled` |
| `agent_id` | `VST-…` (any case) — the partner holding it |
| `state` | exact, upper case (`MADHYA PRADESH`) |
| `district` | exact, any case |
| `from`, `to` | IST days `YYYY-MM-DD`, both included, on `starts_at`. Summary default: this whole IST month (gigs ahead included); `from` after `to` is `400` |
| `limit` | Default 50, clamped to 200 |

## Status

```
open → accepted → checked_in → submitted → approved | rejected
```

| Action | From | Then |
|---|---|---|
| assign | `open` | `accepted` for that partner (`assigned_by` = HO email) |
| reopen | `accepted`, `checked_in` | `open` for anyone; check-in, farmers and photos are cleared from the gig — **the photo files stay in the bucket** (audit); `releases[]` gets `{ agent_id, at, by: "ho" }` |
| cancel | anything not `approved` / `rejected` / `cancelled` | `cancelled`, final; the partner sees `cancel_reason` |
| approve / reject | `submitted` | final; the partner sees `reject_reason`. A rejected gig cannot be sent again |

A partner can give a gig back (`by: "partner"` in `releases[]`) only before its IST
day. **`missed: true`** = held (accepted or checked in) and its IST day has passed:
cancel or reopen it. Anything refused is `409 GIG_CLOSED` ("moved on since you opened
it — reload").

## `POST /admin/gigs`

```jsonc
{
  "title": "Paddy blast demo · Rampur",          // required, ≤ 120
  "village": "Rampur",                           // required, ≤ 80
  "starts_at": "2026-10-25T10:00:00+05:30",      // required, in the future
  "ends_at": "2026-10-25T12:00:00+05:30",        // required, after starts_at
  "district": "Bhopal",                          // optional, ≤ 60
  "state": "MADHYA PRADESH",                     // optional, ≤ 60, kept upper case
  "pincode": "462026",                           // optional, 6 digits
  "venue": "Panchayat bhawan",                   // optional, ≤ 120
  "venue_point": { "lat": 23.2599, "lng": 77.4126 }, // optional — the pin check-in distance is measured from
  "expected_farmers": 25,                        // optional, 0–300 (default 0)
  "min_farmers": 15,                             // optional, 1–300 — default settings gig_min_farmers
  "photos_required": 3,                          // optional, 0–6 — default settings gig_photos_required
  "payout": 250,                                 // optional, ₹ 0–1,00,000 — default settings gig_payout
  "products": ["Humic acid 98%"],                // optional, ≤ 20, each ≤ 80
  "requirements": ["2 testimonials"],            // optional, ≤ 10, each ≤ 120 — shown to the partner
  "cohorts": ["vistaar_agent"]                   // optional — cohort keys; empty = every partner
}
```

- The id is `GIG-000001` onwards.
- Who sees it in the app: partners of the gig's `cohorts`, and of its `state` when both
  the gig and the partner have one. Without `venue_point` there is no `far` flag and
  the gig sorts after pinned ones. Partners see a new gig within a minute.
- `PATCH` changes only what is sent; `null` clears `district`, `state`, `pincode`,
  `venue`, `venue_point`; `null` on any other field is `400`. A new `starts_at` must be in the future. A gig a
  partner gave back (or HO reopened) is open again and can be edited, not deleted.

## `POST /admin/gigs/:id/assign`

Open gigs that have not started. The partner must be approved and active and in the
gig's cohorts (each `400 VALIDATION_FAILED`, the message says which). The state and the
partner's other gigs that day are not checked. A partner who took it meanwhile →
`409 GIG_TAKEN`.

## Review — `GET /admin/gigs/:id`

`AdminGigView` = the whole gig row plus:

```jsonc
{
  "id": "GIG-000001",
  "status": "submitted",
  "venue_point": { "lat": 23.2599, "lng": 77.4126 },
  "check_in": { "lat": 23.2611, "lng": 77.4102, "accuracy_m": 12, "at": "…",
                "distance_m": 270, "flags": [] },            // early · late · no_gps · far
  "attendees": [{ "phone": "9876543210", "name": "Ramesh Patel", "village": "Rampur" }],
  "photos": [{ "id": "…", "at": "…", "url": "https://…" }],  // signed for 1 h; null if it cannot be signed
  "repeat_phones": [
    { "phone": "9876543210", "partner_phone": false,
      "gigs": [{ "gig_id": "GIG-000004", "agent_id": "VST-000007", "starts_at": "…" }] }
  ],
  "partner": { "agent_id": "VST-000006", "name": "Ravi Kumar", "phone": "9155061725" },
  "missed": false,
  "releases": [], "submitted_at": "…", "reviewed_by": null, "reviewed_at": null,
  "reject_reason": null, "cancelled_by": null, "cancel_reason": null,
  "accepted_at": "…", "assigned_by": null, "posted_by": "ho@…", "updated_by": "VST-000006"
  // + title, village, district, state, pincode, venue, starts_at, ends_at,
  //   expected_farmers, min_farmers, photos_required, payout, products,
  //   requirements, cohorts, agent_id, created_at, updated_at
}
```

What to check before approving:

- **Check-in** — `flags`: `early` / `late` (not on the gig's IST day), `no_gps` (no
  fix sent), `far` (`distance_m` beyond the check-in radius from `venue_point`).
  Check-in is never refused in the app, so these are HO's call.
- **Farmers** — count against `min_farmers` (the app already enforces the minimum).
- **Photos** — at least `photos_required`, at most 6; reload for fresh links after an hour.
- **`repeat_phones`** — an attendee phone that was at another gig (any partner, any
  status) starting from 30 days before this gig on, or that is the partner's own
  phone (`partner_phone: true`). Only phones with a hit are listed.

`partner` is `null` while nobody holds the gig.

`AdminGigRow` (list) = the row without `attendees`, `photos`, `releases`, plus
`attendees_count`, `photos_count`, `partner_name` (profile name, else onboarding
name, or `null`) and `missed`. The id is `_id`.

## `GET /admin/gigs/summary`

```json
{
  "by_status": { "open": 5, "accepted": 2, "checked_in": 1, "submitted": 3,
                 "approved": 8, "rejected": 1, "cancelled": 1 },
  "partners": 9,
  "approved_payout": 2000,
  "farmers": 240,
  "from": "2026-10-01",
  "to": "2026-10-31"
}
```

`partners` = partners holding a gig in the window; `approved_payout` = ₹ of approved
gigs; `farmers` = attendees on every gig in the window.

## Settings

In `GET /admin/settings` (`agents.read`) / `PUT /admin/settings` (`settings.write`).
The first four are defaults for a **new** gig (each gig keeps its own copy); the
radius is read at every check-in.

| Field | Default | Range | What |
|---|---|---|---|
| `gig_payout` | 250 | 0–1,00,000 | ₹ per gig |
| `gig_min_farmers` | 15 | 1–300 | farmers needed to submit |
| `gig_photos_required` | 3 | 0–6 | photos needed to submit |
| `gig_checkin_radius_m` | 500 | 50–20,000 | check-in farther than this from `venue_point` is flagged `far` (m) |
| `gig_pay_enabled` | false | true / false | approved gigs' pay reaches the wallet (`COMMISSION-LOGIC.md`, *Meeting gigs*). **Keep off until Finance confirms the TDS on gig pay** |
| `gig_pay_enabled_at` | null | read-only | set once, the first time gig pay is switched on; never cleared. Gigs approved earlier count from this moment |

While gig pay is off nothing reaches the wallet; approval still records the gig as
earned (the app's `earned_this_month`). Switching it off again takes every gig's pay
back out of the wallet, also pay already withdrawn — keep it on once on.

## Errors

| Code | Status | When |
|---|---|---|
| `VALIDATION_FAILED` | 400 | Bad body / filter, `from` after `to`, past `starts_at`, `ends_at` not after `starts_at`, assign outside the gig's cohorts, empty reason |
| `PARTNER_NOT_APPROVED` | 400 | Assign to a partner not approved or not active |
| `NO_ADMIN_ACCESS` / `ROLE_NOT_ALLOWED` | 403 | No Vistaar access / no capability |
| `NOT_FOUND` | 404 | No such gig or partner |
| `GIG_TAKEN` | 409 | Assign lost to a partner who took it first |
| `GIG_CLOSED` | 409 | The gig's status does not allow it (see *Status*); delete of a gig taken before (cancel it instead) |

## Suggested HO page — **Gigs** (the frontend builds it)

- **Cards** — `GET /admin/gigs/summary`, by status, partners, approved payout, farmers.
- **Calendar / list** — `GET /admin/gigs?from=&to=` by month, filters status, state,
  district, partner; a *Missed* badge from `missed`.
- **Post / edit** — the `CreateGig` form with a map pin for `venue_point`; defaults
  shown from settings; delete only for never-taken gigs, else cancel with a reason.
- **Review queue** — `status=submitted`; the drawer shows the map (venue pin +
  check-in point), flags, farmers with repeat-phone warnings, photos; approve / reject.
- **Actions** — assign (partner picker), reopen, cancel.
- **Settings card** — the five gig fields above.
