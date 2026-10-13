# Attendance — HO portal contract

Head office reads partners' punch-ins and punch-outs. Nobody punches for a partner: the only writes are the app's (`docs/ATTENDANCE-APP.md`). Every day is an **IST** day (`YYYY-MM-DD`).

Capability: `attendance.read` (head roles: USR-1037, USR-1000, USR-1001). Others get `403 NO_ADMIN_ACCESS` / `ROLE_NOT_ALLOWED`.

## Routes (`/api/v2/admin/attendance`)

| Method | Path | Returns |
|---|---|---|
| `GET` | `/admin/attendance?date=YYYY-MM-DD` | `AttendanceBoard` — default today |
| `GET` | `/admin/attendance/range?from=YYYY-MM-DD&to=YYYY-MM-DD` | `AttendanceRange` — every partner over up to 366 days (week, month, 90 days, year, custom) |
| `GET` | `/admin/attendance/partners/:agentId?month=YYYY-MM` | the app's month view + `partner` — default this month |

## `AttendanceBoard`

```jsonc
{
  "date": "2026-10-12",
  "today": "2026-10-12",            // IST today: the day is still running when date == today
  "summary": {
    "partners": 42,                  // approved partners, plus anyone who punched that day
    "on_duty": 18, "day_closed": 9, "missed_punch_out": 0, "not_started": 15,
    "worked_ms": 97200000,           // closed sessions only
    "avg_worked_ms": 3600000         // over partners who punched in
  },
  "rows": [{
    "agent_id": "VST-000123", "name": "Asha Devi", "phone": "9826000000",
    "cohort": "vistaar_agent", "district": "Raisen", "state": "Madhya Pradesh",
    "status": "on_duty",             // not_started | on_duty | day_closed | missed_punch_out
    "punched_in": true,
    "first_in_at": "…", "session_in_at": "…", "last_out_at": null,
    "worked_ms": 0,                  // live time on duty = worked_ms + (now − session_in_at)
    "location": "Rampur, Lucknow",   // where the last session started
    "sessions": [ /* the app's PunchSession shape */ ]
  }],
  "trend": [{ "date": "2026-09-29", "present": 31, "worked_ms": 0 }]   // 14 days ending on date
}
```

- A past day left open is `missed_punch_out`; its open session is not counted in `worked_ms`.
- A partner blocked after punching still appears for that day, with `name: null`.


## `AttendanceRange` (`/admin/attendance/range`)

Both ends included, at most 366 days (`VALIDATION_FAILED` otherwise). Late = first punch-in after 10:00 am IST (`late_after_min: 600`); a full day = a closed day of 6 h or more.

```jsonc
{
  "from": "2026-10-01", "to": "2026-10-13", "today": "2026-10-13", "days": 13, "late_after_min": 600,
  "summary": { "partners": 42, "present_days": 380, "avg_present": 29.2, "late_days": 41, "missed_days": 6,
               "full_days": 210, "worked_ms": 0, "avg_worked_ms": 0, "every_day": 12, "never": 3 },
  "rows": [{
    "agent_id": "VST-000123", "name": "Asha Devi", "phone": "…", "cohort": "…", "district": "…", "state": "…",
    "present_days": 11, "closed_days": 10, "missed_days": 1, "late_days": 2, "full_days": 8,
    "no_gps_days": 0, "break_days": 3, "worked_ms": 0, "avg_worked_ms": 0,
    "avg_in_min": 572, "avg_out_min": 1050,          // IST minutes past midnight; null with no day
    "first_date": "2026-10-01", "last_date": "2026-10-13",
    "marks": "CCC.CCMCC.CCO",                        // per day: . none · C closed · O on duty (today) · M left open
    "minutes": [360, 410, 0]                         // worked minutes per day (closed days only)
  }],
  "trend": [{ "date": "2026-10-01", "present": 31, "late": 4, "worked_ms": 0 }]   // every day of the range
}
```

Reads every stored day in the range with only the fields above (never coordinates), once.
