# Gigs — mobile app contract

Paid farmer meetings HO posts (PRD AD14; the Gigs and Gig details screens): take
one, check in at the venue, list the farmers who came, add photos, send the proof.
HO approves it and the gig's `payout` is earned. Gigs you hold also show in Today's
tasks (`TODAY-APP.md`), My Story's invite picker (`STORIES-APP.md`) and My
Performance (`MY-PERFORMANCE-APP.md`).

Every route takes `Authorization: Bearer <Vistaar access token>`. A gig that is not
open for your cohort and not yours answers `404`.

| Method | Path | Body | Returns |
|---|---|---|---|
| `GET` | `/api/v2/gigs?tab=&page=&limit=` | — | `PageResult<Gig>` (see *Tabs*) |
| `GET` | `/api/v2/gigs/summary` | — | `GigSummary` |
| `GET` | `/api/v2/gigs/:id` | — | `GigDetail` |
| `POST` | `/api/v2/gigs/:id/accept` | — | `200` `GigDetail` + `warning` |
| `POST` | `/api/v2/gigs/:id/release` | — | `200` `GigDetail` — give it back |
| `POST` | `/api/v2/gigs/:id/check-in` | `CheckIn` | `200` `GigDetail` |
| `PUT` | `/api/v2/gigs/:id/attendees` | `{ "attendees": Attendee[] }` | `GigDetail` — the whole list |
| `POST` | `/api/v2/gigs/:id/photos/upload-url` | `{ content_type, size }` | `200` `PhotoTicket` |
| `POST` | `/api/v2/gigs/:id/photos` | `{ "path": "…" }` | `201` `GigDetail` |
| `DELETE` | `/api/v2/gigs/:id/photos/:photoId` | — | `GigDetail` |
| `POST` | `/api/v2/gigs/:id/submit` | — | `200` `GigDetail` |

No create, edit or delete: gigs are HO's.

## Status

```
open → accepted → checked_in → submitted → approved | rejected
```

