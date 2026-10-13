# Docs

Contract docs, one per feature, named by who reads them:

- `*-APP.md` — the Vistaar mobile app developer.
- `*-HO.md` — the HO portal developer.
- no suffix — shared ground (`DATABASE.md`, `PROD-CHECKLIST.md`).

| Doc | For | What |
|---|---|---|
| [AUTH-APP.md](./AUTH-APP.md) | app | Phone + OTP login, sessions, `GET /me` status screen |
| [ONBOARDING-APP.md](./ONBOARDING-APP.md) | app | Dynamic onboarding form, saves, uploads, submit |
| [ONBOARDING-HO.md](./ONBOARDING-HO.md) | HO portal | Access, pipeline, KYC review, approval, form editor, settings |
| [CART-APP.md](./CART-APP.md) | app | Cart and Checkout screens, "Ordering for" |
| [DRAFT-ORDER-APP.md](./DRAFT-ORDER-APP.md) | app | Saved Carts, "Save for later" |
| [LEADS-APP.md](./LEADS-APP.md) | app | Add lead (consent, phone check), Leads list / board, Lead detail, Home "follow-ups due" |
| [LEADS-HO.md](./LEADS-HO.md) | HO portal | Leads screen (cards, list, drawer), farmer-consent wording, lead owner |
| [DATABASE.md](./DATABASE.md) | both | Every collection this service reads or writes |
| [PROD-CHECKLIST.md](./PROD-CHECKLIST.md) | backend | What must exist in production before a feature goes live |

Every response is `{ "success": true, "data": … }` or
`{ "success": false, "requestId": "…", "error": { "code", "message", "details" }, "path", "timestamp" }`.
Lists put `{ items, page, limit, total, has_more }` inside `data`.
