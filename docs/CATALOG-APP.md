# Catalog — app contract

The app lists and prices products from the B2B marketplace directly; this
service only remembers a partner's recent product-search terms for the Shop
screen's search box. Newest first, deduped case-insensitively, capped at 10 —
an older repeat of a term just moves back to the top.

## `GET /api/v2/catalog/recent-searches`

My recent search terms.

```json
{ "success": true, "data": ["humic acid", "urea", "dap"] }
```

## `POST /api/v2/catalog/recent-searches`

Record a term just searched; returns the updated list. Limited to 60 calls a
minute per partner.

```json
// request
{ "term": "humic acid" }
```

```json
// response
{ "success": true, "data": ["humic acid", "urea", "dap"] }
```

**400 `SEARCH_TERM_REQUIRED`** — the term was blank or only whitespace.

## `DELETE /api/v2/catalog/recent-searches`

Clears my recent searches. `204 No Content`.
