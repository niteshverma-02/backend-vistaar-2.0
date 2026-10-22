# Feedback — HO portal contract

What partners send from the app's Feedback screen: NPS answers (with reasons, a comment
and app stars) and "Suggest a product". The desk reads the NPS, rings detractors back,
edits the reason chips and triages product suggestions.

Every route takes the company SSO token. Reads need `feedback.read`, changes
`feedback.write` (today: the head roles).

## Routes

| Method | Path | Capability | What |
|---|---|---|---|
| `GET` | `/api/v2/admin/feedback` | read | Answers, newest first (paged, filters below) |
| `GET` | `/api/v2/admin/feedback/summary?from&to` | read | NPS dashboard for IST days |
| `GET` | `/api/v2/admin/feedback/:id` | read | One answer |
| `PATCH` | `/api/v2/admin/feedback/:id/follow-up` | write | Close / reopen a detractor's call-back |
| `GET` | `/api/v2/admin/feedback/reasons` | read | The chips the app shows |
| `PUT` | `/api/v2/admin/feedback/reasons` | write | Replace them (app shows within a minute) |
| `GET` | `/api/v2/admin/product-suggestions` | read | Suggestions, newest first (paged) |
| `GET` | `/api/v2/admin/product-suggestions/summary` | read | Count per status |
| `GET` | `/api/v2/admin/product-suggestions/top?from&to&limit` | read | Most asked-for products |
| `GET` | `/api/v2/admin/product-suggestions/:ref` | read | One suggestion (`SUG-000123`) |
| `PATCH` | `/api/v2/admin/product-suggestions/:ref` | write | Status and / or HO note |

## Answers list — `GET /admin/feedback`

Query: `page`, `limit` (≤ 200), `sort` (`-created_at` default, `created_at`, `nps`, `-nps`,
`follow_up.due_at`, `-follow_up.due_at`), and optional:

| Param | Meaning |
|---|---|
| `bucket` | `detractor` / `passive` / `promoter` |
| `follow_up` | `open`, `done`, or `overdue` (open and past due) |
| `agent_id` | `VST-000123` |
| `from`, `to` | IST days, both included, at most 366 days apart; one alone is fine |
| `q` | Comment, reason, partner name, phone or ID |

"Call-backs to make" = `?follow_up=open&sort=follow_up.due_at`.

Item:

```json
{
  "id": "6710a1f0c2b54e0012ab34cd",
  "agent_id": "VST-000101",
  "partner": { "name": "Ramesh", "phone": "9876543210", "cohort": "farmer_leader", "district": "Lucknow", "state": "Uttar Pradesh", "owner_agent_id": "A0-2691" },
  "nps": 4,
  "bucket": "detractor",
  "reasons": ["Late delivery"],
  "comment": "Delivery takes a week",
  "rating": 2,
  "follow_up": {
    "status": "open", "due_at": "2026-10-14T18:29:59.999Z", "owner_agent_id": "A0-2691",
    "note": null, "done_by": null, "done_at": null, "overdue": false
  },
  "created_at": "2026-10-12T04:30:00.000Z"
}
```

`partner` is a copy taken when the partner answered. `follow_up` is `null` for scores 7–10.
The call-back is due at the end of the 2nd working day (Mon–Sat, IST) and belongs to the
partner's owner at that time.

## Summary — `GET /admin/feedback/summary?from=2026-10-01&to=2026-10-14`

```json
{
  "from": "2026-10-01", "to": "2026-10-14",
  "total": 8,
  "counts": { "detractor": 2, "passive": 0, "promoter": 6 },
  "nps": 50,
  "rating": { "count": 4, "average": 4.3, "stars": [0, 1, 0, 0, 3] },
  "reasons": {
    "detractor": [{ "reason": "Late delivery", "count": 2 }],
    "passive": [],
    "promoter": []
  },
  "follow_ups": { "open": 3, "overdue": 1 }
}
```

- `nps` = % promoters − % detractors (−100…100), `null` with no answers.
- `stars[0]` is 1 star … `stars[4]` is 5 stars.
- `reasons`: each group's top 20, most picked first.
- `follow_ups` counts **all** open call-backs, not only the range's.

## Close a call-back — `PATCH /admin/feedback/:id/follow-up`

```json
{ "status": "done", "note": "Called; delivery issue sent to logistics." }
```

`status: "open"` reopens it (clears `done_by` / `done_at`). `note` (≤ 500) **replaces** the
saved note every time; leave it out and the note is cleared, so send the current note back if
you want to keep it. A score of 7–10 has no call-back → `400 VALIDATION_FAILED`. Returns the answer.

## Reason chips — `GET` / `PUT /admin/feedback/reasons`

```json
{
  "detractor": { "question": "What went wrong?", "chips": ["Late delivery", "Price too high"] },
  "passive":   { "question": "What would make it a 10?", "chips": ["More products"] },
  "promoter":  { "question": "What do you like most?", "chips": ["Easy app"] }
}
```

`PUT` takes all three groups: question ≤ 120 characters, 1–12 chips each ≤ 60
(trimmed, repeats dropped). Past answers keep the text they were given with.

## Product suggestions — `GET /admin/product-suggestions`

Query: `page`, `limit`, `sort` (`-created_at` / `created_at`), optional `status`
(`new` / `reviewed` / `planned` / `declined`), `agent_id`, `from`, `to`, `q`
(reference, product, crop, note, partner name or phone).

```json
{
  "ref": "SUG-000123",
  "agent_id": "VST-000101",
  "partner": { "name": "Ramesh", "phone": "9876543210", "cohort": "farmer_leader", "district": "Lucknow", "state": "Uttar Pradesh", "owner_agent_id": "A0-2691" },
  "product": "Emamectin benzoate 5% SG",
  "crop": "Chilli",
  "monthly_demand": "50 packs",
  "note": "Farmers pay ₹450 for Missile",
  "status": "new",
  "ho_note": null,
  "updated_by": null,
  "created_at": "2026-10-12T04:30:00.000Z",
  "updated_at": "2026-10-12T04:30:00.000Z"
}
```

### `GET /admin/product-suggestions/top?from=2026-10-01&to=2026-10-14&limit=20`

The same ask typed differently ("Emamectin  Benzoate 5% sg") is grouped together.

```json
[
  { "product_key": "emamectin benzoate 5% sg", "product": "Emamectin benzoate 5% SG", "count": 7, "partners": 5, "crops": ["Chilli", "Cotton"], "last_at": "2026-10-13T09:10:00.000Z" }
]
```

### `PATCH /admin/product-suggestions/:ref`

```json
{ "status": "planned", "ho_note": "Sent to the product team for Q1." }
```

At least one field. Returns the suggestion.

## Errors

| Status | `error.code` | When |
|---|---|---|
| `400` | `VALIDATION_FAILED` | Bad filter, range over a year, empty change, no call-back to close, empty chip group |
| `403` | `NO_ADMIN_ACCESS` / `ROLE_NOT_ALLOWED` | Not a Vistaar HO role |
| `404` | `NOT_FOUND` | No such answer or suggestion |
