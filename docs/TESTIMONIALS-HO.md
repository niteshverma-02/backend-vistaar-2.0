# Testimonials — HO portal contract

Two desks:

1. **Partner testimonials** (`/admin/testimonial-submissions`) — what partners send from the
   app: a farmer's video, photo or quote with a star rating and the farmer's consent. HO
   approves, rejects, removes, or records a consent withdrawal.
2. **Vistaar testimonials** (`/admin/testimonials`) — every `source: "vistaar"` row in
   Stockship's `product_testimonials`, including ones HO files directly from a media link.

Both use the capabilities `testimonials.read` / `testimonials.write` (head roles today).

## 1. Partner testimonials (`/api/v2/admin/testimonial-submissions`)

A partner's testimonial is a hidden `product_reviews` row (`source: "vistaar"`,
`verified: false`, no stars) until HO approves — no product page shows it. **Approve** makes
it shown (`verified: true`, the stars on `rating`, `verified_by` = your email) and, for a
video / photo, writes the media to `product_testimonials`, gives the file a lasting link, and
puts it in the app's Library. **Reject** and **Remove** put it in Stockship's deleted tray
(`deleted: true`); remove also hides the media row and kills the link; **approve** again
brings it back. Decide partner testimonials here, not on Stockship's own desk.

| Method | Path | Capability | Body | Returns |
|---|---|---|---|---|
| `GET` | `/admin/testimonial-submissions?status=&kind=&agent_id=&q=&page=&limit=&sort=` | read | — | `PageResult<Submission>` |
| `GET` | `/admin/testimonial-submissions/summary` | read | — | `{ submitted, approved, rejected, removed }` |
| `GET` | `/admin/testimonial-submissions/:id` | read | — | `Submission` |
| `POST` | `/admin/testimonial-submissions/:id/approve` | write | — | `Submission` |
| `POST` | `/admin/testimonial-submissions/:id/reject` | write | `{ "reason": "…" }` (required, ≤ 300, shown to the partner) | `Submission` |
| `POST` | `/admin/testimonial-submissions/:id/remove` | write | `{ "reason"?: "…" }` | `Submission` |
| `POST` | `/admin/testimonial-submissions/:id/withdraw-consent` | write | `{ "reason": "Farmer called on …" }` (required) | `Submission` |

- `status`: `submitted`, `approved`, `rejected`, `removed`. `kind`: `video`, `photo`, `text`.
- `q` searches farmer, phone, partner name / id, village, product and crop. `sort`:
  `created_at`, `updated_at` (with `-` for newest first, the default `-created_at`) or `-shares`.
- `:id` is the submission's UUID.

| Action | Allowed from |
|---|---|
| approve | `submitted`, `rejected`, `removed` (never after a consent withdrawal) |
| reject | `submitted` |
| remove | `approved` |
| withdraw-consent | any, once (a retry after a failure finishes it) |

**Consent withdrawal** (the farmer asked to take it down): the consent is marked
`withdrawn` with your reason and **kept**; the `product_testimonials` row and the file are
deleted, the farmer's words are wiped off the review row (`text` becomes `""`), the
submission becomes `removed`, and it can never be approved again. If
another desk user approves at the same moment, the approval sees the withdrawal and
deletes what it showed (`409 CONSENT_WITHDRAWN`). If a step fails (network), send
the withdrawal again: it finishes the erase instead of answering 409.

### `Submission`

```json
{
  "id": "0b6e7c1e-…", "status": "submitted", "reason": null, "kind": "video",
  "agent_id": "VST-000123", "partner_name": "Asha Devi",
  "farmer": { "pii_id": "PII-1618191", "name": "Ramu Kaka", "village": "Rampur",
              "contact": "+919155061725", "district": "Indore", "state": "Madhya Pradesh" },
  "product": { "bulk": "BK-48", "family": null, "name": "HUMIC+FULVIC" },
  "crop": "Wheat", "text": "Yield went up…", "rating": 5,
  "media": { "media_type": "video", "url": "https://… (signed 1 h until approved)", "duration_sec": 42 },
  "views": 0, "shares": 0, "coins_awarded": null, "gig_id": null,
  "consent": { "version": 1, "lang": "hi", "text": "किसान ने…", "given_at": "…",
               "status": "given", "withdrawn_at": null, "withdrawn_by": null, "withdrawn_reason": null },
  "review_id": "6a7e…", "testimonial_id": "6a82…",
  "decided_by": null, "decided_at": null, "created_at": "…", "updated_at": "…"
}
```

`consent.text` is the exact wording the farmer was shown. Edit the wording itself with
`PUT /admin/settings { "testimonial_consent_text": { "en": "…", "hi": "…" } }` — a change is a
new version, and the app must show it again before the next submission.

### Errors

| Status | Code | When |
|---|---|---|
| 404 | `NOT_FOUND` | No such submission |
| 409 | `TESTIMONIAL_NOT_ALLOWED` | Its status does not allow that action, or someone changed it meanwhile — reload |
| 409 | `CONSENT_WITHDRAWN` | Approving after a withdrawal, or withdrawing twice |
| 400 | `VALIDATION_FAILED` | A missing reason, or an `:id` that is not a UUID |

## 2. Vistaar testimonials (`/api/v2/admin/testimonials`)

