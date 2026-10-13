# FAQs — app contract

The /faqs screen (Learn · FAQs) reads its sections and FAQs from HO instead of
the built-in `faqs` + `extraFaqs` seed and the fixed `FaqCategory` enum. Needs
the partner's login token.

## `GET /api/v2/faqs`

The live sections and every FAQ in them, each in HO's display order. No paging
— the whole list is small, and the app keeps doing the section filter and
search on its side (`faq_rules.dart`).

```json
{
  "success": true,
  "data": {
    "sections": [
      { "key": "program", "label": "Programme", "emoji": "🤝" },
      { "key": "payments", "label": "Payments", "emoji": "💰" }
    ],
    "faqs": [
      {
        "id": "6c1f6d0e-5b7a-4a51-9a9a-2f1c3e8d7b10",
        "category": "payments",
        "q": "Is TDS deducted?",
        "a": "Yes, TDS applies as per law on commission. Keep your PAN updated to avoid higher deduction."
      }
    ]
  }
}
```

### `sections[]` — the category chips

| Field | Note |
|---|---|
| `key` | Stable id; a FAQ's `category` |
| `label` | Chip text (replaces `faqCategoryLabels`) |
| `emoji` | Optional, `null` when HO set none |

Only sections HO has switched on **and** that have at least one FAQ come back,
so every chip filters to something. Show the chips in this order, after "All".

### `faqs[]`

| Field | Note |
|---|---|
| `id` | UUID. Use it for the open accordion item and the `faq_opened` event |
| `category` | A `sections[].key`. Always one of the sections in the same response |
| `q` | Unique (ignoring case and spacing), so the Learn hub's `?q=<question>` link opens exactly one |
| `a` | Plain text, up to 2000 characters |

## App changes needed

- `FaqCategory` can no longer be a closed enum: HO adds sections. Make it a
  `String` key, and take labels from `sections[]` instead of `faqCategoryLabels`.
- `faqCategoriesIn` becomes the `sections` list as returned (already filtered and
  ordered); `faqCountFor` and `filterFaqs` work unchanged on the key.
- The ids are no longer `f1` / `fx1`.

## Caching

An HO edit shows within **60 seconds**. Cache the response for the session and
refetch on pull-to-refresh. Empty `sections` and `faqs` mean HO has published
none — show the empty state.
