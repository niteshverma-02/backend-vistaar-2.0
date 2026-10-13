# Testimonials — HO portal contract

Vistaar's product testimonials: video, photo or audio stories on a product
(`bulk`) or a combo (`family`). They are stored in Stockship v3's shared
`product_testimonials` collection with **`source: "vistaar"`**.

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
| `media.media_url` | An `https` link, at most 2000 characters. This API does not upload files |
| `user.contact` | An Indian mobile number in any common form. It is stored as `+91XXXXXXXXXX` |
| `user.name` | Optional, at most 80 characters |
| `review` | Optional, at most 2000 characters |
| `verified` | Optional. `true` approves it at once |

`created_by` / `updated_by` record the HO email.

## `AdminTestimonial`

```json
{
  "_id": "665a2c3d4e5f6789abcdef12", "type": "product", "bulk": "NEEM-BULK-001", "family": null,
  "media": { "media_type": "video", "media_url": "https://…" }, "review": "…",
  "user": { "contact": "+919155061725", "name": "Ramu Kaka", "profile_image": null },
  "pii_id": null, "verified": false, "deleted": false, "status": "pending",
  "likes": 2, "dislikes": 1, "created_by": "ho@…", "updated_by": "ho@…",
  "created_at": "…", "updated_at": "…"
}
```

## Errors (`error.code`)

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_FAILED` | A bad field, both or neither of `bulk` / `family`, a phone that is not a mobile, an empty `PATCH`, or a bad id |
| 400 | `PRODUCT_NOT_FOUND` | The `bulk` or `family` is not in the catalogue |
| 404 | `NOT_FOUND` | No Vistaar testimonial with that id. Another app's row also answers this |
| 403 | `NO_ADMIN_ACCESS` / `ROLE_NOT_ALLOWED` | The caller has no Vistaar role, or the role lacks the capability |
