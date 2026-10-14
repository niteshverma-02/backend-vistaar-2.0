# My Story — mobile app contract

The WhatsApp Status maker (`/my-story`). The app keeps drawing the 1080 × 1920
image on the phone; the server keeps **what it was drawn from**, the image, the
partner's photo and a share count — so "My stories" survives a reinstall and
follows the partner to a new phone. It replaces `StoryLocalDataSource`
(`vistaar.myStories` in `shared_preferences`) and the hard-coded `festivals`,
`testimonialLibrary` and `cropCalendar` the templates pre-fill from.

Every route takes `Authorization: Bearer <Vistaar access token>`. The partner
is the token's; nothing in a path or body names one.

## Routes (`/api/v2/stories`)

| Method | Path | Body | Returns |
|---|---|---|---|
| `GET` | `/stories/content` | — | `{ templates, designs, festivals, farmer_stories, meetings }` |
| `POST` | `/stories/images?kind=render\|photo` | multipart `file` | `UploadedStoryImage` |
| `POST` | `/stories` | `SaveStory` | `Story` |
| `GET` | `/stories` | — | `Story[]`, newest first, at most 20 |
| `GET` | `/stories/:id` | — | `Story` |
| `POST` | `/stories/:id/share` | `{ "channel": "status" }` | `Story` |
| `DELETE` | `/stories/:id` | — | `{ "deleted": true }` |

`:id` is the story's UUID; anything else is `400`.

## The flow

1. **Open My Story** → `GET /stories/content` (pickers) and `GET /stories` (the list).
2. **Partner adds a photo** → `POST /stories/images?kind=photo` once, keep the `path`.
   Re-use the same path for every story drawn on that photo — a new upload is a new story.
3. **Share / Download / Send to farmer / Copy caption** → draw the PNG, then:
   - `POST /stories/images?kind=render` → `path`
   - `POST /stories` with `config`, `selection`, `image` (that path), `photo` (or `null`) and the `channel`
   - Then open the share sheet as today. A failed save must **not** block the share — retry it later.
4. **Share again** from the list → `POST /stories/:id/share` with the channel. The image is already on the server (`image.url`).
5. **Edit** → load `config`, `selection` and `photo.url` into the editor; saving makes a new story (different text = different story).
6. **Delete** → `DELETE /stories/:id`.

The server does the app's `remember()` rules:

- **Same story = one row.** The same `config` on the same `photo` path is matched,
  moved to the top, and its image replaced by the new upload (so a changed name in
  the footer shows). `selection` is not part of the match, as in the app.
- **At most 20.** A 21st pushes the oldest off, its files with it.

## `SaveStory`

```json
{
  "config": {
    "template": "product",
    "lang": "en",
    "theme": "green",
    "fields": {
      "emoji": "🌾", "headline": "Humic Acid 98%", "body": "Stronger roots",
      "detail1": "Better flowering", "detail2": "Wheat, Paddy", "detail3": "1 kg",
      "price": "499", "mrp": "650", "stars": 5
    },
    "show_whatsapp": true,
    "photo_mode": "inset"
  },
  "selection": {
    "product_id": "p8", "testimonial_id": "", "crop_id": "wheat",
    "stage_idx": 0, "meeting_key": "", "festival": "diwali"
  },
  "image": "vistaar/stories/VST-000001/2b1f3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d.png",
  "photo": null,
  "channel": "status"
}
```

| Field | Rule |
|---|---|
| `config.template` | `product`, `testimonial`, `tip`, `meeting`, `festival`, `custom` |
| `config.lang` | `hi`, `en` |
| `config.card` | Optional: the custom card's `key` (`null` / absent for a built-in card). Part of "same story" |
| `config.theme` | A design `key` from `designs` (lowercase, digits, `_`). `green`, `harvest`, `earth`, `sky` always draw: the app bundles them |
| `config.photo_mode` | `background`, `inset` |
| `config.fields` | **All nine sent**, unused ones `""`. `headline`/`detail*` ≤ 120, `body` ≤ 400, `price`/`mrp` ≤ 12, `emoji` ≤ 16, `stars` 1–5 |
| `selection` | Optional / `null`. Opaque ids for the picker; `festival` is a festival `key` or `""` |
| `image` | Required. A `render` path **you** uploaded |
| `photo` | Optional / `null`. A `photo` path you uploaded |
| `channel` | Optional. `status`, `download`, `farmer`, `copy` — set it when the save is a share |

The Dart model is camelCase today (`showWhatsApp`, `photoMode`, `productId`…):
map to snake_case at the data-source boundary, as for every other feature.

