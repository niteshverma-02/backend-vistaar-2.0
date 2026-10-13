# Terms and conditions — app contract

The Vistaar partner T&C: a title and a link to the full document. HO adds and
switches versions; the app always gets the one active now.

**Public** — the login screen links to it before anyone has a token. Limited to
600 reads a minute per IP; an HO change reaches the app within a minute.

## `GET /api/v2/terms-and-conditions`

```json
{
  "success": true,
  "data": {
    "toc_id": "TOC-6",
    "version": 2,
    "title": "Vistaar Privacy & Terms",
    "link": "https://storage.googleapis.com/micro-dealer.appspot.com/toc%2FVistaar_Partner_T%26C.docx"
  }
}
```

| Field | Use |
|---|---|
| `toc_id` | Which T&C this is — it stays the same when HO edits the text |
| `version` | 1, 2, 3 … — goes up each time HO edits it. Keep `toc_id` + `version` with a partner's acceptance; a higher `version` than the one accepted means the text changed |
| `title` | The link text / page title |
| `link` | Open the document (docx or pdf) in the browser or a viewer |

**404 `NOT_FOUND`** — HO has not added one yet: keep the built-in summary text.

## What changed from before

The T&C is no longer sectioned text (`sections[]`, `intro`, `contact_email`,
`effective_from`) and there is no `privacy_policy` here, nor
`GET /terms-and-conditions/:kind`. It is the shared `terms_and_conditions`
row, the same shape Krishi Sampark, B2B Portal and RLM use: a title and a
document link.

- Privacy & Terms page: open `link` — one document holds the privacy policy,
  the partner terms summary and the Partner Agreement.
- `TermsDoc.documentUrl` ← `link`, `TermsDoc.id` ← `toc_id`.
