# Testimonials — app contract

The Sahayak **Testimonials** screens (`/testimonials`, `/testimonials/new`): a partner
records a farmer's video, photo or quote with the farmer's consent, HO approves it, and
approved ones appear in the **Library** for every partner (and on Katyayani's product
pages). Replaces the local seed `testimonialLibrary` and `SahayakStore.testimonials`.

All routes need the partner token; nothing in a body says who the partner is. Responses are
the usual envelope `{ "success": true, "data": … }`; lists are `PageResult`
(`{ items, page, limit, total, has_more }`).

| Method | Path | Does |
|---|---|---|
| `GET` | `/testimonials/consent` | The consent wording (`en`, `hi`) and its `version` |
| `POST` | `/testimonials/uploads` | A signed URL to PUT the video / photo to |
| `POST` | `/testimonials` | Send one to HO for approval |
| `GET` | `/testimonials/mine?status=&page=&limit=` | My submissions, newest first |
| `GET` | `/testimonials/mine/:id` | One of mine |
| `GET` | `/testimonials/library?q=&bulk=&family=&crop=&kind=&state=&district=&sort=&page=&limit=` | Approved stories from every partner |
| `POST` | `/testimonials/:id/view` | Count a play / open (library) |
| `POST` | `/testimonials/:id/share` | Count a WhatsApp share (library) |

## Sending one — the flow

1. **Consent.** `GET /testimonials/consent` →
   `{ "version": 1, "text": { "en": "Farmer agreed that Katyayani may show…", "hi": "किसान ने…" } }`.
   Show the text in the farmer's language on the consent checkbox. Cache it for the screen only.
2. **Farmer.** Pick from **My farmers** (`GET /leads`) — send their `pii_id`. A farmer who is
   not in the list is added as a lead first (`POST /leads`, which has its own contact
   consent); "Someone not in my list" with only a name and village is **not** accepted.
3. **Media** (video / photo only):
   ```http
   POST /testimonials/uploads
   { "kind": "video", "content_type": "video/mp4", "size": 18874368 }
   ```
   ```json
   { "path": "vistaar/testimonials/VST-000123/video/3f1c….mp4",
     "upload_url": "https://storage.googleapis.com/…", "method": "PUT",
     "headers": { "Content-Type": "video/mp4", "x-goog-content-length-range": "1,62914560" },
     "expires_at": "…" }
   ```
   PUT the file's bytes to `upload_url` with **exactly** those headers (anything else is a
   `403` from storage). The URL lasts 30 minutes; ask for a new one to retry after that.

   | Kind | Types | Max |
   |---|---|---|
   | `video` | `video/mp4`, `video/quicktime`, `video/3gpp`, `video/webm` | 60 MB, ≤ 90 s |
   | `photo` | `image/jpeg`, `image/png`, `image/webp`, `image/heic`, `image/heif` | 10 MB |
4. **Submit:**
   ```http
   POST /testimonials
   {
     "id": "0b6e7c1e-2f7a-4c55-9a43-6b0f0e3f8a11",
     "pii_id": "PII-1618191",
     "bulk": "BK-48",
     "crop": "Wheat",
     "kind": "video",
     "media_path": "vistaar/testimonials/VST-000123/video/3f1c….mp4",
     "duration_sec": 42,
     "text": "Yield went up after two sprays.",
     "rating": 5,
     "consent_version": 1,
     "consent_lang": "hi"
   }
   ```

| Field | Rule |
|---|---|
| `id` | A UUID the app makes **once** per testimonial and keeps for retries. A retry with the same `id` answers the first one (no duplicate) |
| `pii_id` | One of the partner's own farmers, else `404` |
| `bulk` / `family` | Exactly one. `bulk` = the catalogue's product id (`BK-…`); `family` for a combo |
| `crop` | 1–40 chars |
| `kind` | `video`, `photo` or `text` |
| `media_path` | The `path` from step 3, required for `video` / `photo`; must be absent for `text` |
| `duration_sec` | Required for `video`, 1–90 |
| `text` | The farmer's words; required (≥ 2 chars) for `text`, optional otherwise; ≤ 1000 |
| `rating` | 1–5 |
| `consent_version` | The `version` from step 1. A changed wording answers `409 CONSENT_OUTDATED` — fetch it again and ask the farmer again |
| `consent_lang` | `en` or `hi` — the text the farmer was shown |