Vistaar's product testimonials: video, photo or audio stories on a product
(`bulk`) or a combo (`family`). They are stored in Stockship v3's shared
`product_testimonials` collection with **`source: "vistaar"`**. A row a partner sent
(`from_partner: true`) is read-only here — `PATCH` / `DELETE` answer
`409 TESTIMONIAL_FROM_PARTNER`; decide it on the partner desk above.

**Only Vistaar can change them.** Every route here reads and writes
`source: "vistaar"` rows only. A row from another app answers `404`. On
Stockship, `POST /products/testimonials` refuses `source: "vistaar"` (`400`) and
`PUT /products/testimonials` refuses a Vistaar row (`403`). Stockship can still
list them, so product pages can show the approved ones, and app users can still
like or dislike them.

Gate screens and buttons on these capabilities from `GET /admin/me`:

| Capability | Allows |
|---|---|
| `testimonials.read` | List, count and view Vistaar testimonials, removed ones included |
| `testimonials.write` | Add, approve / unapprove, remove / restore, correct, delete |

Both go to the head roles today.

## Trays (`status`)

| Status | Stored as | Meaning |
|---|---|---|
| `pending` | `deleted != true`, `verified != true` | Sent in, not shown on the product page |
| `approved` | `deleted != true`, `verified: true` | Shown on the product page |
| `removed` | `deleted: true` | Hidden everywhere. Set `deleted: false` to restore it |

## Routes (`/api/v2/admin/testimonials`)

| Method | Path | Capability | Body | Returns |
|---|---|---|---|---|
| `GET` | `/admin/testimonials?status=&type=&media_type=&q=&page=&limit=&sort=` | `testimonials.read` | — | `PageResult<AdminTestimonial>` |
| `GET` | `/admin/testimonials/summary` | `testimonials.read` | — | `{ pending, approved, removed }` |
| `GET` | `/admin/testimonials/:id` | `testimonials.read` | — | `AdminTestimonial` |
| `POST` | `/admin/testimonials` | `testimonials.write` | `CreateTestimonial` | `AdminTestimonial` |
| `POST` | `/admin/testimonials/media` | `testimonials.write` | multipart `file`: photo (JPG/PNG/WEBP ≤ 10 MB), video (MP4/MOV/WEBM ≤ 60 MB) or voice note (MP3/M4A/AAC/OGG/WAV ≤ 20 MB) | `{ media_type, media_url, content_type, size }` — send `media_url` (lasting public link, `vistaar/testimonials/`) and `media_type` as `media` on create. Errors `FILE_REQUIRED`, `FILE_TYPE_NOT_ALLOWED`, `FILE_TOO_LARGE` (400/413) |
| `PATCH` | `/admin/testimonials/:id` | `testimonials.write` | Any of `verified`, `deleted`, `review`, `media`, `name` | `AdminTestimonial` |
| `DELETE` | `/admin/testimonials/:id` | `testimonials.write` | — | `{ "deleted": true }` |

**List parameters:**

- `type` is `product` or `combo`.
- `media_type` is `image`, `video` or `audio`.
- `q` searches the words, the name, the phone, `bulk` and `family`.
- `sort` is `created_at` or `updated_at`, with a leading `-` for descending. The default is `-created_at`.

`:id` is the 24-character Mongo id. Anything else gets `400`.

## `CreateTestimonial`

```json
{
  "bulk": "NEEM-BULK-001",
  "media": { "media_type": "video", "media_url": "https://…/story.mp4" },
  "review": "Great results on my crop!",
  "user": { "contact": "9155061725", "name": "Ramu Kaka" },
  "verified": false
}
```

| Field | Rule |
|---|---|
| `bulk` / `family` | Exactly one is required. It must exist in `bulk_v2.sku` or `combos_v2.family` |
| `media.media_type` | `image`, `video` or `audio` |
| `media.media_url` | An `https` link, at most 2000 characters — e.g. the `media_url` from `POST /admin/testimonials/media` |
| `user.contact` | An Indian mobile number in any common form. It is stored as `+91XXXXXXXXXX` |
| `user.name` | Optional, at most 80 characters |
| `review` | Optional, at most 2000 characters |
| `verified` | Optional. `true` approves it at once |

`verified_by` / `deleted_by` record the HO email that approved / removed it, as Stockship's own desk does.

## `AdminTestimonial`

```json
{
  "_id": "665a2c3d4e5f6789abcdef12", "type": "product", "bulk": "NEEM-BULK-001", "family": null,
  "media": { "media_type": "video", "media_url": "https://…" }, "review": "…",
  "user": { "contact": "+919155061725", "name": "Ramu Kaka", "profile_image": null },
  "pii_id": null, "verified": false, "deleted": false, "status": "pending",
  "likes": 2, "dislikes": 1, "from_partner": false, "verified_by": null, "deleted_by": null,
  "created_at": "…", "updated_at": "…"
}
```

## Errors (`error.code`)

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_FAILED` | A bad field, both or neither of `bulk` / `family`, a phone that is not a mobile, an empty `PATCH`, or a bad id |
| 400 | `PRODUCT_NOT_FOUND` | The `bulk` or `family` is not in the catalogue |
| 404 | `NOT_FOUND` | No Vistaar testimonial with that id. Another app's row also answers this |
| 409 | `TESTIMONIAL_FROM_PARTNER` | A partner's testimonial — use the partner desk |
| 403 | `NO_ADMIN_ACCESS` / `ROLE_NOT_ALLOWED` | The caller has no Vistaar role, or the role lacks the capability |
