# FAQs — HO portal contract

The help FAQs partners see on the app's FAQs screen, grouped into **sections**
(the category chips at the top of that screen). HO manages both. These routes
need the company SSO token. Gate screens and buttons on these capabilities from
`GET /admin/me`:

| Capability | Allows |
|---|---|
| `content.read` | List and view sections and FAQs, including switched-off ones |
| `content.write` | Add, edit, reorder, switch off and delete sections and FAQs |

Today both capabilities go to the head roles (see `ONBOARDING-HO.md`). The app
sees any change within a minute.

Add a section first, then the FAQs in it.

## Sections — `/api/v2/admin/faq-sections`

```json
{
  "_id": "payments",
  "label": "Payments",
  "emoji": "💰",
  "order": 3,
  "is_active": true,
  "created_by": "ho@katyayaniorganics.com",
  "updated_by": "ho@katyayaniorganics.com",
  "created_at": "2026-10-13T06:30:00.000Z",
  "updated_at": "2026-10-13T06:30:00.000Z"
}
```

| Field | Rule |
|---|---|
| `key` (on add; `_id` after) | 2–41 characters: lowercase letters, digits or `_`, starting with a letter. **Cannot change** |
| `label` | 1–40 characters — the chip text |
| `emoji` | Optional, up to 16 characters; `null` clears it |
| `order` | Integer, lower shows first. Default `0` |
| `is_active` | `false` hides the section **and every FAQ in it** from the app. Default `true` |

| Method | Path | Capability | Does |
|---|---|---|---|
| `GET` | `/` | `content.read` | Every section in display order (a plain array, not paged). Query: `is_active` (`true`/`false`; absent = both) |
| `GET` | `/:key` | `content.read` | One section |
| `POST` | `/` | `content.write` | Add. Body: `key`, `label` required; `emoji`, `order`, `is_active` optional |
| `PATCH` | `/:key` | `content.write` | Edit any of `label`, `emoji`, `order`, `is_active` |
| `DELETE` | `/:key` | `content.write` | Delete an **empty** section → `{ "deleted": true }`. One with FAQs is refused: move or delete them first, or switch it off |

A section with no active FAQ is not shown in the app, even when switched on.

## FAQs — `/api/v2/admin/faqs`

```json
{
  "_id": "6c1f6d0e-5b7a-4a51-9a9a-2f1c3e8d7b10",
  "category": "payments",
  "q": "Is TDS deducted?",
  "a": "Yes, TDS applies as per law on commission. Keep your PAN updated to avoid higher deduction.",
  "q_key": "is tds deducted?",
  "order": 4,
  "is_active": true,
  "created_by": "ho@katyayaniorganics.com",
  "updated_by": "ho@katyayaniorganics.com",
  "created_at": "2026-10-12T06:30:00.000Z",
  "updated_at": "2026-10-12T06:30:00.000Z"
}
```

| Field | Rule |
|---|---|
| `category` | The key of an existing section (switched-off is fine — fill it before turning it on). Changing it moves the FAQ |
| `q` | 3–300 characters. Must be new: the same question with other case or spacing is refused |
| `a` | 1–2000 characters, plain text |
| `order` | Integer, lower shows first within the app's list. Default `0` |
| `is_active` | `false` hides it from the app without deleting it. Default `true` |
| `q_key` | Set by the server; read-only |

| Method | Path | Capability | Does |
|---|---|---|---|
| `GET` | `/` | `content.read` | Page of FAQs. Query: `page`, `limit` (≤ 200), `sort` (`order`, `-order`, `created_at`, `-created_at` (default), `updated_at`, `-updated_at`), `category` (a section key), `is_active` (`true`/`false`; absent = both) |
| `GET` | `/:id` | `content.read` | One FAQ |
| `POST` | `/` | `content.write` | Add. Body: `category`, `q`, `a` required; `order`, `is_active` optional |
| `PATCH` | `/:id` | `content.write` | Edit any of `category`, `q`, `a`, `order`, `is_active` |
| `DELETE` | `/:id` | `content.write` | Delete for good → `{ "deleted": true }` |

The list returns `{ items, page, limit, total, has_more }` inside `data`.

## Errors

| Status | `error.code` | When |
|---|---|---|
| 400 | `VALIDATION_FAILED` | A field breaks a rule above, `:id` is not a UUID, `:key` is not a section key, or a FAQ's `category` is not an existing section |
| 404 | `NOT_FOUND` | No section or FAQ with that key / id |
| 409 | `FAQ_SECTION_EXISTS` | A section with that key already exists |
| 409 | `FAQ_SECTION_IN_USE` | Deleting a section that still has FAQs |
| 409 | `FAQ_EXISTS` | The question is already in the FAQs (add, or edit to an existing question) |