The answer is a `MySubmission` with `status: "submitted"`. Toast: *"It will appear in the
Library once HO approves."*

## `MySubmission`

```json
{
  "id": "0b6e7c1e-…", "status": "submitted", "reason": null, "kind": "video",
  "farmer": { "pii_id": "PII-1618191", "name": "Ramu Kaka", "village": "Rampur" },
  "product": { "bulk": "BK-48", "family": null, "name": "HUMIC+FULVIC" },
  "crop": "Wheat", "text": "Yield went up…", "rating": 5,
  "media": { "media_type": "video", "url": "https://…", "duration_sec": 42 },
  "views": 0, "shares": 0, "coins_awarded": null, "gig_id": null,
  "created_at": "…", "decided_at": null
}
```

- `status`: `submitted` (waiting for HO) · `approved` (in the library) · `rejected` (show
  `reason`) · `removed` (taken down after approval; `reason` may say why).
- `media` is `null` for a quote. `media_type` is `video` or `image`. `url` is signed for one
  hour while undecided — refetch the list rather than storing it.
- `coins_awarded` stays `null` until the wallet exists; `gig_id` until meeting gigs exist.

## Library

`GET /testimonials/library` — approved stories from every partner.

| Param | Meaning |
|---|---|
| `q` | Farmer, village, district, product, crop or words |
| `bulk` / `family` | Product deep link (`/testimonials?product=`) |
| `crop` | Exact crop as shown on the cards |
| `kind` | `video`, `photo`, `text` |
| `state`, `district` | **Near me** — send the partner's own state / district |
| `sort` | `shared` (most shared, default) or `newest` |

```json
{
  "id": "0b6e7c1e-…",
  "farmer": { "name": "Ramu Kaka", "village": "Rampur", "district": "Indore", "state": "Madhya Pradesh" },
  "partner_name": "Asha Devi",
  "product": { "bulk": "BK-48", "family": null, "name": "HUMIC+FULVIC" },
  "crop": "Wheat", "kind": "video", "text": "…", "rating": 5,
  "media": { "media_type": "video", "url": "https://firebasestorage…", "duration_sec": 42 },
  "views": 120, "shares": 34, "created_at": "…"
}
```

The card never carries the farmer's phone or `pii_id`. An approved `url` is a lasting link —
cache and share it. When the card is opened / played call `POST /testimonials/:id/view`;
after the WhatsApp share sheet, `POST /testimonials/:id/share`. Both answer
`{ "views": n, "shares": n }` — use them instead of a local `_extraShares`. A story no longer in
the library answers `404`.

## Errors (`error.code`)

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_FAILED` | A bad field, both / neither of `bulk` and `family`, a quote with no words or with a file, a video with no `duration_sec`, or a `media_path` already sent on another testimonial (upload the file again — one file, one testimonial) |
| 400 | `FILE_TYPE_NOT_ALLOWED` / `FILE_TOO_LARGE` | Upload request outside the table above |
| 400 | `MEDIA_NOT_FOUND` | `media_path` not uploaded (or not finished), not this partner's, or not this kind — upload again |
| 400 | `PRODUCT_NOT_FOUND` | The product / combo is not in the catalogue |
| 403 | `PARTNER_NOT_APPROVED` / `ACCOUNT_BLOCKED` | Only approved, active partners send testimonials |
| 404 | `NOT_FOUND` | The farmer is not one of yours; or no such testimonial |
| 409 | `CONSENT_OUTDATED` | The consent wording changed (`details[0]`: `current_version=n`) |
| 503 | `UPLOADS_NOT_CONFIGURED` | Storage is not set up on this server |

## Changes from the prototype

- `TestimonialKind.photo` is `image` in `media.media_type`; `kind` stays `photo`.
- Status `published` is gone — `approved` means published. `removed` is new.
- The library's `customerName` / `village` / `district` / `state` / `partnerName` /
  `durationSec` / `views` / `shares` come from the server; `customerId` is not sent to other
  partners.
