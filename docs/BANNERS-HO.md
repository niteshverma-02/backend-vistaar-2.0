# Banners — HO portal contract

Banners appear in the app's Home carousel (PRD H3) and can be targeted by
cohort (PRD AD10). These routes need the company SSO token. Gate screens and
buttons on these capabilities from `GET /admin/me`:

| Capability | Allows |
|---|---|
| `content.read` | List and view banners, including scheduled, ended and switched-off ones |
| `content.write` | Upload art; add, edit, schedule, target, reorder, switch off and delete banners |

Today both capabilities go to the head roles (see `ONBOARDING-HO.md`).

## Two kinds of banner

HO picks the kind on the form:

| Kind | HO fills in | The app shows |
|---|---|---|
| **Image banner** (own art) | Upload the image, then `title` (its name and screen-reader label) and `link` | The image, edge to edge |
| **Text banner** (made in the portal) | `title`, `subtitle`, `cta` (button text), `tone` (colour), `emoji`, `link` | The app draws it: a gradient card with the texts, the button and the emoji |

Setting `image` makes a banner an image banner. Setting it back to `null`
turns it into a text banner, which then needs `subtitle` and `cta`.

## Image upload

`POST /api/v2/admin/banners/image` (`content.write`) takes `multipart/form-data`
with the field `file`.

| Rule | Value |
|---|---|
| Type | JPG, PNG or WEBP. This is read from the file itself, so a renamed PDF is refused |
| Size | Up to **2 MB** |
| Shape | Exactly **2.4:1** (a pixel of rounding is fine), at least **600 × 250 px**. Design at **1200 × 500 px** |

Response:

```json
{
  "path": "vistaar/banners/9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d.jpg",
  "url": "https://firebasestorage.googleapis.com/v0/b/…?alt=media&token=…",
  "content_type": "image/jpeg",
  "size": 182344,
  "width": 1200,
  "height": 500
}
```

**Crop before upload.** The portal opens a crop box locked to 2.4:1 when HO
picks a file of any shape: HO drags and zooms to choose the area, and the
browser uploads only that area, re-drawn at 1200 × 500 px (smaller only when
the chosen area is smaller). So the shape rule above is always met.

1. Show `url` as the preview.
2. Send `path` as `image` in `POST /admin/banners` or `PATCH /admin/banners/:id`.

The image is saved first and the banner afterwards. An upload that never gets
saved on a banner just stays unused. When a banner's image is replaced, or the
banner is deleted, the old file is removed once no other banner uses it.

## Routes (`/api/v2/admin/banners`)

| Method | Path | Capability | Body | Returns |
|---|---|---|---|---|
| `POST` | `/admin/banners/image` | `content.write` | multipart `file` | Upload result (above) |
| `GET` | `/admin/banners?status=&cohort=&page=&limit=&sort=` | `content.read` | — | `PageResult<AdminBanner>` |
| `GET` | `/admin/banners/:id` | `content.read` | — | `AdminBanner` |
| `POST` | `/admin/banners` | `content.write` | `CreateBanner` | `AdminBanner` |
| `PATCH` | `/admin/banners/:id` | `content.write` | Any subset of `CreateBanner` | `AdminBanner` |
| `PUT` | `/admin/banners/order` | `content.write` | `{ "ids": [...] }` | `{ "ids": [...] }` |
| `DELETE` | `/admin/banners/:id` | `content.write` | — | `{ "deleted": true }` |

**List filters:**

- `status` is one of `live`, `scheduled`, `expired`, `inactive`.
- `cohort` (a cohort key) returns the banners that cohort sees: its own banners plus the ones meant for every partner.
- `sort` is one of `order`, `created_at`, `updated_at`, `starts_at`, `ends_at`, with a leading `-` for descending. The default is `-created_at`.

**Reorder:** `PUT /admin/banners/order` takes **every** banner id, first slide first, and sets each `order` to its index (0, 1, 2, …) in one write. A list that misses a banner or names one that no longer exists gets `409 BANNERS_CHANGED`: someone added or deleted a banner meanwhile, so re-read and drag again. `PATCH … { order }` still sets one banner's number.

`:id` is the banner's UUID. An id that isn't a UUID gets `400`.

