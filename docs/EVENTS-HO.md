# Events — HO portal contract

The farmer-event calendar partners register for and invite farmers to (My
Story's Meeting template). Capability `content.read` / `content.write`, like
banners. Partners see a change within a minute.

| Method | Path | Capability | Body | Returns |
|---|---|---|---|---|
| `GET` | `/api/v2/admin/events?status=&type=&cohort=&page=&limit=&sort=` | `content.read` | — | `PageResult<AdminEvent>` |
| `GET` | `/api/v2/admin/events/:id` | `content.read` | — | `AdminEvent` |
| `GET` | `/api/v2/admin/events/:id/registrations?page=&limit=` | `content.read` | — | `PageResult<{ agent_id, name, phone, cohort, district, registered_at }>` |
| `POST` | `/api/v2/admin/events` | `content.write` | `CreateEvent` | `AdminEvent` |
| `PATCH` | `/api/v2/admin/events/:id` | `content.write` | any `CreateEvent` field | `AdminEvent` |
| `DELETE` | `/api/v2/admin/events/:id` | `content.write` | — | `{ "deleted": true }` |

```json
{
  "title": "Kisan Mela · Barabanki",
  "type": "kisan_mela",
  "starts_at": "2026-10-25T10:00:00+05:30",
  "location": "Mandi Samiti ground, Barabanki",
  "note": "Free soil testing and product demo",
  "seats": 40,
  "cohorts": [],
  "is_active": true
}
```

| Field | Rule |
|---|---|
| `title` | ≤ 120 |
| `type` | `kisan_mela`, `training`, `webinar`, `field_day` |
| `starts_at` | ISO date-time; registration closes at this moment |
| `location` | ≤ 200 |
| `note` | Optional, ≤ 300 — printed on a story invite |
| `seats` | 1–100000; never below `registered_count` (`400`, or `409 EVENT_SEATS_TAKEN` if partners registered meanwhile) |
| `cohorts` | Cohort keys; empty = every partner |

`status` (computed): `upcoming`, `past`, `inactive`. `AdminEvent` is the stored
row plus `status`, including `registered_count`. **Delete** removes every seat
with it; to keep partners' history, switch it off (`is_active: false`).

`seed-story-content.js --apply` added the app's 3 sample events on beta
(2026-10-12), with the seed's own dates.
