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
| [BANNERS-APP.md](./BANNERS-APP.md) | app | Home carousel banners for the partner's cohort |
| [BANNERS-HO.md](./BANNERS-HO.md) | HO portal | Add, schedule, target, reorder and delete Home banners |
| [ORDERS-APP.md](./ORDERS-APP.md) | app | My orders: list by stage, details, tracking steps (read from `orders_v2`) |
| [ATTENDANCE-APP.md](./ATTENDANCE-APP.md) | app | Punch in / out, today's state, monthly log and summary |
| [ATTENDANCE-HO.md](./ATTENDANCE-HO.md) | HO portal | Day board across partners, 14-day trend, one partner's month |
| [TESTIMONIALS-HO.md](./TESTIMONIALS-HO.md) | HO portal | Vistaar's product testimonials (source vistaar): review, approve, remove, add |
| [STORIES-APP.md](./STORIES-APP.md) | app | My Story: save / list / re-share / delete stories, images, festivals, farmer stories, crop calendar (`GET /crop-calendar` too) |
| [STORIES-HO.md](./STORIES-HO.md) | HO portal | Festivals, ready-made farmer stories, crop calendar, sharing activity, partners' saved stories |
| [EVENTS-APP.md](./EVENTS-APP.md) | app | Farmer events for my cohort, register / give back a seat (also My Story meetings) |
| [EVENTS-HO.md](./EVENTS-HO.md) | HO portal | Event calendar: add, schedule, target, seats, who registered |
| [TERMS-APP.md](./TERMS-APP.md) | app | The Vistaar partner T&C document link for Privacy & Terms and the login screen (public) |
| [TERMS-HO.md](./TERMS-HO.md) | HO portal | Add, edit, switch and delete versions of the Vistaar partner T&C (shared `terms_and_conditions`) |
| [FAQS-APP.md](./FAQS-APP.md) | app | Help FAQs and their sections for the /faqs screen (`GET /faqs`) |
| [FAQS-HO.md](./FAQS-HO.md) | HO portal | Manage FAQ sections and the FAQs in them |
| [INFO-PAGES-APP.md](./INFO-PAGES-APP.md) | app | About Vistaar, About Katyayani and Contact Us text and HO contacts (public) |
| [INFO-PAGES-HO.md](./INFO-PAGES-HO.md) | HO portal | Edit About Vistaar, About Katyayani and Contact Us |
| [DATABASE.md](./DATABASE.md) | both | Every collection this service reads or writes |
| [PROD-CHECKLIST.md](./PROD-CHECKLIST.md) | backend | What must exist in production before a feature goes live |
| [PERFORMANCE.md](./PERFORMANCE.md) | backend | Measured capacity, latency, and the optimisations behind them |

Every response is `{ "success": true, "data": … }` or
`{ "success": false, "requestId": "…", "error": { "code", "message", "details" }, "path", "timestamp" }`.
Lists put `{ items, page, limit, total, has_more }` inside `data`.
