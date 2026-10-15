# Meetings — HO portal contract

The farmer meetings partners hold (PRD C5): who called whom, who came, how many
leads. **Read-only on purpose** — a meeting and its attendance are the partner's
record, written only in the Vistaar app. Capability `leads.read`.

A new HO page, **Farmer meetings**, next to the old `/vistaar/meetings` page (the
old page stays as it is).

| Method | Path | Returns |
|---|---|---|
| `GET` | `/api/v2/admin/meetings?agent_id=&status=&from=&to=&page=&limit=` | `PageResult<AdminMeeting>` — newest `starts_at` first |
| `GET` | `/api/v2/admin/meetings/summary?agent_id=&from=&to=` | `MeetingSummary` |
| `GET` | `/api/v2/admin/meetings/:id` | `AdminMeetingDetail` |

| Param | Rule |
|---|---|
| `agent_id` | `VST-…` (any case) |
| `status` | `scheduled`, `completed`, `cancelled` |
| `from`, `to` | IST days `YYYY-MM-DD`, both included, on `starts_at`. Summary default: the 1st of this month → today; `from` after `to` is `400` (list and summary) |
| `limit` | Default 50, clamped to 200 |

`AdminMeeting`:

```json
{
  "id": "6f1c2b0e-9a4d-4c1e-8b7a-2d5e3f4a1b9c",
  "agent_id": "VST-000006",
  "partner_name": "Ravi Kumar",
  "type": "crop_demo",
  "title": "Crop demo · Rampur",
  "starts_at": "2026-10-20T04:30:00.000Z",
  "village": "Rampur",
  "venue": "Panchayat bhawan",
  "pincode": "462026",
  "organiser": "self",
  "agenda": null,
  "status": "completed",
  "counts": { "invited": 12, "present": 9, "leads": 3 },
  "completed_at": "…",
  "cancelled_at": null,
  "cancel_note": null,
  "created_at": "…",
  "updated_at": "…"
}
```

- `type`: `farmer_meeting`, `crop_demo`, `field_day`, `disease_camp`, `soil_health_camp`.
- `organiser`: `self` (the partner) or `officer` (their reporting officer).
- `partner_name`: the partner's profile name (else the onboarding preview name), or `null`.

`AdminMeetingDetail` = `AdminMeeting` + `attendees[]`:

```json
{ "phone": "9876543210", "name": "Ramesh Patel", "village": "Rampur",
  "pii_id": "PII-1620070", "invited": true, "present": true, "walk_in": false,
  "lead_captured": true, "stage": "prospect" }
```

`stage` = the farmer's stage with that partner now; `null` = not their lead.

`MeetingSummary` (the cards):

```json
{
  "meetings": 24,
  "by_status": { "scheduled": 6, "completed": 15, "cancelled": 3 },
  "partners": 9,
  "invited": 210,
  "present": 168,
  "leads": 31,
  "from": "2026-10-01",
  "to": "2026-10-15"
}
```

`partners` = partners with a meeting in the window; `invited` / `present` /
`leads` add up every meeting's `counts`.

| Code | Status | When |
|---|---|---|
| `VALIDATION_FAILED` | 400 | Bad `agent_id` / date; `from` after `to` |
| `NO_ADMIN_ACCESS` / `ROLE_NOT_ALLOWED` | 403 | No Vistaar access / no `leads.read` |
| `NOT_FOUND` | 404 | No such meeting |
