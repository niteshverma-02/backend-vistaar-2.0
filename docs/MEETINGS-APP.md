# Meetings — mobile app contract

The partner's own farmer meetings (PRD C5; the Meetings, Add meeting and Meeting
details screens): call your farmers, mark who came, add walk-ins, capture
interested ones as leads. Scheduled meetings also show in Today's tasks (today and
tomorrow, `TODAY-APP.md`) and in My Story's invite picker (`STORIES-APP.md`).

Every route takes `Authorization: Bearer <Vistaar access token>` and touches only
the caller's meetings: anyone else's answers `404`.

| Method | Path | Body | Returns |
|---|---|---|---|
| `GET` | `/api/v2/meetings?status=&page=&limit=` | — | `PageResult<Meeting>` — `status=scheduled`: soonest first; otherwise newest first |
| `GET` | `/api/v2/meetings/invitees?q=&village=&page=&limit=` | — | `PageResult<Invitee>` — whom you can invite |
| `GET` | `/api/v2/meetings/:id` | — | `MeetingDetail` |
| `POST` | `/api/v2/meetings` | `CreateMeeting` | `201` `MeetingDetail` |
| `PATCH` | `/api/v2/meetings/:id` | any `CreateMeeting` field but `id`, `invite` | `MeetingDetail` — only while `scheduled` |
| `POST` | `/api/v2/meetings/:id/cancel` | `{ "note"?: "Rain" }` (≤ 300) | `MeetingDetail` — only while `scheduled` |
| `POST` | `/api/v2/meetings/:id/complete` | — | `MeetingDetail` — needs ≥ 1 farmer present |
| `PUT` | `/api/v2/meetings/:id/attendees` | `{ "attendees": Attendee[] }` | `MeetingDetail` — the whole list |
| `POST` | `/api/v2/meetings/:id/attendees/:phone/lead` | `POST /leads` body | `200` `{ meeting: MeetingDetail, lead }` |

There is **no delete**, on purpose: cancel instead — the meeting and its attendance
stay on record.

## Status

`scheduled` → `completed` (`POST …/complete`) or `cancelled` (`POST …/cancel`).
Nothing moves back.

| | scheduled | completed | cancelled |
|---|---|---|---|
| `PATCH` details | yes | no | no |
| cancel / complete | yes | no | no |
| `PUT …/attendees`, capture a lead | yes | yes | no |

Anything refused here is `409 MEETING_CLOSED`.

## `POST /meetings`

```jsonc
{
  "id": "6f1c2b0e-9a4d-4c1e-8b7a-2d5e3f4a1b9c",  // required — a UUID the app makes
  "type": "crop_demo",                         // required — farmer_meeting | crop_demo | field_day | disease_camp | soil_health_camp
  "starts_at": "2026-10-20T10:00:00+05:30",    // required — in the future
  "village": "Rampur",                         // required, ≤ 80
  "title": "",                                 // optional, ≤ 120 — empty = "Crop demo · Rampur"
  "venue": "Panchayat bhawan",                 // optional, ≤ 120
  "pincode": "462026",                         // optional — 6 digits
  "organiser": "self",                         // optional — self | officer (default self)
  "agenda": "Topics, products to demo",        // optional, ≤ 500
  "invite": ["PII-1620070"]                    // optional — pii_ids from GET /meetings/invitees, ≤ 300
}
```

- **Retry-safe:** sending the same `id` again returns the meeting you already made
  (the body is not applied again), even after its start time. An `id` another partner holds is
  `409 MEETING_EXISTS` — make a new UUID.
- Only an **approved** partner can schedule (`403 PARTNER_NOT_APPROVED` /
  `ACCOUNT_BLOCKED`).
- `invite` takes only your own customers and open leads; any other `pii_id` is
  left out silently. Farmers are invited only here — a later `PUT …/attendees`
  adds walk-ins, not invites.

`PATCH` changes only what is sent; `null` or `""` clears `venue`, `pincode`,
`agenda`. A new `starts_at` must be in the future.
`title: ""` resets it to `"<type> · <village>"`; changing `type` or `village`
alone keeps the old title.

## `GET /meetings/invitees`

Your customers and open leads (lost ones left out), farmers of `village` first,
then by name. `q` = name, village, crop or mobile digits.

```json
{ "pii_id": "PII-1620070", "name": "Ramesh Patel", "phone": "9876543210", "village": "Rampur", "stage": "interested" }
```

## `PUT /meetings/:id/attendees`

Send the **whole list as it stands** after every change — invited farmers and
walk-ins, present or not. Up to 300 rows.

