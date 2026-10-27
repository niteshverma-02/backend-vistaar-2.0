# Docs

Contract docs, one per feature, named by who reads them:

- `*-APP.md` — the Vistaar mobile app developer.
- `*-HO.md` — the HO portal developer.
- no suffix — shared ground (`DATABASE.md`, `PROD-CHECKLIST.md`).

| Doc | For | What |
|---|---|---|
| [AUTH-APP.md](./AUTH-APP.md) | app | Phone + OTP login, sessions, `GET /me` status screen (timeline, reporting officer) |
| [CUSTOMER-SESSION-APP.md](./CUSTOMER-SESSION-APP.md) | app | The partner's ko-sales customer pass (Customer Session Phase 2): get, refresh on ko-sales, logout |
| [ONBOARDING-APP.md](./ONBOARDING-APP.md) | app | Dynamic onboarding form, saves, uploads, submit; Edit Profile (`PATCH /me`), bank account change |
| [ONBOARDING-HO.md](./ONBOARDING-HO.md) | HO portal | Access, pipeline, KYC review, verification calls, approval, name and bank changes, form editor, settings |
| [CART-APP.md](./CART-APP.md) | app | Cart and Checkout screens, "Ordering for" |
| [DRAFT-ORDER-APP.md](./DRAFT-ORDER-APP.md) | app | Saved Carts, "Save for later" |
| [LEADS-APP.md](./LEADS-APP.md) | app | Add lead (consent, phone check, **farmer OTP — mandatory, breaking**), Leads list / board, Lead detail, Home "follow-ups due" |
| [LEADS-HO.md](./LEADS-HO.md) | HO portal | Leads screen (cards, list, drawer), farmer-consent wording, lead owner |
| [CUSTOMERS-HO.md](./CUSTOMERS-HO.md) | HO portal | Every partner's customers with their business; cards; one customer |
| [CUSTOMERS-APP.md](./CUSTOMERS-APP.md) | app | Customers list, tiles, detail; a lead becomes a customer on its first confirmed order |
| [ORDER-EVENTS.md](./ORDER-EVENTS.md) | order service (TL) | The confirmed-order call that turns a lead into a customer |
| [VISTAAR-RADAR-APP.md](./VISTAAR-RADAR-APP.md) | app | Nearby radar: my farmers, KKD leads and org customers per pincode, KKD stores; Add as lead from the radar; how farmers get a place |
| [TODAY-APP.md](./TODAY-APP.md) | app | Home's Today's tasks: follow-ups due, saved carts to remind, events, orders to confirm |
| [KKD-ACTIVITY-APP.md](./KKD-ACTIVITY-APP.md) | app | KKD & App activity: my farmers' store walk-ins, store orders, crop advice, app / website orders, app opens, abandoned carts; tiles; KKD stores within 50 km |
| [BANNERS-APP.md](./BANNERS-APP.md) | app | Home carousel banners for the partner's cohort |
| [BANNERS-HO.md](./BANNERS-HO.md) | HO portal | Add, schedule, target, reorder and delete Home banners |
| [ORDERS-APP.md](./ORDERS-APP.md) | app | My orders: list by stage / dates, details, tracking steps, each order's commission (read from `orders_v2`) |
| [ORDERS-HO.md](./ORDERS-HO.md) | HO portal | Every partner's orders, filters, one order with its commission |
| [COMMISSION-LOGIC.md](./COMMISSION-LOGIC.md) | both, Finance | The commission rules: base, slabs, plans per earning cohort (fixed / slabs, minimum order), statuses, wallet maths incl. gig pay, TDS |
| [COMMISSION-APP.md](./COMMISSION-APP.md) | app | Commission summary, ledger, "My plan" (`my_plan`, by earning cohort); wallet and withdrawals; commission statement and TDS reports |
| [MY-PERFORMANCE-APP.md](./MY-PERFORMANCE-APP.md) | app | My Performance by period; tier, lifecycle stage, health score (Home / Profile) |
| [COMMISSION-HO.md](./COMMISSION-HO.md) | HO portal | Commission plans (per partner type or earning cohort), payouts (approve, bank file, UTR), TDS and Form 16A, a partner's commission / performance / target, commission settings |
| [ATTENDANCE-APP.md](./ATTENDANCE-APP.md) | app | Punch in / out, today's state, monthly log and summary |
| [ATTENDANCE-HO.md](./ATTENDANCE-HO.md) | HO portal | Day board across partners, 14-day trend, one partner's month |
| [TESTIMONIALS-APP.md](./TESTIMONIALS-APP.md) | App | Send a farmer testimonial (video / photo / quote) with consent; my submissions; the library |
| [TESTIMONIALS-HO.md](./TESTIMONIALS-HO.md) | HO portal | Partner submissions: approve, reject, remove, consent withdrawal; and Vistaar's testimonials filed by HO |
| [STORIES-APP.md](./STORIES-APP.md) | app | My Story: save / list / re-share / delete stories, images, festivals, farmer stories |
| [STORIES-HO.md](./STORIES-HO.md) | HO portal | Festivals, ready-made farmer stories, sharing activity, partners' saved stories |
| [CARTS-HO.md](./CARTS-HO.md) | HO portal | Partners' open carts and saved carts (read-only) |
| [EVENTS-APP.md](./EVENTS-APP.md) | app | Farmer events for my cohort, register / give back a seat (also My Story meetings) |
| [EVENTS-HO.md](./EVENTS-HO.md) | HO portal | Event calendar: add, schedule, target, seats, who registered |
| [MEETINGS-APP.md](./MEETINGS-APP.md) | app | My farmer meetings: schedule, invite, attendance and walk-ins, capture leads, cancel / complete |
| [MEETINGS-HO.md](./MEETINGS-HO.md) | HO portal | Partners' farmer meetings (read-only): list, summary cards, one meeting with attendees |
| [GIGS-APP.md](./GIGS-APP.md) | app | Paid meeting gigs: available / mine / history, accept, give back, GPS check-in, farmers, photos, submit, pay |
| [GIGS-HO.md](./GIGS-HO.md) | HO portal | Post, edit, assign, reopen, cancel gigs; payout fixed or by the taker's earning cohort; review check-in, farmers and photos; approve / reject; gig settings |
| [TERMS-APP.md](./TERMS-APP.md) | app | The Vistaar partner T&C document link for Privacy & Terms and the login screen (public) |
| [TERMS-HO.md](./TERMS-HO.md) | HO portal | Add, edit, switch and delete versions of the Vistaar partner T&C (shared `terms_and_conditions`) |
| [FAQS-APP.md](./FAQS-APP.md) | app | Help FAQs and their sections for the /faqs screen (`GET /faqs`) |
| [FAQS-HO.md](./FAQS-HO.md) | HO portal | Manage FAQ sections and the FAQs in them |
| [INFO-PAGES-APP.md](./INFO-PAGES-APP.md) | app | About Vistaar, About Katyayani and Contact Us text and HO contacts (public) |
| [INFO-PAGES-HO.md](./INFO-PAGES-HO.md) | HO portal | Edit About Vistaar, About Katyayani and Contact Us |
| [FEEDBACK-APP.md](./FEEDBACK-APP.md) | app | Feedback screen: NPS + reasons + comment + app stars, Suggest a product, HO-edited chips |
| [FEEDBACK-HO.md](./FEEDBACK-HO.md) | HO portal | NPS dashboard, answers list, detractor call-backs, reason chips, product suggestions |
| [EARNINGS-APP.md](./EARNINGS-APP.md) | app | The partner's earning cohort and its coin / gig rules on `GET /me`; what it changes in commission ("My plan") and meeting-gig pay ("Your rate"); farmer OTP on lead add (breaking); my rewards and coin / gig totals |
| [EARNINGS-HO.md](./EARNINGS-HO.md) | HO portal | Earning cohorts (conditions + catalog, legacy filters, priority, default, archive), a partner's cohort history, commission plan and meeting-gig payout per cohort, coin / gig rules from the catalog; the rewards desk (approve / reject, bulk, totals) |
| [DATABASE.md](./DATABASE.md) | both | Every collection this service reads or writes |
| [TEST-DATA.md](./TEST-DATA.md) | everyone testing on beta | Test partners and farmers, what each is for, how to seed and remove them |
| [PROD-CHECKLIST.md](./PROD-CHECKLIST.md) | backend | What must exist in production before a feature goes live |
| [PERFORMANCE.md](./PERFORMANCE.md) | backend | Measured capacity, latency, and the optimisations behind them |

Every response is `{ "success": true, "data": … }` or
`{ "success": false, "requestId": "…", "error": { "code", "message", "details" }, "path", "timestamp" }`.
Lists put `{ items, page, limit, total, has_more }` inside `data`.