## `CreateBanner`

Text banner:

```json
{
  "title": { "en": "Kisan Mela · Barabanki", "hi": "किसान मेला · बाराबंकी" },
  "subtitle": { "en": "12 Oct · bring 10 farmers, get a stall" },
  "cta": { "en": "Register" },
  "link": "/events",
  "tone": "warning",
  "emoji": "🎪",
  "cohorts": ["vistaar_agent", "ex_employee"],
  "starts_at": "2026-10-05T00:00:00+05:30",
  "ends_at": "2026-10-12T18:00:00+05:30",
  "order": 1
}
```

Image banner:

```json
{
  "title": { "en": "Diwali offer" },
  "image": "vistaar/banners/9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d.jpg",
  "link": "/products",
  "cohorts": [],
  "ends_at": "2026-11-05T23:59:59+05:30"
}
```

| Field | Required | Rule |
|---|---|---|
| `title` | yes | A language map with a non-empty `en` |
| `subtitle`, `cta` | text banner only | Language maps with a non-empty `en`. Optional on an image banner |
| `image` | image banner only | The `path` from the upload. `null` means a text banner |
| `link` | yes | An in-app route starting with `/`, at most 300 characters. The app has no web view, so web URLs are refused |
| `tone` | no | `primary` (default), `warning`, `success` or `info`. Only used by text banners |
| `emoji` | no | At most 16 characters. `null` shows no emoji. Only used by text banners |
| `cohorts` | no | Cohort keys from `GET /admin/cohorts`; switched-off cohorts are allowed. `[]` (the default) means every partner |
| `starts_at`, `ends_at` | no | ISO dates. `null` means "now" and "never ends". `ends_at` must be after `starts_at` |
| `order` | no | Lower numbers show first; the default is `0`. Banners with the same `order` show newest first |
| `is_active` | no | Defaults to `true`. `false` hides the banner without deleting it |

**Editing:**

- `PATCH` changes only the fields you send. Sending `null` clears `subtitle`, `cta`, `image`, `emoji`, `starts_at` or `ends_at`.
- Every rule is checked against the banner as it will be after the change. For example, sending only `ends_at` is checked against the stored `starts_at`.

## `AdminBanner`

The stored banner plus a computed `status`:

```json
{
  "_id": "2b1f3c4d-…", "title": {…}, "subtitle": null, "cta": null,
  "image_path": "vistaar/banners/….jpg", "image_url": "https://…",
  "image_width": 1200, "image_height": 500,
  "link": "/products", "tone": "primary", "emoji": null,
  "cohorts": [], "starts_at": null, "ends_at": "…",
  "order": 0, "is_active": true,
  "created_by": "ho@katyayaniorganics.com", "updated_by": "…",
  "created_at": "…", "updated_at": "…",
  "status": "live"
}
```

**What the app shows:**

- At most **10** live banners per partner, sorted by `order` and then newest first.
- Changes reach the app within **a minute**.

## Errors (`error.code`)

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_FAILED` | Any of: a bad field, a missing `*.en`, a text banner without `subtitle` or `cta`, a web URL as `link`, `ends_at` not after `starts_at`, or an id that isn't a UUID |
| 400 | `COHORT_NOT_FOUND` | A key in `cohorts` is not a cohort |
| 400 | `FILE_REQUIRED` | The upload is not multipart, or has no `file` |
| 400 | `FILE_TYPE_NOT_ALLOWED` | The upload is not a JPG, PNG or WEBP |
| 400 | `IMAGE_SIZE_NOT_ALLOWED` | The image is under 600 px wide, or not 2.4:1. `details[0]` gives the size to use |
| 400 | `IMAGE_NOT_FOUND` | `image` is not a path an upload returned |
| 413 | `FILE_TOO_LARGE` | The image is over 2 MB |
| 503 | `UPLOADS_NOT_CONFIGURED` | Storage isn't set up on this server |
| 404 | `NOT_FOUND` | No banner with that id |
| 409 | `BANNERS_CHANGED` | A reorder's `ids` are not exactly the banners stored now |
| 403 | `NO_ADMIN_ACCESS` / `ROLE_NOT_ALLOWED` | The caller has no HO role, or the role lacks the capability |
