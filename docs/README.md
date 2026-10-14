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
| [CUSTOMERS-APP.md](./CUSTOMERS-APP.md) | app | Customers list, tiles, detail; a lead becomes a customer on its first confirmed order |
| [ORDER-EVENTS.md](./ORDER-EVENTS.md) | order service (TL) | The confirmed-order call that turns a lead into a customer |
| [RADAR-APP.md](./RADAR-APP.md) | app | Nearby radar: my customers and open leads within N km; how farmers get a place |
| [TODAY-APP.md](./TODAY-APP.md) | app | Home's Today's tasks: follow-ups due, saved carts to remind, events, orders to confirm |
| [BANNERS-APP.md](./BANNERS-APP.md) | app | Home carousel banners for the partner's cohort |
| [BANNERS-HO.md](./BANNERS-HO.md) | HO portal | Add, schedule, target, reorder and delete Home banners |
| [ORDERS-APP.md](./ORDERS-APP.md) | app | My orders: list by stage / dates, details, tracking steps, each order's commission (read from `orders_v2`) |
| [ORDERS-HO.md](./ORDERS-HO.md) | HO portal | Every partner's orders, filters, one order with its commission |
| [COMMISSION-LOGIC.md](./COMMISSION-LOGIC.md) | both, Finance | The commission rules: base, slabs, statuses, wallet maths, TDS |
| [COMMISSION-APP.md](./COMMISSION-APP.md) | app | Commission summary, ledger, plans; wallet and withdrawals; commission statement and TDS reports |
| [MY-PERFORMANCE-APP.md](./MY-PERFORMANCE-APP.md) | app | My Performance by period; tier, lifecycle stage, health score (Home / Profile) |
| [COMMISSION-HO.md](./COMMISSION-HO.md) | HO portal | Commission plans, payouts (approve, bank file, UTR), TDS and Form 16A, a partner's commission / performance / target, commission settings |
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
| [TEST-DATA.md](./TEST-DATA.md) | everyone testing on beta | Test partners and farmers, what each is for, how to seed and remove them |
| [PROD-CHECKLIST.md](./PROD-CHECKLIST.md) | backend | What must exist in production before a feature goes live |
| [PERFORMANCE.md](./PERFORMANCE.md) | backend | Measured capacity, latency, and the optimisations behind them |

Every response is `{ "success": true, "data": … }` or
`{ "success": false, "requestId": "…", "error": { "code", "message", "details" }, "path", "timestamp" }`.
Lists put `{ items, page, limit, total, has_more }` inside `data`.