## Images

| `kind` | What | Rule |
|---|---|---|
| `render` | The finished status image | JPG/PNG/WEBP, ≤ 3 MB, **9:16**, 540–2160 px wide (1080 × 1920 is right) |
| `photo` | The partner's photo it is drawn on | JPG/PNG/WEBP, ≤ 5 MB, ≥ 200 px a side, ≤ 4096 px longest side. Downscale before upload (the app already does) |

Type and size are read from the bytes. Files are **private**: every `url` the
API returns is a signed link valid for **one hour** — cache the bytes by
`path`, not by `url`, and re-read the list for fresh links.


**Paths are opaque.** An upload's `path` carries a signed receipt
(`…/<uuid>~r~1080x1920~<time>~<sig>.png`); send it back exactly as given.
`POST /stories` trusts a receipt for an hour without asking the bucket, so a
save right after its uploads is fast; an older path is checked against the
bucket as before. Signed `url`s are reused while they have 15+ minutes left —
cache images by `path`, never by `url`.

## `Story`

```json
{
  "id": "6f0c…",
  "config": { "template": "product", "lang": "en", "theme": "green", "fields": { … }, "show_whatsapp": true, "photo_mode": "inset" },
  "selection": { … } ,
  "image": { "path": "vistaar/stories/VST-000001/….png", "url": "https://storage.googleapis.com/…", "width": 1080, "height": 1920 },
  "photo": null,
  "share_count": 3,
  "last_shared_at": "2026-10-12T06:41:00.000Z",
  "last_used_at": "2026-10-12T06:41:00.000Z",
  "created_at": "2026-10-10T09:12:00.000Z"
}
```

`url` can be `null` if signing failed — draw from `config` then. List order is
`last_used_at` (saved or shared most recently first). "Made today" on the page
is the stories whose `created_at` is today.

## `GET /stories/content`

```json
{
  "templates": [
    { "key": "product", "label": { "en": "Product offer", "hi": "प्रोडक्ट ऑफ़र" },
      "hint": { "en": "Price vs MRP, % off" },
      "texts": { "en": { "kicker": "Special offer", "cta": "Order today" }, "hi": { "kicker": "ख़ास ऑफ़र", "cta": "आज ही ऑर्डर करें" } },
      "fields": {}, "emojis": [], "default_design": null, "suggested": false, "base": "product" },
    { "key": "new_stock", "base": "custom", "label": { "en": "New stock arrived" }, "hint": { "en": "Tell farmers what is in" },
      "texts": { "en": { "kicker": "In stock now", "cta": "Call to book yours" } },
      "fields": { "en": { "emoji": "📦", "headline": "New stock arrived!", "body": "…" } },
      "emojis": ["📦", "🚚"], "default_design": "sky", "suggested": true }
  ],
  "designs": [
    { "key": "green", "label": { "en": "Katyayani green", "hi": "कात्यायनी हरा" },
      "colors": { "bg_from": "#1D5A26", "bg_to": "#3F8F3A", "text": "#FFFFFF", "subtext": "#FFFFFFD1",
                  "accent": "#F6C945", "accent_text": "#1D3A12", "soft": "#FFFFFF29", "deco": "#FFFFFF12",
                  "avatar": "#1D5A26" },
      "image": null, "overlay": 0, "templates": [] },
    { "key": "diwali_lights", "label": { "en": "Diwali lights" }, "colors": { … },
      "image": { "url": "https://firebasestorage…", "width": 1080, "height": 1920 },
      "overlay": 0.2, "templates": ["festival", "custom"] }
  ],
  "festivals": [
    { "key": "diwali", "label": { "en": "Diwali", "hi": "दीपावली" }, "emoji": "🪔",
      "text": { "en": { "headline": "Happy Diwali", "body": "…" }, "hi": { "headline": "…", "body": "…" } } }
  ],
  "farmer_stories": [
    { "id": "665a2c3d4e5f6789abcdef12", "source": "testimonial", "name": "Ramu Kaka",
      "quote": "Great results on my wheat!", "product": "Humic Acid 98%", "crop": null,
      "village": null, "district": null, "stars": null,
      "media": { "media_type": "video", "media_url": "https://…" } },
    { "id": "ramesh_yadav_wheat", "source": "sample", "name": "Ramesh Yadav",
      "quote": "Roots were much stronger this season, got 2 quintal extra per acre.",
      "product": "Humic + Fulvic Acid 98%", "crop": "Wheat", "village": "Rampur",
      "district": "Lucknow", "stars": 5, "media": null }
  ],
  "meetings": [
    { "key": "e:2b1f3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d", "kind": "event", "title": "Humic Acid Field Day",
      "starts_at": "2026-10-18T03:30:00.000Z", "place": "Ramesh Yadav farm, Rampur", "note": null, "registered": false }
  ]
}
```

