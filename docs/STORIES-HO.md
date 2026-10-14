# My Story — HO portal contract

Six screens: **template cards** (the six "Choose a design" cards),
**designs** (the looks a story can have — colours, or HO's own art), **festival greetings** and **ready-made farmer stories**
the app's templates offer,
**activity** (who is promoting on WhatsApp, with which template, through which
button), and **partners' saved stories** (look, and take one down).

| Capability | Allows |
|---|---|
| `content.read` | List and view festivals (same as banners) |
| `content.write` | Edit / hide template cards; add, edit, schedule, (de)activate, delete designs, festivals, farmer stories and crops |
| `stories.read` | Activity summary, partner ranking, one partner's days, saved stories |
| `stories.write` | Delete a partner's saved story |

All go to the head roles today. Gate on `GET /admin/me`.

## Template cards (`/api/v2/admin/story-templates`)

The cards under **1 · Choose a design** in My Story. Two kinds:

- **Built-in (6):** `product` (Product offer), `testimonial` (Farmer story),
  `tip` (Crop tip), `meeting` (Meeting invite), `festival` (Festival),
  `custom` (Custom text). Each is one **layout** the app draws (price row,
  quote + stars, white info card…). HO edits and hides them, never deletes.
- **Custom (any number):** HO makes a new card **on one of the six layouts**
  (`base`) with its own name, words, pre-filled text, icons and design, e.g.
  "Diwali offer" = the Product layout + `diwali_lights` + "Diwali dhamaka".
  No app update needed. A brand-new *arrangement* (a new layout) still needs
  an app release.

`suggested: true` puts a card **first in the strip with a "✨ Suggested"
badge**.

| Method | Path | Capability | Body | Returns |
|---|---|---|---|---|
| `GET` | `/admin/story-templates` | `content.read` | — | `Template[]`, strip order (suggested first), hidden / scheduled / ended too |
| `GET` | `/admin/story-templates/:key` | `content.read` | — | `Template` |
| `POST` | `/admin/story-templates` | `content.write` | `CreateTemplate` | `Template` |
| `PATCH` | `/admin/story-templates/:key` | `content.write` | any of the fields | `Template` |
| `DELETE` | `/admin/story-templates/:key` | `content.write` | — | `{ deleted: true }` — custom cards only |

```json
{
  "key": "diwali_offer",
  "base": "product",
  "label": { "en": "Diwali offer", "hi": "दिवाली ऑफ़र" },
  "hint": { "en": "Festive price, Diwali look" },
  "texts": {
    "en": { "kicker": "Diwali dhamaka", "cta": "Order before Diwali" },
    "hi": { "kicker": "दिवाली धमाका", "cta": "दिवाली से पहले ऑर्डर करें" }
  },
  "fields": { "en": { "body": "Festive price — limited stock" } },
  "emojis": [],
  "default_design": "diwali_lights",
  "suggested": true,
  "starts_at": "2026-10-20T00:00:00+05:30",
  "ends_at": "2026-11-05T23:59:59+05:30",
  "order": 1,
  "is_active": true
}
```

| Field | Rule |
|---|---|
| `key` | Create only. Lowercase letters, digits, `_`, starting with a letter; **not** one of the six layout names. Saved stories keep it. Taken → `409 TEMPLATE_EXISTS` |
| `base` | Create only, cannot change: the layout (`product`, `testimonial`, `tip`, `meeting`, `festival`, `custom`). It decides what the partner picks (a product, a farmer story, a crop, an event, a festival, an icon) and where things go |
| `label`, `hint` | Card title and subtitle; `en` required |
| `texts` | Printed **on the story**: `kicker` (top pill, required) and `cta` (call to action; `""` = none), `en` required, `hi` optional (left out → the app's built-in Hindi). `PATCH` replaces the set |
| `fields` | Text the card **pre-fills**, per language: `emoji`, `headline`, `body`, `detail1`–`detail3`. Laid over what the layout fills from the picker (a product's name, a crop's advice…); the partner can still edit. Empty values are dropped. `PATCH` replaces the set |
| `emojis` | Icon choices (≤ 24); empty = the app's built-in eight |
| `default_design` | Design `key` the card opens in; `null` = keep the partner's current one. Unknown → `400`; deleted later → shows in `warnings` |
| `suggested` | First in the strip, with the badge |
| `starts_at` / `ends_at` | Optional window — a Diwali card only for Diwali weeks |
| `order` | Lower first (after the suggested cards) |
| `is_active` | `false` hides it. At least one card must stay shown (`400`) |

`Template` adds `builtin`, `status` (`live` / `scheduled` / `expired` /
`inactive`) and `warnings`. Deleting a built-in card → `400` (hide it
instead). A saved story made from a deleted or hidden card keeps its image;
"Edit" opens it on its layout. The app picks up a change within a minute.

**Seeded examples** (suggested): `diwali_offer` (Product), `rabi_sowing_tip`
(Crop tip), `kisan_mela_invite` (Meeting), `new_stock` (Custom), plus
`thank_you_farmers` (Custom, not suggested). Edit or delete them freely.

### Ideas for custom cards

| Card | Layout | Words / pre-fill | Design |
|---|---|---|---|
| Diwali / Holi offer | Product | "Diwali dhamaka" · "Order before Diwali" | Festival art, window = festival weeks |
| Rabi / Kharif booking | Product | "Book early, save more" | Harvest |
| Sowing / spraying alert | Crop tip | "Spray alert" · "Call for free advice" | Earth |
| Kisan Mela / Field day | Meeting | "Kisan Mela" · "Bring your neighbours" | Harvest |
| Before–after result | Farmer story | "Real result" · "Try it on your farm" | Green |
| New stock / Price drop | Custom | 📦 "New stock arrived!" | Sky |
| Thank you / Season wishes | Custom / Festival | 🙏 "Thank you, farmer friends!" | Green |

## Designs (`/api/v2/admin/story-designs`)

What the partner picks under **Design** in My Story. A design is a palette,
optionally with HO's own 9:16 art behind the text. Two ways to make one:

1. **Create from colours** — pick the colours, save.
2. **Upload a design** — upload the art (`POST …/image`), then save the
   design with the returned `path` as `image` and colours for the text.

| Method | Path | Capability | Body | Returns |
|---|---|---|---|---|
| `GET` | `/admin/story-designs?status=&page=&limit=&sort=` | `content.read` | — | `PageResult<Design>` |
| `POST` | `/admin/story-designs/image` | `content.write` | multipart `file` | `{ path, url, content_type, size, width, height }` |
| `GET` | `/admin/story-designs/:id` | `content.read` | — | `Design` |
| `POST` | `/admin/story-designs` | `content.write` | `CreateDesign` | `Design` |
| `PATCH` | `/admin/story-designs/:id` | `content.write` | any of the fields | `Design` |
| `DELETE` | `/admin/story-designs/:id` | `content.write` | — | `{ deleted: true }` |

```json
{
  "key": "diwali_lights",
  "label": { "en": "Diwali lights", "hi": "दीवाली रोशनी" },
  "colors": { "bg_from": "#3B0A45", "bg_to": "#B8401A", "text": "#FFF4DC",
              "accent": "#FFC93C", "accent_text": "#3B0A45" },
  "image": "vistaar/story-designs/9a27….png",
  "overlay": 0.2,
  "templates": ["festival", "custom"],
  "starts_at": "2026-10-25T00:00:00+05:30",
  "ends_at": "2026-11-05T23:59:59+05:30",
  "order": 5,
  "is_active": true
}
```

| Field | Rule |
|---|---|
| `key` | Lowercase letters, digits, `_`, starting with a letter. **Cannot change** — saved stories keep it. Taken → `409 DESIGN_EXISTS` |
| `colors` | `#RRGGBB` or `#RRGGBBAA` (alpha last). **Required:** `bg_from`, `bg_to` (background gradient, top-left → bottom-right), `text`, `accent` (price, pills, stars). **Optional**, derived when left out: `subtext` (text at 82%), `accent_text` (text on accent pills; default `bg_from`), `soft` (panels; white 16%), `deco` (circles; white 7%), `avatar` (initials circle; default `bg_from`). On `PATCH`, `colors` **replaces** the palette — send every colour you set yourself |
| `image` | A `path` from `POST …/image`: JPG/PNG/WEBP, ≤ 3 MB, **9:16**, 720–2160 px wide (1080 × 1920 best). `null` removes the art. Leave space at the top and bottom: the brand line sits at the top, the partner card at the bottom |
| `overlay` | 0–0.9: `bg_from` laid over the art so the text reads. Default 0.35 when art is added; ignored without art |
| `templates` | Offer only on these (`product`, `testimonial`, `tip`, `meeting`, `festival`, `custom`); empty = all |
| `starts_at` / `ends_at` | Optional window (a Diwali look for Diwali week) |
| `order` | Lower first. **The first live design is the app's default** for a new story |

`Design` adds `status` (`live` / `scheduled` / `expired` / `inactive`),
`image_url`, `image_width`, `image_height` and **`warnings`**: readability
advice, e.g. "Text on bg_to has contrast 2.4:1; 3:1 or more reads better".
Show them on the form; they never block a save.

The app picks up a change within a minute. Deleting a design (or its art)
never changes a saved story — its finished image stays; "Edit" on it opens in
the default design. The four built-in keys `green`, `harvest`, `earth`, `sky`
are seeded so HO can recolour them; the app also bundles them for offline use.

## Festivals (`/api/v2/admin/story-festivals`)

| Method | Path | Capability | Body | Returns |
|---|---|---|---|---|
| `GET` | `?status=&page=&limit=&sort=` | `content.read` | — | `PageResult<AdminFestival>` |
| `GET` | `/:id` | `content.read` | — | `AdminFestival` |
| `POST` | `/` | `content.write` | `CreateFestival` | `AdminFestival` |
| `PATCH` | `/:id` | `content.write` | any of `label`, `emoji`, `text`, `starts_at`, `ends_at`, `order`, `is_active` | `AdminFestival` |
| `DELETE` | `/:id` | `content.write` | — | `{ "deleted": true }` |

```json
{
  "key": "diwali",
  "label": { "en": "Diwali", "hi": "दीपावली" },
  "emoji": "🪔",
  "text": {
    "en": { "headline": "Happy Diwali", "body": "May your home and fields be filled with joy and a bumper harvest." },
    "hi": { "headline": "दीपावली की हार्दिक शुभकामनाएँ", "body": "आपके घर और खेत में सुख, समृद्धि और भरपूर फसल हो।" }
  },
  "starts_at": "2026-10-25T00:00:00+05:30",
  "ends_at": "2026-11-05T23:59:59+05:30",
  "order": 1,
  "is_active": true
}
```

| Field | Rule |
|---|---|
| `key` | Required on create, **never changes**: `^[a-z][a-z0-9_]{1,40}$`. A taken key is `409 FESTIVAL_EXISTS`. Saved stories remember it |
| `label` | `label.en` required |
| `emoji` | Required, ≤ 16 characters |
| `text` | `text.en` required; every language sent needs both `headline` and `body` |
| `starts_at` / `ends_at` | Optional window the app offers it in; `null` = no bound. `ends_at` after `starts_at` |
| `order` | Lower first in the picker |

`status` (computed): `live`, `scheduled`, `expired`, `inactive`. Partners see
`live` ones, within a minute of a change. Keep one festival with no window
(e.g. `generic` "Best wishes") so the picker is never empty. Deleting one never
changes a story already made from it.

## Ready-made farmer stories (`/api/v2/admin/story-samples`)

Same routes as festivals (`GET` list `?is_active=&page=&limit=&sort=`, `GET /:id`,
`POST`, `PATCH /:id`, `DELETE /:id`), capability `content.*`. Vistaar's own
collection — never shown on a product page. The app lists real approved
testimonials first, then these.

```json
{ "key": "ramesh_yadav_wheat", "name": "Ramesh Yadav", "village": "Rampur", "district": "Lucknow",
  "state": "Uttar Pradesh", "product": "Humic + Fulvic Acid 98%", "crop": "Wheat",
  "quote": "Roots were much stronger this season, got 2 quintal extra per acre.", "stars": 5,
  "order": 1, "is_active": true }
```

`key` (required, unique, never changes; taken = `409 SAMPLE_EXISTS`), `name`,
`product`, `quote` (≤ 400) required; `stars` 1–5, default 5.

Crops are not here: the crop calendar module was removed (2026-10-14); crop data is ko-sales
`/crops` (the Crop Guide).

## Seed

`node dist/scripts/seed-story-content.js --apply` adds what the app had built
in — 6 template cards + 5 example custom cards, 5 designs, 4 festivals, 8 farmer stories — skipping any key already there.
**Done on beta 2026-10-12** (designs and template cards 2026-10-13). `diwali_lights` is a generated
test art design: skip or delete it on production. The 8 farmer stories are the prototype's sample
quotes, not real customers: replace or switch them off before launch.

## Activity (`/api/v2/admin/stories`)

Dates are IST days `YYYY-MM-DD`. Default range: the last 30 days to today; at
most **92 days**.

| Method | Path | Returns |
|---|---|---|
| `GET` | `/summary?from=&to=` | `StorySummary` |
| `GET` | `/partners?from=&to=&page=&limit=` | `PageResult<PartnerStoryRow>` + `from`, `to` — most shares first |
| `GET` | `/partners/:agentId?from=&to=` | One partner's totals, split and days |

```json
{
  "from": "2026-09-13", "to": "2026-10-12",
  "totals": { "saved": 1840, "shares": 5210, "partners": 412 },
  "by_template": { "product": 2900, "testimonial": 980, "festival": 760, "tip": 410, "meeting": 120, "custom": 40 },
  "by_channel": { "status": 3600, "farmer": 900, "download": 500, "copy": 210 },
  "by_day": [ { "date": "2026-09-13", "saved": 50, "shares": 160, "partners": 70 } ]
}
```

- `saved` = new stories made; `shares` = every Share / Download / Send / Copy, re-shares included.
- `partners` = partners with at least one share (per day in `by_day`, distinct over the range in `totals`).
- `by_day` has every day of the range, quiet days as 0 — chart it directly.
- `PartnerStoryRow`: `agent_id`, `name`, `phone`, `cohort`, `district`, `state`, `saved`, `shares`, `active_days`, `last_date`.
- A deleted story's shares stay counted.

## Saved stories

| Method | Path | Capability | Returns |
|---|---|---|---|
| `GET` | `/admin/stories?agent_id=&template=&page=&limit=&sort=` | `stories.read` | `PageResult<AdminStory>` |
| `GET` | `/admin/stories/:id` | `stories.read` | `AdminStory` |
| `DELETE` | `/admin/stories/:id` | `stories.write` | `{ "deleted": true }` |

`AdminStory` is the app's `Story` (see `STORIES-APP.md`) plus `agent_id`.
`image.url` is a signed link valid for one hour. `sort`: `last_used_at`,
`created_at`, `share_count`, with `-` for descending (default `-created_at`).
Delete takes it off the partner's list and removes its files.