- `open` → `accepted`: you accept it, or HO gives it to you (a cohort-paid gig's pay is
  fixed to your cohort's rate then).
- `accepted` → `open`: you give it back (`release`), or HO reopens it (also from
  `checked_in` — your check-in, farmers and photos are cleared; a cohort-paid gig's pay is
  unfixed again).
- `cancelled`: HO cancels any gig not yet approved or rejected; `cancel_reason` says why.
- `approved`, `rejected` (with `reject_reason`) and `cancelled` are final. A rejected
  gig cannot be sent again.

| | accepted | checked_in | submitted and later |
|---|---|---|---|
| release | yes, before the gig's IST day | no | no |
| check-in | yes | again = no-op | no |
| attendees, photos | no | yes | no |
| submit | no | yes | again = no-op |

Anything refused here is `409 GIG_CLOSED`.

**`missed`** is a flag, not a status: `true` when you hold the gig (accepted or
checked in) and its IST day has passed. It stays in *Mine* until HO cancels or
reopens it; check-in (flagged `late`) and submit still work.

## Tabs

| `tab` | Gigs | Order |
|---|---|---|
| `available` (default) | open, not started, for your cohort (a gig with no cohorts is for everyone), and in your state when both states are known | nearest venue first (from your registered location); gigs without a pinned venue after, soonest first |
| `mine` | yours: `accepted`, `checked_in`, `submitted` | soonest first |
| `history` | yours: `approved`, `rejected`, `cancelled` | latest first |

`available` is read at most once a minute per server: a new gig can take up to a
minute to show, and a gig just taken may still show — accept then answers `409 GIG_TAKEN`.

## `GET /gigs/summary`

```json
{ "available": 4, "mine": 1, "earned_this_month": 500, "pay_enabled": false }
```

`earned_this_month` = ₹ of your approved gigs held this IST month, whether or not gig
pay is on. See *Pay*.

## `POST /gigs/:id/accept`

- Only an **approved** partner (`403 PARTNER_NOT_APPROVED` / `ACCOUNT_BLOCKED`).
- Held by another partner, or lost a race → `409 GIG_TAKEN`. Already started,
  decided or cancelled → `409 GIG_CLOSED`.
- Accepting a gig you already hold returns it (a double tap is safe).
- `warning` = `"You already have a gig that day."` when you hold another gig on the
  same IST day, else `null`. **It never blocks** — show it.

## `POST /gigs/:id/release`

Only while `accepted` and **before the gig's IST day**. On the day or after →
`409 GIG_CLOSED` ("Ask HO to reassign it"). The gig is open for anyone again.

## `POST /gigs/:id/check-in`

```json
{ "location": { "lat": 23.2599, "lng": 77.4126 }, "accuracy_m": 12 }
```

Both optional — leave `location` out when the phone has no fix. Time is the server's.
**Check-in is never refused**; the gig's `check_in` records flags HO sees at review:

| Flag | When |
|---|---|
| `early` | before the gig's IST day |
| `late` | after the gig's IST day |
| `no_gps` | no `location` sent |
| `far` | farther than the check-in radius (settings, default 500 m) from the venue HO pinned |

`check_in`: `{ lat, lng, accuracy_m, at, distance_m, flags[] }` — `distance_m` is
`null` without a fix or without a pinned venue.

## `PUT /gigs/:id/attendees`

Send the **whole list as it stands** after every change. Up to 300 rows. Only
after check-in.

```json
{ "attendees": [
  { "phone": "9876543210", "name": "Ramesh Patel", "village": "Rampur" },
  { "phone": "+91 91550 61725", "name": "Suresh" }
] }
```

- `phone` (+91 / spaces fine) and `name` (≤ 80) required; `village` optional (≤ 80).
- The same phone twice, or a bad mobile → `400 VALIDATION_FAILED`.
- A farmer left out of the list is removed.
- The list is not linked to your leads. To capture an attendee as your lead, use
  the normal `POST /leads` (`LEADS-APP.md`) with `found_via: "meeting"` and the full
  add-lead fields (consent, crops, acreage).

## Photos

At most **6** per gig, each ≤ **5 MB**, JPG / PNG / WEBP / HEIC. Only after check-in.

1. `POST /gigs/:id/photos/upload-url`

   ```json
   { "content_type": "image/jpeg", "size": 850000 }
   ```

   → `{ "path": "vistaar/gigs/VST-000006/GIG-000001/<uuid>.jpg", "upload_url": "…",
   "method": "PUT", "headers": { … }, "expires_at": "…" }` — valid 15 min.
   `content_type`: `image/jpeg`, `image/png`, `image/webp`, `image/heic`; anything else
   → `400 VALIDATION_FAILED`. Over 5 MB → `400 FILE_TOO_LARGE`.
2. `PUT` the file to `upload_url` with exactly `headers`.
3. `POST /gigs/:id/photos` with `{ "path": "<path from step 1>" }`. The file is checked:
   missing, over 5 MB, another type or another folder → `400 MEDIA_NOT_FOUND` (upload
   again). The same `path` twice is a no-op. A 7th photo → `400 VALIDATION_FAILED`.

`DELETE /gigs/:id/photos/:photoId` removes the photo and its file; an id already
gone returns the gig as it is.

## `POST /gigs/:id/submit`

Needs at least the gig's `min_farmers` attendees and `photos_required` photos. Short →
`400 VALIDATION_FAILED`: `message` = the first problem ("Add 3 more farmers (at
least 15)."), `details` = all of them. Submitting again returns the gig. After
submit nothing on the gig changes until HO decides.

## Pay

- `payout` (₹) is per gig, fixed once you hold it, and **earned when HO approves**.
- `payout_source: "cohort"` (new) = HO left the pay to your **earning cohort**: an open
  gig shows **your** cohort's meeting-gig rate (another partner may see another amount),
  fixed when you accept or HO gives it to you; give it back and it is no longer yours to
  keep. `"gig"` = HO set the ₹ on the gig, the same for everyone. Show "Your rate" next to
  a `cohort` payout on the Available tab.
- It reaches the **wallet only when HO switches gig pay on** (`pay_enabled` in
  `GET /gigs/summary`). It is off until Finance confirms the TDS on gig pay. When on,
  approved gigs show in the wallet as `gig_earned` (`COMMISSION-APP.md`).
- While `pay_enabled` is `false`, do not promise wallet money — show the payout as
  approved pay that will be added once gig pay starts.
- Follow-up **gig rewards** (₹ for a call / visit / WhatsApp on a due follow-up) are not
  gigs: they are listed in `GET /rewards` (`EARNINGS-APP.md`), and only add to the same
  wallet `gig_earned`. `earned_this_month` here counts meeting gigs only.

## Shapes

`Gig` (lists):

```json
{
  "id": "GIG-000001",
  "title": "Paddy blast demo · Rampur",
  "village": "Rampur",
  "district": "Bhopal",
  "state": "MADHYA PRADESH",
  "venue": "Panchayat bhawan",
  "venue_point": { "lat": 23.2599, "lng": 77.4126 }, // the pin, for directions; null when HO did not pin it
  "starts_at": "2026-10-25T04:30:00.000Z",
  "ends_at": "2026-10-25T06:30:00.000Z",
  "expected_farmers": 25,
  "min_farmers": 15,
  "photos_required": 3,
  "payout": 250,                  // on an open cohort-paid gig: what it pays you
  "payout_source": "gig",         // gig · cohort (see Pay)
  "products": ["Humic acid 98%"],
  "requirements": ["2 testimonials"],
  "status": "accepted",
  "distance_km": 4.2,
  "missed": false,
  "check_in": null,
  "attendees_count": 0,
  "photos_count": 0,
  "reject_reason": null,
  "cancel_reason": null
}
```

- `distance_km` = your registered location to the pinned venue, 1 decimal; `null`
  when either is unknown. Filled on list, detail and accept; the other write routes
  return `null` — keep the value you have.
- The venue's coordinates are not sent; directions use `venue` / `village`.
- On a gig that is not yours: `missed` `false`, `check_in` / reasons `null`, counts `0`.
- Show `starts_at` / `ends_at` in IST.

`GigDetail` = `Gig` + `attendees[]` `{ phone, name, village }` + `photos[]`
`{ id, url, at }`. Photo `url`s are signed for **1 hour** (`null` if a file could not
be signed) — reload the gig for fresh ones. Empty on a gig that is not yours.

## Errors

| Code | Status | When |
|---|---|---|
| `VALIDATION_FAILED` | 400 | Bad body, bad / repeated mobile, wrong photo type, 7th photo, submit short of farmers or photos |
| `FILE_TOO_LARGE` | 400 | Photo over 5 MB |
| `MEDIA_NOT_FOUND` | 400 | Photo not uploaded (or wrong type / folder) |
| `PARTNER_NOT_APPROVED` / `ACCOUNT_BLOCKED` | 403 | Accept before approval / when blocked. Accepting a gig you already hold (any later step) answers it as it is |
| `NOT_FOUND` | 404 | Not your gig and not open for your cohort |
| `GIG_TAKEN` | 409 | Another partner took it first |
| `GIG_CLOSED` | 409 | The gig's status does not allow it (see *Status*), or it changed meanwhile — reload |
| `TOO_MANY_REQUESTS` | 429 | More than 30 calls a minute to one write route |

## App changes

- **Read gigs from the API** — drop the mock / phone data. Tabs = `GET /gigs?tab=`;
  counts and pay = `GET /gigs/summary`.
- Show accept's `warning` when it is not `null`.
- **`payout_source`** (2026-10-16): on `cohort`, label the payout "Your rate" — it can
  differ between partners until someone takes the gig (see *Pay*).
- **Send the GPS fix at check-in** (`location`, `accuracy_m`); with no fix, check in
  without it. Never block check-in in the app either.
- Farmers screen: `PUT …/attendees` with the whole list (name + mobile, village optional).
- Photos: the three steps above; show `photos_required` and `min_farmers` progress.
- **`cancelled` is a new status** the app must accept (show `cancel_reason`); show
  `reject_reason` on `rejected`, and a *Missed* badge from `missed`.
- **Change "You will get a notification"** and similar text — there are no push
  notifications yet. Say the partner can check the gig's status here.
- Capture an attendee as a lead = `POST /leads` with `found_via: "meeting"` and the
  consent tick, crops and acreage, as Add lead does.
