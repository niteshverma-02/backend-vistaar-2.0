# Feedback — mobile app contract

The Feedback screen (`/feedback`, `lib/features/help/presentation/pages/feedback_page.dart`,
PRD L5). This replaces the local-only submit (today the screen only fires an analytics
event and shows "Thank you!"), the seed `npsReasons` in `help_seed.dart`, and the
client-made `SUG-xxxxx` reference (`newSuggestionRef`).

Every route takes `Authorization: Bearer <Vistaar access token>`. The partner comes from
the token, never from the body.

## Routes

| Method | Path | Body | Returns |
|---|---|---|---|
| `GET` | `/api/v2/feedback/reasons` | — | `NpsReasonSet` |
| `POST` | `/api/v2/feedback` | `SubmitFeedback` | `201` `FeedbackReceipt` |
| `POST` | `/api/v2/feedback/suggestions` | `SuggestProduct` | `201` `SuggestionReceipt` |

## Rules the server applies

- **Bucket is the server's.** `0–6` detractor, `7–8` passive, `9–10` promoter — the same split as `npsBucket()`.
- **A detractor opens a call-back** for the partner's reporting officer, due at the end of the **2nd working day** (Mon–Sat, IST). The receipt's `follow_up_due_at` is that time, so the "Your Prasar Officer will call you within 2 working days" line can stay as it is.
- **Reasons** are stored as the text the partner saw. They are trimmed and repeats dropped, but **not** checked against today's chips — HO may change the chips while the phone still shows the old ones.
- **Stars** (`rating`) are optional and independent of the NPS. Leave the field out when 0 stars are picked.
- **Caps.** 10 answers and 20 suggestions per partner per IST day → `429 FEEDBACK_LIMIT` (show `error.details[0]`). Each POST also allows 5 calls a minute.
- "Give more feedback" simply sends another answer — nothing is overwritten.

## `NpsReasonSet` (`GET /feedback/reasons`)

HO edits these; the server caches them ≤ 60 s. If HO never changed them they are the
app's current seed copy, so the screen looks the same.

```json
{
  "detractor": { "question": "What went wrong?", "chips": ["Late delivery", "Commission delayed", "Stock not available", "Price too high", "App is confusing", "No support from officer"] },
  "passive":   { "question": "What would make it a 10?", "chips": ["Faster delivery", "Higher commission", "More products", "Better app", "More training", "Quicker payouts"] },
  "promoter":  { "question": "What do you like most?", "chips": ["Product quality", "Timely commission", "Fast delivery", "Helpful officer", "Easy app", "Farmer results"] }
}
```

All three keys are always present. Keep the seed as the offline fallback.

## `SubmitFeedback` (`POST /feedback`)

```json
{ "nps": 4, "reasons": ["Late delivery"], "comment": "Delivery takes a week", "rating": 2 }
```

| Field | Rule |
|---|---|
| `nps` | Required integer `0–10` |
| `reasons` | Optional, up to 10 strings, each ≤ 60 characters |
| `comment` | Optional, ≤ 500 characters (the textarea's cap); blank = none |
| `rating` | Optional integer `1–5` |

## `FeedbackReceipt`

```json
{
  "id": "6710a1f0c2b54e0012ab34cd",
  "bucket": "detractor",
  "follow_up_due_at": "2026-10-14T18:29:59.999Z",
  "created_at": "2026-10-12T04:30:00.000Z"
}
```

`follow_up_due_at` is `null` for passives and promoters.

## `SuggestProduct` (`POST /feedback/suggestions`)

```json
{ "product": "Emamectin benzoate 5% SG", "crop": "Chilli", "monthly_demand": "50 packs", "note": "Farmers pay ₹450 for Missile" }
```

| Field | Rule (same caps as `help_rules.dart`) |
|---|---|
| `product` | Required, 2–80 characters (`canSendSuggestion`) |
| `crop` | Optional, ≤ 40 |
| `monthly_demand` | Optional free text, ≤ 30 |
| `note` | Optional, ≤ 300 |

## `SuggestionReceipt`

```json
{ "ref": "SUG-000123", "product": "Emamectin benzoate 5% SG", "created_at": "2026-10-12T04:30:00.000Z" }
```

Show `ref` in the toast ("Reference SUG-000123 · …") instead of `newSuggestionRef()`.

## Errors

| Status | `error.code` | When |
|---|---|---|
| `400` | `VALIDATION_FAILED` | A field breaks a rule above |
| `401` | `UNAUTHORIZED` / `SESSION_INVALID` | Token missing or expired — refresh |
| `404` | `NOT_FOUND` | The partner record is gone |
| `429` | `FEEDBACK_LIMIT` | The day's answers or suggestions are used up |
| `429` | `TOO_MANY_REQUESTS` | More than 5 POSTs a minute |

## App changes needed

1. `HelpRepository.npsReasons` → fetch `GET /feedback/reasons` (seed as fallback).
2. "Submit feedback" → `POST /feedback`; show "Thank you!" on `201`, the error on failure (keep the form filled).
3. "Send suggestion" → `POST /feedback/suggestions`; use the returned `ref`.
