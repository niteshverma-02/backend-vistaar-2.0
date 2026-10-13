# Attendance — mobile app contract

Punch in / out on Home and the Attendance screen (PRD H2, N2). This replaces
the in-memory `AttendanceRepositoryImpl` state and the seed history in
`lib/features/attendance/data/seed/attendance_seed.dart`.

Every route takes `Authorization: Bearer <Vistaar access token>`. The partner
comes from the token, never from the body.

## Routes

| Method | Path | Body / query | Returns |
|---|---|---|---|
| `GET` | `/api/v2/attendance/today` | — | `AttendanceDay` |
| `POST` | `/api/v2/attendance/punch-in` | `Punch` | `AttendanceDay` (today) |
| `POST` | `/api/v2/attendance/punch-out` | `Punch` | `AttendanceDay` (today) |
| `GET` | `/api/v2/attendance?month=2026-10` | `month` optional, `YYYY-MM`, defaults to the current month | `AttendanceMonth` |

## Rules the server applies

- **Server time only.** `in_at` and `out_at` come from the server clock. The phone sends no time, so a wrong phone clock cannot move a punch.
- **IST days.** A day runs from IST midnight to IST midnight, whatever the phone's timezone is.
- **Several sessions a day.** After a punch-out, punch in again ("Punch in again"). There are at most **10** sessions a day.
- **Punch-out can be anywhere.** Its location is stored on its own and is never compared with the punch-in location.
- **Only today's session can be punched out.** A session left open on an earlier day stays `missed_punch_out`, and its time is not counted. The partner simply punches in again today.
- Punch routes allow 10 calls a minute per partner.

## `Punch` (body of punch-in and punch-out)

GPS fix:

```json
{ "source": "gps", "lat": 26.8467, "lng": 80.9462, "accuracy_m": 12, "label": "Rampur, Lucknow" }
```

GPS unavailable (today's `fallbackPunchLocation`):

```json
{ "source": "registered", "label": "Rampur, Lucknow (approx.)" }
```

| Field | Rule |
|---|---|
| `source` | `gps` or `registered` |
| `lat`, `lng` | Required for `gps` and must be inside India (`0,0` is refused). Must be absent or `null` for `registered` |
| `accuracy_m` | Optional, in metres |
| `label` | Required, up to 200 characters. Shown on the cards |

## `AttendanceDay`

```json
{
  "date": "2026-10-12",
  "status": "on_duty",
  "punched_in": true,
  "first_in_at": "2026-10-12T03:42:10.000Z",
  "session_in_at": "2026-10-12T08:05:00.000Z",
  "last_out_at": null,
  "worked_ms": 14400000,
  "location": "Rampur, Lucknow",
  "sessions": [
    {
      "in_at": "2026-10-12T03:42:10.000Z",
      "in_location": { "lat": 26.8467, "lng": 80.9462, "accuracy_m": 12, "label": "Rampur, Lucknow", "source": "gps" },
      "out_at": "2026-10-12T07:42:10.000Z",
      "out_location": { "lat": null, "lng": null, "accuracy_m": null, "label": "Malihabad, Lucknow (approx.)", "source": "registered" }
    },
    {
      "in_at": "2026-10-12T08:05:00.000Z",
      "in_location": { "lat": 26.85, "lng": 80.95, "accuracy_m": 20, "label": "Rampur, Lucknow", "source": "gps" },
      "out_at": null,
      "out_location": null
    }
  ]
}
```

`status`:

| Value | Meaning | Card shows |
|---|---|---|
| `not_started` | No punch today | "Not started" |
| `on_duty` | Today, a session is open | "On duty" + live timer |
| `day_closed` | Every session is punched out | "Day closed" |
| `missed_punch_out` | Earlier day left open (history only) | "No punch-out" |

### Mapping to the app's `Attendance` entity

| App | API |
|---|---|
| `punchedIn` | `punched_in` |
| `punchInAt` | `first_in_at` |
| `sessionInAt` | `session_in_at` |
| `punchOutAt` | `last_out_at` |
| `priorMs` | on duty: `worked_ms`; closed: `worked_ms − (last_out_at − session_in_at)` |
| `location` | `location` |

Timer:

- **On duty:** `worked_ms + (now − session_in_at)`.
- **Closed:** `worked_ms` is the whole day.

To correct for a wrong phone clock, take `now` from the response's HTTP `Date` header.

## `AttendanceMonth`

```json
{
  "month": "2026-10",
  "days": [ AttendanceDay, … ],
  "summary": { "present_days": 18, "closed_days": 17, "worked_ms": 550800000, "avg_worked_ms": 32400000 }
}
```

- `days` lists only days with a punch, newest first (at most 31). Days with no row are "No record" on the 14-day strip; Sundays are the app's own rule.
- `summary` counts hours over **closed** days only, as `MonthSummary.of` does today.
- `AttendanceRecord` maps as: `punchIn` = `first_in_at`, `punchOut` = `last_out_at`, `workedHours` = `worked_ms / 3600000`, `location` / `lat` / `lng` = `sessions[0].in_location`.
- `visits` is **not** here. It comes from lead activities, and the leads API is not built yet.
- The 14-day strip can cross a month boundary, so for it, fetch this month and the previous one.

## Errors

| HTTP | `error.code` | When | App should |
|---|---|---|---|
| 400 | `VALIDATION_FAILED` | Bad location (no lat/lng for `gps`, outside India, blank label) | Show `details[0]` |
| 409 | `ALREADY_PUNCHED_IN` | Punch-in while on duty | Refresh `today` |
| 409 | `NOT_PUNCHED_IN` | Punch-out with no open session today | Refresh `today` |
| 409 | `PUNCH_LIMIT_REACHED` | 11th punch-in of the day | Show the message |
| 409 | `ATTENDANCE_CHANGED` | Another device punched at the same moment | Refresh `today` |
| 429 | `TOO_MANY_REQUESTS` | More than 10 punches a minute | Wait |

## Not built yet

- Auto-close of a forgotten punch-out
- Absent days
- Regularisation requests
- HO attendance screens
- Farm-visit counts
