Now simplify the repository to use this pure function instead of the raw aggregation pipeline:

Now simplify the service since `record` returns the list directly:

Now let's write the tests: a pure domain spec, a repository spec (mocked model, matching repo convention), and a service spec.

I'll add the recent-search domain tests into this existing spec file, plus new repository/service spec files.

Now the repository spec, mocked model following the `story-content.repository.spec.ts` fake-query pattern:

Now the service spec:

Now run typecheck, lint, and the full test suite.

Clean. Now run the full test suite to confirm everything passes.

Right — `record` throws synchronously since it's not `async`, so `expect(...).rejects` doesn't catch it. Fix the test to use `.toThrow` instead.

toThrow doesn't support objectContaining matching that way. Simplify with try/catch.

Lint clean. Run the full suite once more plus typecheck to finalize.

All 122 suites / 1324 tests pass, typecheck and lint clean.

## The endpoints

All three are under the app's partner auth (Bearer token from login) — the partner is identified from the token, never from the request body. Base path: `/api/v2`.

### 1. `GET /api/v2/catalog/recent-searches`
**Kya karta hai:** Logged-in partner ke saare recent search terms laata hai, newest-first order mein (max 10).

- **Request:** No body/params. Header: `Authorization: Bearer <token>`.
- **Response 200:**
```json
{ "success": true, "data": ["humic acid", "urea", "dap"] }
```

### 2. `POST /api/v2/catalog/recent-searches`
**Kya karta hai:** Jo term partner ne search kiya, usko record karta hai — list ke top pe le aata hai. Agar same term (case-insensitive) pehle se list mein hai, to wo duplicate nahi banta, bas top pe move ho jaata hai. List 10 terms tak capped hai — purana sabse neeche wala drop ho jaata hai. Response mein updated list wapas milti hai.

- **Request:**
```json
POST /api/v2/catalog/recent-searches
{ "term": "humic acid" }
```
- **Response 200:**
```json
{ "success": true, "data": ["humic acid", "urea", "dap"] }
```
- **Error (blank/whitespace-only term) 400:**
```json
{ "success": false, "error": "SEARCH_TERM_REQUIRED", "message": "Please enter a search term." }
```
- Throttled: 60 calls/minute per partner — looping client ko rokta hai, normal usage affect nahi hota.

### 3. `DELETE /api/v2/catalog/recent-searches`
**Kya karta hai:** Partner ki poori recent-search list clear kar deta hai.

- **Request:** No body.
- **Response:** `204 No Content`.

## Tests added
- `catalog.domain.spec.ts` — pure logic: new term to front, case-insensitive dedupe, cap at 10 dropping the oldest.
- `recent-search.repository.spec.ts` — read/write/clear against a mocked Mongo model.
- `recent-search.service.spec.ts` — trims input, rejects a blank term before touching the repository, delegates list/clear.

Still open from before: `docs/CATALOG-APP.md` documentation entry for the mobile app team — want that added too?