# Terms and conditions — HO portal contract

The Vistaar partner T&C, kept in the shared `terms_and_conditions` collection
next to Krishi Sampark (`TOC-1`), B2B Portal (`TOC-2`) and RLM (`TOC-3`). Vistaar's
T&C is one row: a title and a link to the document; editing it keeps the row and
raises its version. One Vistaar row is
**active** — the one partners see. These routes see and change Vistaar's rows
only, and need the company SSO token:

| Capability | Allows |
|---|---|
| `content.read` | List and open versions |
| `content.write` | Add, edit, switch on/off and delete versions |

The app sees a change within a minute.

## Row

```json
{
  "_id": "6a6373a1c7648e3c23ed9e01",
  "toc_id": "TOC-4",
  "title": "Vistaar Partner T&C",
  "link": "https://storage.googleapis.com/micro-dealer.appspot.com/toc%2FVistaar_Partner_T%26C.docx",
  "profiles": ["vistaar"],
  "is_active": true,
  "__v": 0
}
```

**Version** = `__v + 1` (`__v` is the counter already on every row). Editing a
version's text, title or link keeps its `toc_id` and raises `__v` by one;
switching it on or off does not. A new `TOC-n` is only for the first T&C or a
deliberate fresh start.

| Field | Rule |
|---|---|
| `toc_id` | Set by the server: the next `TOC-n` in the whole collection. Never changes |
| `title` | 1–120 characters |
| `link` | https URL of the document (upload it to the bucket first, e.g. `toc/`), up to 1000 characters |
| `is_active` | `true` makes it the version partners see **and switches every other Vistaar version off**. Default `true` on add |
| `profiles` | Always `["vistaar"]`; read-only |

## Routes — `/api/v2/admin/terms-and-conditions`

| Method | Path | Capability | Does |
|---|---|---|---|
| `GET` | `/` | `content.read` | Vistaar's versions, paged, newest first. Query: `is_active` (`true`/`false`), `sort` (`-_id` default, `_id`, `title`, `-title`), `page`, `limit` |
| `GET` | `/:toc_id` | `content.read` | One version |
| `POST` | `/` | `content.write` | Add a version. Body: `title`, `link`, optional `is_active` |
| `PATCH` | `/:toc_id` | `content.write` | Change any of `title`, `link`, `is_active`. Switching one on switches the others off (roll back to an older version this way) |
| `DELETE` | `/:toc_id` | `content.write` | Delete a **switched-off** version → `{ "deleted": true }` |
| `GET` | `/:toc_id/text` | `content.read` | The version's text for the editor → `{ toc_id, version, text }` (`version` = its `__v`). **409 `TERMS_NOT_EDITABLE`** if its document was uploaded, not written in the editor |
| `PUT` | `/:toc_id/text` | `content.write` | **Save edited text on the same `TOC-n`**: the server remakes the .docx, points `link` at it and raises `__v` by one. Body: the text (below) + `version` (the `__v` you opened). **409 `VERSION_CONFLICT`** if someone saved first. Works on an uploaded-file version too — it becomes editable |
| `POST` | `/compose` | `content.write` | The **first** T&C written as text (or a deliberate fresh start): makes the .docx and adds a **new** `TOC-n`. Body: the text (below) + optional `is_active` (default `true`) |

## Text editor

The row holds only a title and a link, so the editable text is kept **inside
the .docx** the server makes (a custom XML part). `GET /:toc_id/text` reads it
back, so any version written in the editor opens again; saving it
(`PUT /:toc_id/text`) keeps the `toc_id` and raises its version. The old
document file is left in the bucket but no row points at it. A document uploaded by link
(or edited in Word afterwards) has no such text, or a stale one: start from an
editor-made version or a blank page.

```json
{
  "title": "Vistaar Privacy & Terms",
  "intro": "Privacy Policy and Partner Terms …",
  "sections": [
    {
      "heading": "What we collect and why",
      "body": null,
      "points": [],
      "items": [{ "title": "Bank", "detail": "Account number, IFSC, UPI ID", "purpose": "To pay your commission" }]
    },
    { "heading": "Vistaar Partner Agreement", "body": null, "points": ["Commission is earned only on …"], "items": [] }
  ],
  "is_active": true
}
```

| Field | Rule |
|---|---|
| `title` | 1–120 — also the row's title |
| `intro` | Up to 1000, or `null` |
| `sections[]` | 1–40, in order |
| `sections[].heading` | 1–120 |
| `sections[].body` | Up to 4000, or `null`; a blank line starts a new paragraph |
| `sections[].points[]` | Up to 30 numbered points, each 1–1000 |
| `sections[].items[]` | Up to 20 titled rows `{ title 1–80, detail 1–600, purpose ≤ 400 or null }` — printed as title, detail, "Used: purpose" |

Text is trimmed and empty points dropped before the document is made.

## Errors

| Status | `error.code` | When |
|---|---|---|
| 400 | `VALIDATION_FAILED` | Bad field, or `:toc_id` not `TOC-n` |
| 404 | `NOT_FOUND` | No such Vistaar version (another app's `TOC-n` is a 404 too) |
| 409 | `TERMS_IN_USE` | Deleting the active version — make another active or switch it off first |
| 503 | `TERMS_ID_UNAVAILABLE` | Could not get a free `TOC-n` after several tries; try again |
| 409 | `VERSION_CONFLICT` | `PUT /:toc_id/text` made on an older version — reload and redo |
| 409 | `TERMS_NOT_EDITABLE` | `GET /:toc_id/text` on a version whose document was not written in the editor |
| 503 | `UPLOADS_NOT_CONFIGURED` | `POST /compose` while the server cannot store files |
