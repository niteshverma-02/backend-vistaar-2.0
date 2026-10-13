# Banners — mobile app contract

The Home screen's banner carousel (PRD H3). This replaces the seed
`banners` that `ContentLocalDataSource.banners()` returns today
(`lib/features/content/data/seed/content_seed.dart`).

## Route

| Method | Path | Headers | Returns |
|---|---|---|---|
| `GET` | `/api/v2/banners` | `Authorization: Bearer <Vistaar access token>` | `PartnerBanner[]`, in display order, at most 10 |

The server picks the list for the caller:

- A banner is shown only while it is **live**: switched on, past its `starts_at` and before its `ends_at`.
- A banner targeted at cohorts is shown only to partners of those cohorts. A banner with no cohorts is shown to everyone.
- A partner who hasn't picked a cohort yet sees only the untargeted banners.
- An empty list `[]` is normal. The carousel already draws nothing for it.

HO edits reach the app within **a minute**. Send `If-None-Match` and you get a
`304` when nothing changed.

## Two kinds of banner

| `image` | What to draw | Tap |
|---|---|---|
| `null` | **Text banner.** Today's `BannerTile`: `title`, `subtitle`, a `cta` pill, the `tone` gradient and the `emoji` | Opens `link` |
| set | **Image banner.** HO's own art, filling the slide (`BoxFit.cover`, `AspectRatio(width / height)`, rounded corners like the tile). Use `title` as the screen-reader label | Opens `link` |

Image banners are always **2.4:1** (the HO portal crops to it and the upload
refuses anything else); banners saved before this rule may be 3:1, so keep
using `width / height` rather than a fixed 2.4. If the carousel shows text and image banners together,
give every slide the same height.

## `PartnerBanner`

Text banner:

```json
{
  "id": "2b1f3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  "title": { "en": "Rabi Booking Open", "hi": "रबी बुकिंग शुरू" },
  "subtitle": { "en": "Book humic acid & zinc before 15 Oct — extra 3% on orders above ₹10,000" },
  "cta": { "en": "Book now" },
  "link": "/products",
  "tone": "primary",
  "emoji": "🌾",
  "image": null
}
```

Image banner:

```json
{
  "id": "7c1d…",
  "title": { "en": "Diwali offer" },
  "subtitle": null,
  "cta": null,
  "link": "/products",
  "tone": "primary",
  "emoji": null,
  "image": {
    "url": "https://firebasestorage.googleapis.com/v0/b/…/o/vistaar%2Fbanners%2F….jpg?alt=media&token=…",
    "width": 1200,
    "height": 500
  }
}
```

| Field | Maps to `HomeBanner` | Note |
|---|---|---|
| `id` | `id` | A UUID |
| `title`, `subtitle`, `cta` | same names | Localized maps, like the onboarding form labels. Pick the app language and fall back to `en`. `subtitle` and `cta` are `null` only on an image banner |
| `link` | `link` | An in-app route starting with `/` (for example `/products`, `/events`, `/products/p8`), passed to `context.push`. It is never a web URL |
| `tone` | `tone` (`BannerTone.fromWire`) | One of `primary`, `warning`, `success`, `info` |
| `emoji` | `emoji` | Can be `null`; draw nothing in that case |
| `image` | *(new)* | `{ url, width, height }` or `null`. The `url` never changes for the same art, so cache it with `CachedNetworkImage` or similar. It needs no auth header |

## Errors (`error.code`)

| Status | Code | When |
|---|---|---|
| 401 | `UNAUTHORIZED` | Missing or expired token. Refresh it and retry |
| 404 | `NOT_FOUND` | The token's partner no longer exists |
