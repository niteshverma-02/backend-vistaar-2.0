# Events — mobile app contract

HO-run farmer events (Kisan Mela, training, webinar, field day). Replaces the
seed `events` in `content_seed.dart` for the Events screen (`/events`) and My
Story's **Meeting invite** template (which also gets them inside
`GET /stories/content` → `meetings`).

Every route takes `Authorization: Bearer <Vistaar access token>`. The list is
cut for the caller's cohort: an event targeted at other cohorts answers `404`.

| Method | Path | Returns |
|---|---|---|
| `GET` | `/api/v2/events` | `Event[]` — upcoming, soonest first |
| `GET` | `/api/v2/events/past?page=&limit=` | `PageResult<Event>` — newest first |
| `GET` | `/api/v2/events/:id` | `Event` |
| `POST` | `/api/v2/events/:id/register` | `Event` — takes a seat; again is a no-op |
| `DELETE` | `/api/v2/events/:id/register` | `Event` — gives it back; only before it starts |

```json
{
  "id": "2b1f3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  "title": "Humic Acid Field Day",
  "type": "field_day",
  "starts_at": "2026-10-18T03:30:00.000Z",
  "location": "Ramesh Yadav farm, Rampur",
  "note": null,
  "seats": 25,
  "registered_count": 7,
  "seats_left": 18,
  "status": "upcoming",
  "registered": false
}
```

- `type`: `kisan_mela`, `training`, `webinar`, `field_day` (the app's `EventType` wire values).
- `starts_at` replaces the seed's `date`; show it in IST.
- `registered` replaces the seed's `registered` and is the caller's own seat.
- Seat counts in the list can lag up to a minute; the register answer is exact.

| Code | Status | When |
|---|---|---|
| `EVENT_FULL` | 409 | No seat left |
| `EVENT_CLOSED` | 409 | Started, or switched off by HO |
| `NOT_FOUND` | 404 | No such event for your cohort |
| `TOO_MANY_REQUESTS` | 429 | More than 20 register calls a minute |