- **Festivals** are HO's live greetings, picker order. `key` is a string now —
  the app's `FestivalId` enum must become a string (old saved `diwali` /
  `chhath` / `sankranti` / `generic` keep working: those keys are seeded).
  Fall back to `text.en` when the language is missing.
- **Farmer stories** replace `testimonialLibrary`: Vistaar's **approved**
  product testimonials that have words (`source: testimonial`, newest 50), then
  HO's ready-made quotes (`source: sample`, the old 8 seed stories). Fill the
  template: `quote` → body, `name` → headline, `village, district` → detail1,
  `product · crop` → detail2, `stars` (5 when `null`). `id` goes in
  `selection.testimonial_id`.
- **No crop calendar** (removed 2026-10-14): the "Crop tip" template keeps the app's built-in
  `cropCalendar`; crop data lives in ko-sales `/crops` (the Crop Guide).
- **Meetings** replace `meetingOptions()`: upcoming events for the partner's
  cohort, soonest first (`EVENTS-APP.md`). Fill: `title` → headline,
  `starts_at` → date (`storyDate`) and time, `place` → detail3, `note` → body
  (else the template's own line). `key` → `selection.meeting_key`. Meeting
  **gigs** are not on the server yet; they will join this list as `kind: "gig"`.
  Until then keep showing the phone's accepted gigs after these.
- All of it changes within a minute of an HO edit. `If-None-Match` gives `304`.

## Template cards ("Choose a design")

`templates` is the strip, **in order (suggested first), hidden and
out-of-window cards left out**. Empty → the app's bundled six.

- A card has a `key` and a `base` layout. For the six built-in cards
  `key == base`; any other key is HO's custom card drawn with `base`'s layout.
- Show `label.en` / `hint.en`; `suggested: true` → a "✨ Suggested" badge.
  Keep the card being edited in the strip even if HO hid or removed it.
- Picking a card: layout = `base`; design = `default_design` when it is in
  `designs`; text = the layout's defaults (from the picker) with `fields[lang]`
  laid over; icons = `emojis` when non-empty.
- Draw `texts[lang].kicker` as the top pill and `texts[lang].cta` as the call
  to action (`""` = none) — the **picked card's** words for its layout; a
  language HO left out keeps the app's words. Same words in the caption.
- Save the custom card's key as `config.card` (`null` for a built-in card).
- A `base` this app version does not know: skip that card.

## Designs (the look picker)

`designs` is HO's list, **picker order; the first is the default** for a new
story. The app draws exactly what it says:

- **Colours** are `#RRGGBB` or `#RRGGBBAA` — **alpha is the last byte** (CSS
  order, not Flutter's `0xAARRGGBB`). All nine are always sent.
- **`image`** (optional) is HO's 9:16 art: draw it cover-fit over the whole
  story, then `bg_from` at `overlay` opacity, then the text. No circles over
  art. The `url` is public and never changes for a design's art — cache by it.
  Decode only the art of the design being drawn; a 1080 × 1920 image is ~8 MB
  decoded. Wait for it (bounded) before rendering the image to share.
- **`templates`**: offer the design only on these templates; empty = all.
  Keep the partner's current design selected even when it is not offered on
  the template they switch to.
- **A key the list no longer has** (HO removed or ended it): a saved story
  keeps its image; "Edit" draws the four bundled keys in their bundled colours,
  any other key in the default design.
- Empty or unreadable list → the four bundled designs. Drop a single design
  the app cannot read (bad colour), not the whole list.

## Errors

| Code | Status | When |
|---|---|---|
| `FILE_REQUIRED` | 400 | No multipart `file` |
| `FILE_TYPE_NOT_ALLOWED` | 400 | Not JPG/PNG/WEBP |
| `IMAGE_SIZE_NOT_ALLOWED` | 400 | Wrong shape/size — `details[0]` says what to use |
| `FILE_TOO_LARGE` | 413 | Over 3 MB (render) / 5 MB (photo) |
| `IMAGE_NOT_FOUND` | 400 | `image`/`photo` not uploaded by this partner, or the wrong kind — upload again |
| `UPLOADS_NOT_CONFIGURED` | 503 | Server has no bucket; share anyway, save later |
| `NOT_FOUND` | 404 | No such story **of yours** |
| `TOO_MANY_REQUESTS` | 429 | More than 30 uploads / saves / shares a minute |