```json
{ "attendees": [
  { "phone": "9876543210", "name": "Ramesh Patel", "village": "Rampur", "present": true },
  { "phone": "+91 91550 61725", "name": "Suresh", "present": true }
] }
```

- `phone` (+91 / spaces fine), `name` (≤ 80) and `present` required; `village` optional.
- A phone that was invited stays `invited`; any other phone is a `walk_in`.
- A farmer left out of the list is removed from the meeting.
- A phone that is one of your own leads or customers is linked (`pii_id`, `stage`).
  Nobody else's records are looked at.
- A capture already made is kept for a phone still on the list.
- The same phone twice, or a bad mobile → `400 VALIDATION_FAILED`.
- Saved meanwhile (another device, a capture) → the server merges once more, then
  `409 VERSION_CONFLICT`: reload the meeting and send again.

## `POST /meetings/:id/attendees/:phone/lead`

Captures an attendee as **your lead** through the add-lead rules — the body is
exactly `POST /leads` (`LEADS-APP.md`): `phone` (must be the attendee's),
`name`, `village`, `crops` (≥ 1), `acreage` (> 0), `consent_version` (from
`GET /leads/consent`), and the optional fields. `found_via` is always set to
`meeting`.

- The attendee becomes `present: true`, `lead_captured: true`, with the lead's `pii_id`.
- Already your lead or customer → `400`, nothing changes (capture is for new farmers;
  show the Customer / Lead badge from `stage` instead of the capture button).
- Errors are the leads ones: `FARMER_TAKEN`, `NOT_A_FARMER`, `CONSENT_OUTDATED`,
  `SELF_LEAD`, `PARTNER_NUMBER`, `INVALID_PHONE`, …
- `:phone` not on the meeting's list → `404`; body `phone` ≠ `:phone` → `400`.
- If the meeting is cancelled at that moment, the lead still stands; `meeting`
  comes back as it is.

## Shapes

`Meeting` (lists):

```json
{
  "id": "6f1c2b0e-9a4d-4c1e-8b7a-2d5e3f4a1b9c",
  "type": "crop_demo",
  "title": "Crop demo · Rampur",
  "starts_at": "2026-10-20T04:30:00.000Z",
  "village": "Rampur",
  "venue": "Panchayat bhawan",
  "pincode": "462026",
  "organiser": "self",
  "agenda": null,
  "status": "scheduled",
  "counts": { "invited": 12, "present": 0, "leads": 0 },
  "completed_at": null,
  "cancelled_at": null,
  "cancel_note": null,
  "created_at": "…",
  "updated_at": "…"
}
```

`MeetingDetail` = `Meeting` + `attendees[]`:

```json
{ "phone": "9876543210", "name": "Ramesh Patel", "village": "Rampur",
  "pii_id": "PII-1620070", "invited": true, "present": true, "walk_in": false,
  "lead_captured": false, "stage": "interested" }
```

- `stage` = the farmer's stage with you now; `null` = not your lead.
- `counts` always match the list. Show `starts_at` in IST.

## Errors

| Code | Status | When |
|---|---|---|
| `VALIDATION_FAILED` | 400 | Past `starts_at`, bad / repeated mobile, complete (or save a held meeting's list) with nobody present, mobile ≠ attendee, capture of someone already yours |
| `PARTNER_NOT_APPROVED` / `ACCOUNT_BLOCKED` | 403 | Schedule (and capture) before approval / when blocked |
| `NOT_FOUND` | 404 | Not your meeting, or the phone is not on its list |
| `MEETING_CLOSED` | 409 | Completed or cancelled (see *Status*) |
| `MEETING_EXISTS` | 409 | The `id` is another partner's — make a new UUID |
| `VERSION_CONFLICT` | 409 | The list was saved meanwhile — reload, send again |
| `TOO_MANY_REQUESTS` | 429 | More than 30 calls a minute to one write route |
| leads codes | 4xx / 503 | Capture only — see `LEADS-APP.md` |

## App changes

- **Send meetings to the API** — stop keeping them on the phone. Make the UUID when
  the partner taps Save and keep it, so a retry is the same meeting.
- Invite picker = `GET /meetings/invitees?village=<meeting village>`; send the
  chosen `pii_id`s in `invite`.
- Attendance screen: after each change, `PUT …/attendees` with the whole list.
- **Capture dialog** must collect the consent tick (`GET /leads/consent` text,
  `consent_version`), the crop (`crops`) and `acreage`, as Add lead does.
- **WhatsApp share stays manual** (the app's share sheet). The server sends no
  message yet: once the TL's WhatsApp API is connected, invites go automatically,
  and only to the invited farmers.
- No delete button — **Cancel** (with an optional note).
