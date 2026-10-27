# Vistaar 2.0 — Overall Product Flow (PRD)

*As of 22 October 2026, latest `beta` (`5113b6c`). File: `docs/VISTAAR-PRD-OVERALL-FLOW.md`. Non-technical: this document describes what the product does and how its flows connect, for business readers — HO, business, and the app and portal teams. It covers the Vistaar app (the partner's phone) and the HO portal (Head Office's web screens). Technical detail is in `docs/VISTAAR-PRD-TECHNICAL.md` and `docs/VISTAAR-PRD-DATABASE.md`.*

---

## 1. What Vistaar 2.0 is

Vistaar 2.0 is Katyayani's rebuilt partner program: a network of field partners who promote Katyayani products to farmers in their area and earn on the orders they bring in and the work they do. The old Vistaar (KSS app) keeps running on its own; every new partner and every new flow lives in Vistaar 2.0.

Three people meet in this product:

- **The partner.** A person from the field who applies through the Vistaar app, completes onboarding and KYC, gets approved by Head Office, and then works daily: adding farmers, following up, placing orders for them, running meetings, and earning. After approval they keep their own profile up to date; a new name or a new bank account waits for HO's approval. Every partner gets a unique VST id.
- **The farmer.** The partner's customer. The farmer never uses the Vistaar app; the partner adds them (the farmer confirms with an OTP sent to their own phone), records their consent, follows up, and orders on their behalf. A farmer whose first order is confirmed becomes that partner's customer. What the farmer does on their own — at a Katyayani Krishi Kendra (KKD) store or on the Katyayani app and website — is shown to their partner so they can follow up.
- **Head Office (HO).** The team that runs the program from the HO portal: it decides who becomes a partner (calling applicants to verify them and checking their documents), groups partners into earning cohorts and sets their rates and rewards, approves payouts, rewards and changes to a partner's name or bank account, and manages all the content the app shows.

Two surfaces sit on one backend:

- **The Vistaar app** — the partner's whole world: onboarding, their profile, farmers, orders, their farmers' KKD and app activity, earnings, rewards, and engagement tools.
- **The HO portal** — the operations desk: the partner pipeline, earning cohorts, approvals, money, and content management. Vistaar's screens live inside the same portal HO already uses for other programs. HO staff sign in with the company's single sign-on, and what each person can see and do depends on their capabilities (today: Offline Head, Super Admin, Admin).

---

## 2. Becoming a partner

### Signing up

Partners are not company staff — they sign in with their mobile number and a 4-digit OTP by SMS (India +91 numbers only for now). The Vistaar app has two doors:

- **Log in** — for an existing partner. A number with no account is told "No account with this number" and offered Join Vistaar.
- **Join Vistaar** — for a new partner. The partner chooses their partner type (cohort), enters their mobile, answers the first form steps (personal, location, details), reviews them, then verifies the phone with the OTP. On the first successful verify the account becomes real: the partner gets their VST id and is linked to the company's person record, and the answers are saved.

Sessions last 12 hours and renew quietly for up to 30 days; several devices can be signed in at once. OTP abuse is limited: 3 SMS and 5 verify tries per 10 minutes. On every app start the app asks "where am I?" and routes the partner to the right place: pick a type, resume the form, fix requested changes, the "application with Katyayani" status screen, home (approved), the rejected screen, or the blocked screen. **Being logged in does not mean approved — ordering and most features only unlock once HO approves.**

**The application tracker.** The status screen shows five steps, always in this order: **Applied** (the form was first submitted) → **Verification call** (HO has logged a call that verified the partner) → **Documents review** (both of those have happened) → **Approved** → **Active** (approved and still working). A later step ticked always ticks the earlier ones, so the tracker never has gaps — even for partners approved before calls were logged. A blocked partner keeps *Approved* ticked but loses *Active*.

### The onboarding form and KYC

The form is not hard-coded in the app. HO designs one form per partner type in the portal, and the app renders it: personal details, location (pincode prefills state and district), business details, then — after the OTP — the KYC checklist and the agreement. Progress saves step by step; a partner who closes the app resumes exactly where they left off, and may still switch partner type before first submit.

KYC documents (PAN, Aadhaar, bank proof, selfie, etc.) are uploaded as photos or PDFs up to 10 MB; some also take the document number (PAN format is checked). GPS of the shop or farm is always optional. Submitting sends the application for review and locks the form.

**One Aadhaar, one PAN, one partner.** An Aadhaar or PAN number that is already on another Vistaar partner's form is refused when it is saved, and again at submit: "This Aadhaar (or PAN) is already used by another Vistaar account. Contact Katyayani support." The other account and the number itself are never shown. Aadhaar is compared on its 12 digits (spaces and dashes ignored), PAN whatever the capital letters; saving your own number again is fine. HO's own corrections to a form follow the same rule. For clashes the check could not stop — applications saved before it existed, or two saves at the same moment — HO sees a warning on the partner's page (section 6).

### The pipeline

Behind the status screen, every partner is in exactly one stage:

**signed_up → onboarding → kyc_review → approved**, with three side states: **changes_requested**, **rejected**, **blocked**.

- *signed_up*: OTP verified, form not started. Starting the form moves to *onboarding*; submitting moves to *kyc_review*.
- From *kyc_review*, HO can **approve**, **request changes** (the partner sees HO's notes, only the flagged fields reopen, and resubmitting returns to *kyc_review*), or **reject** (with a reason the partner sees; HO can later reopen a rejected partner back into *onboarding*).
- **blocked** can happen from anywhere — login is refused; unblocking returns the partner to wherever they were.

**Verification calls.** Before deciding, HO calls the applicant and logs each call — *reached*, *not reached* or *verified* — with an optional short note. Calls can be logged at any stage before a decision (signed up, onboarding, KYC review, changes requested), not once a partner is approved, rejected or blocked. A call is not a stage: it never moves the pipeline. The first *verified* call ticks the tracker's Verification call step.

Approval is allowed only when every required document is verified. On approval, the form answers are mapped onto the partner's profile (name, village, district, state, pincode and so on — state and district standardised from the pincode), the partner is placed in an **earning cohort** (section 4) — which can also pay a welcome reward — and the partner lands on Home.

### After approval — the partner's own profile

An approved partner edits their own profile in the app: email, language, village, district, state, pincode and a profile photo (an image they upload themselves, not a PDF). A blocked or not-yet-approved partner cannot.

- **A new name waits for HO.** The partner's name stays as it is until HO approves the new one (section 6); a refusal shows HO's reason in the app. Sending another name replaces one still waiting; the same name as now is ignored.
- **The pincode fills in the place.** A pincode Katyayani's list knows sets the state and district by itself; an unknown pincode keeps what the partner typed.
- **A new place can change the earning cohort at once.** A new state, district or pincode works the partner's earning cohort (section 4) out again before the app gets its answer, so "How to earn" already shows the cohort for the new place. A village alone changes nothing — no cohort looks at it.
- Only the partner's Vistaar profile changes; a profile edit never touches the company-wide person record.
- **Reporting officer.** Profile and Help show the partner's owner at HO — name, phone and role (Offline Head, Super Admin or Admin) — when the partner has one on record.
- A change of **bank account** is a separate request that HO approves (section 4).

---

## 3. The partner's daily work in the app

### Home and Today's tasks

Home carries the HO-managed banner carousel, the partner's standing (tier, health, monthly target), the commission strip, punch in/out — and one **Today's tasks** card that gathers everything to do now, with a total ("7 to do") or "All caught up". Tasks are, in order: follow-ups due or overdue (overdue in red), saved carts not yet reminded (urgent after 3+ idle days), events the partner holds a seat at today or tomorrow, their own meetings today or tomorrow, gigs they hold today or tomorrow, and orders placed but not yet confirmed. Tasks are live views — doing the real thing makes the task drop off by itself.

### Adding and working farmers

Only an approved partner can add farmers (and only farmers — never retailers or businesses). Adding one takes the mobile number, name, village, crops (1–10), land in acres, and optionally how they were found, expected first-order value, a follow-up and a first note.

**The farmer confirms with an OTP.** Since 16 October every new farmer must read out a code sent by SMS to their own phone before the partner can save them. The app first checks the number, then sends the code (up to 3 sends in 10 minutes), the farmer reads it out, and the save goes through within 15 minutes. This proves the farmer is real and reachable. The farmer's **consent wording** (English/Hindi, versioned by HO) is also shown with a tick box, and the exact version accepted is recorded.

**One farmer, one partner.** Before saving, the app checks the number: new (saved), already yours (updated), a Katyayani farmer from another channel that no partner holds (linked to you, never duplicated), another partner's farmer (refused — "farmer taken"), a released farmer (you can take over), a retailer or your own number (refused).

Each farmer moves through stages: **prospect → contacted → interested → negotiation → won | lost.** The partner can never set *won* — it happens automatically on the first confirmed order. A *lost* lead (reason required) can be reopened; a *won* one is fixed. Follow-ups are future-only, and the follow-up the partner sets is also copied onto Katyayani's own record of that farmer. Activities (call, visit, WhatsApp, note) are a permanent log, never edited or deleted. A call, visit or WhatsApp on a follow-up that is due or overdue completes it — and can earn a reward (section 4); so can moving a lead forward a stage.

**Keeping a farmer takes work.** A lead not worked for 15 days, or a customer with no order for 45 days (both HO-settable), becomes free for another partner to take; a blocked partner's farmers are free at once. Nothing happens at the release moment — the farmer stays until another partner actually adds them, and that new partner starts fresh at *prospect* without the old partner's notes. The app warns "Releases in N days" in the last 3 days. HO can also transfer a farmer deliberately.

A GPS fix of the farm can be recorded when adding or editing the farmer, when logging a farm visit (the best signal), or when ordering; a weaker source never overwrites a stronger one. Without a fix the farmer sits at their pincode's centre, marked approximate.

### Ordering for a farmer

The partner has **one live cart**, set either for a farmer they hold or for their **own shop stock**. Lines are product packs priced live from the catalogue — the server never trusts a phone's price — up to 100 packs, quantities capped at stock. The cart can be **saved as a draft order** for a customer (one open draft per customer; restoring re-prices at today's prices); the partner sends the WhatsApp reminder from their own phone and marks it sent. An unreminded saved cart appears as a Today task.

Orders are placed into Katyayani's shared order system — Vistaar's are the ones carrying Vistaar's own marketplace tag and the partner's VST id — and move through **placed → punched → shipped → delivered** (or **cancelled / returned**). The order system's newer status names are read onto the same stages (for example a merged or outbound-cancelled order reads as cancelled, a manifested one as punched, a partial return-to-origin as returned), and "Out for delivery" shows as its own tracking step. The partner sees their order list (filtered by status, farmer or dates) and a tracking timeline per order, with payment mode, courier and AWB, and the order's commission. Shop-stock orders show "Self (shop stock)".

**Order search.** The Orders search box finds an order by the end of the buyer's phone number (4 or more digits), by the order number, or by the buyer's name (every word typed must appear in it). It works together with the other filters and only ever searches the partner's own orders.

**Order numbers.** Vistaar's own order numbers run **KSV-1, KSV-2, …**. The app asks for one per checkout attempt — for cash on delivery when the partner taps Place order; for a prepaid order once the payment is confirmed, so a failed payment uses up no number. A retry of the same attempt (a timeout, a double tap, an app restart) always gets the same number back, a number belongs to that partner alone, and a number given out is never given again. The old Vistaar's KSV numbers are stepped over, so the series has gaps. Only approved partners get numbers. Placing the order itself from the cart (checkout) is not built yet (section 10).

**Online payment** is prepared but gated: the Pay-online screen lists only the payment apps HO has switched on for the partner's cohort (Razorpay, Cashfree, PhonePe), and a server-wide switch keeps the whole list empty until the company turns online payments on. For Razorpay the list also carries the public Key ID HO approved, which opens Razorpay's checkout; Cashfree's checkout is opened through Katyayani Utils, which holds Cashfree's keys. No secret ever reaches the phone. Taking the money itself is a separate piece, not built yet.

### KKD & App activity

A screen that shows what the partner's own farmers do **without the partner** — at a **Katyayani Krishi Kendra (KKD)** store and on the **Katyayani app or website** — so the partner knows whom to call or visit.

- **At a store:** walk-ins (entries the store turned down are left out), real sales at the store's till (company orders filed on a store are not store sales and are left out; a sale recorded in two places shows once), and crop advice the store gave — crop, problem, solution and the products recommended.
- **On the app or website:** the farmer's own orders (marked app or website), app opens (one per farmer per day) and carts left in the app, with their value.
- **Whose:** only farmers the partner holds now — open leads, customers and lost leads; a farmer transferred or released away drops out at once. Only what happened **after** this partner got the farmer is shown. Farmers are matched by their Katyayani record or, failing that, their mobile number. Any store counts, not only nearby ones.
- **Tiles** for the month: walk-ins, store orders (count and ₹), app and website orders (count and ₹), and open app carts (carts with no app order from that farmer after them).
- Each farmer's own **KKD & App** tab shows the same for that one farmer; the same data can flag, on the customers list, farmers active at a KKD or on the app in the last 7 days.
- **Stores near me:** the KKD stores within **50 km of where the partner registered** (their signup GPS, else their pincode's centre), nearest first — the stores a farmer can be sent to. With neither known, the app asks the partner to add their pincode in Edit Profile.
- **Follow-up only — no commission** is paid on any of it. Vistaar only reads these records; they belong to the order system, the franchise stores and the Katyayani app. A new entry shows within a minute; if one source can't be read, the rest still show.
- Failed, split, merged, cancelled or returned orders are not shown. Soil tests have no source yet and never appear.

### Radar, attendance, performance

- **Radar** shows, within a chosen ring (1–50 km, default 10) around the partner, their own customers and open leads (up to 500, nearest first) and the Katyayani Krishi Kendra stores in the ring — nobody else's farmers. Farmers without a precise fix are drawn as approximate dots. Actions: call, open map, view; for a store, share its address with a farmer on WhatsApp.
- **Attendance** is punch in / punch out, several sessions a day (max 10), always on server time; each punch records a location (or the registered place, marked approximate). Day statuses: not_started, on_duty, day_closed, missed_punch_out — a forgotten punch-out isn't counted. Punching out can earn an attendance-streak reward (section 4).
- **My Performance** shows delivered sales (the same numbers commission uses) against the previous period and the monthly target (default ₹1,00,000, HO can set per partner), orders, active customers, lead conversion, gigs, commission (each order at its own plan's rate), month-by-month and category breakdowns, and the partner's **tier** — Bronze / Silver / Gold / Platinum from the average delivered sales of the three completed months before this one (₹0 / 50K / 1L / 2.5L) — plus a lifecycle stage (onboarded, active, at_risk, lost) and a five-part health score.

---

## 4. Earning, rewards and money

### Three ways to earn, set by the earning cohort

A partner earns **commission** on orders, **gig ₹** for paid work, and **coins** (points) for actions. All three depend on the partner's **earning cohort** — a group HO builds for earning, separate from the partner type chosen at signup.

- HO defines each earning cohort by a short list of **conditions** (up to 12). They look at the place on the partner's **profile** (not GPS) — state, district or pincode, each "is" one value or "has any of" a list — and at what the partner holds **right now**: open leads (not won, not lost) and customers, each "at least" or "at most" a number. A cohort's conditions must **all** hold. Cohorts are checked in HO's priority order; the first one whose conditions all hold wins. The built-in **"Everyone else"** cohort has no conditions and catches anyone left.
- The partner never picks a cohort. The system places them when HO approves or unblocks them, when they change their own state, district or pincode (section 2), whenever their holdings change (adding, losing, winning, removing or being transferred a farmer), or when HO changes the cohorts. The app shows the current cohort and its rules ("How to earn") on the profile.
- Only approved partners are placed, and only placed partners earn: a partner not yet approved earns nothing from any rule. An archived cohort stops paying the moment it is archived — its partners earn on "Everyone else" until they are re-placed.
- Every stretch a partner spends in a cohort is kept, because an order earns on the cohort the partner was in **when the order was placed**.

### How commission works

The partner earns a percentage of **each order they place in the app** — for a farmer or for shop stock; a farmer's own direct orders earn nothing (nor does anything shown on the KKD & App activity screen). The base is the order's value after discounts and coins, before GST, excluding delivery charges.

Each earning cohort can have its own **commission plan** from a month onward: either a **fixed** % on every order, or **slabs** where the rate rises with the partner's delivered sales in the month (the whole month earns the slab reached). A plan can also set a **minimum order value** — smaller orders earn the "Everyone else" plan instead. A cohort without its own plan uses "Everyone else"'s plan; until HO saves an "Everyone else" plan, everyone stays on the older rates for their partner type (the PRD's draft rates, shown with a "Draft" tag until signed off). Nothing is stored per order — commission is always worked out fresh from the orders, so the numbers never drift.

Each order's commission moves **Pending** (placed) → **Confirmed** (7 days after delivery — the return window) → **Paid** (withdrawn). An order cancelled or returned inside the window becomes **Reversed**; once confirmed, the money is final — a later return takes nothing back.

### Rewards: coins and gig ₹

HO writes simple **rules** for each earning cohort. Each rule picks an event from a fixed list (a new kind of event needs a software change), the conditions it checks, and the reward — coins or gig ₹ and the amount. Ten events can pay today:

| Event | Pays at most once per | Rules can look at |
|---|---|---|
| **Farmer lead added** (after the farmer's OTP) | farmer, ever | crops, acreage, the farmer's district or state |
| **Follow-up done** — a call, visit or WhatsApp on a follow-up that is due or overdue | farmer and due day | type of contact, days overdue |
| **Lead moved forward** — prospect → contacted → interested → negotiation (won and lost never count) | farmer and stage reached | stage reached, stage before |
| **Customer ordered again** — a repeat order Katyayani confirms | order | days since the previous order |
| **Meeting attendee became a lead** (the new lead may also pay "Farmer lead added") | attendee and meeting | crops, acreage |
| **Gig work approved** — a bonus on top of the gig's own ₹ pay | gig | attendees recorded, photos |
| **Registered for an event** | event, ever | which event |
| **Attendance streak** — at punch-out, the run of unbroken field days (looked back 60 days at most) | day | streak length: "is 7" pays the day a streak reaches 7, "at least 7" pays every day it holds |
| **Partner approved** — a welcome reward | partner, ever | partner type, state |
| **Story created** — a brand-new My Story (an edit or re-share never counts) | story | template |

Follow-ups usually pay gig ₹; the other events usually pay coins — HO chooses on each rule. For each event the first matching rule of each kind pays, so one event can give one coin reward and one gig reward. Going back and doing the same thing again never pays twice: re-adding a farmer, moving a lead back and forward, or leaving and re-registering for an event. A reward waits as **pending** until HO approves or rejects it on the rewards desk; a farmer removed while their "lead added" reward is still pending has it rejected automatically. **Coins are points** — they build a balance but can't be spent or withdrawn yet. Gig ₹ joins the wallet like meeting-gig pay (below).

### The wallet and withdrawals

The wallet shows earned, withdrawable, on hold, gig earnings, the bank account payouts go to now, the TDS rate a withdrawal now would carry, and — when the partner can't withdraw — the exact reason (not approved · bank not verified · a bank-account change waiting for HO · a withdrawal already open · below minimum).

A withdrawal needs: an approved partner, a bank proof verified by HO, at least ₹500 (HO-settable), **no other open request**, and no bank-account change waiting. The amount goes on hold at once; if the request is rejected or cancelled it comes back. Statuses: **requested → approved → paid**, or **rejected / cancelled** (the partner can cancel only while *requested*). A withdrawal is never edited or erased — it is the payment record.

**TDS** (section 194H) is estimated at request and fixed at approval: **2% with a verified PAN, 20% without.** HO uploads one **Form 16A** PDF per partner per quarter, which the partner downloads from their TDS report.

### Changing the bank account

An approved partner can ask to move their payouts to a new account: account holder, account number, IFSC and a photo of a cancelled cheque or passbook.

- **Payouts keep going to the old, verified account until HO approves the new one.** While the change waits, the partner can't ask for a new withdrawal (the wallet says why); withdrawals already requested or approved are not touched.
- One change at a time: the partner can withdraw a waiting change and send another. The same account and IFSC as today is refused.
- **HO approves** it from the partner's page: the new account replaces the old one on the partner's form (a UPI ID there is kept), the new proof is marked verified, both changes go into the partner's change history (old and new), and — as with a verified KYC document — the proof is copied to the person's company-wide record, never over another portal's entry. From then on the bank file pays the new account, even for a withdrawal approved before the change.
- **HO rejects** it with a reason the partner sees; the old account stays, still verified.

### HO's side of the money

- **Withdrawals** are approved by the program heads. Flow: requested → approve (balance and bank re-checked, TDS fixed) → export a **bank file** (CSV, up to 500 rows) → pay → enter the **UTR** (bank reference, singly or 200 at a time) → paid. Reject carries a reason the partner sees.
- **Bank-account changes** are approved or rejected by the HO staff who review KYC, on the partner's page — there is no separate list of waiting changes.
- **Commission plans** are edited per earning cohort (fixed or slabs, minimum order value, month, notes, signed-off flag), with a "current rates" table that shows which cohorts use their own plan and which inherit "Everyone else". Past months are locked — they've been paid on. Full history is kept. **The "Everyone else" plan should be agreed with Finance before it is saved**, because saving it moves every approved partner's new orders.
- **Payment options and keys**: HO switches Razorpay / Cashfree / PhonePe on or off, sets labels, cohorts and order — but can never add a new gateway. An option can be switched on only once it has approved keys, except **Cashfree, which is on/off only**: Katyayani Utils holds Cashfree's keys and creates its orders, so HO enters none. **Razorpay needs only its Key ID** — Katyayani Utils creates the Razorpay order with its own secret, so the Key ID must belong to that same account. PhonePe takes its client id, version and secret. Merchant keys follow a strict four-eyes flow: one company admin submits them, the server checks them with the gateway (no money moves), and a **second, different admin** approves; secrets are never shown back. HO picks **test or live keys** on the form on every server (the form starts on live in production, test elsewhere).

### Gig pay

A meeting gig pays either a fixed ₹ HO typed on the gig, or — if HO left it empty — **the taker's cohort rate**, fixed at the moment the partner takes the gig. A "Gig work approved" rule can add bonus coins on top. Gig pay and follow-up gig rewards are earned at HO approval, but reach the wallet only once HO switches gig pay on (off until Finance confirms the TDS treatment). Until then the app shows them as approved pay to be added later.

---

## 5. Engagement tools in the app

- **My Story.** The partner composes a shareable WhatsApp-status image from template cards — six built-in layouts (product offer, farmer story, crop tip, meeting invite, festival, custom text) plus HO's own custom cards — in an HO-managed design (palette, optional background art) with festival greetings for the season. Farmer-story cards can pre-fill from real approved testimonials or HO's ready-made sample quotes; meeting invites pre-fill from upcoming events, the partner's meetings and accepted gigs. Stories save to the partner's list (max 20 — oldest drops off) and shares are counted by channel. Saving a brand-new story can earn a reward (section 4).
- **Meetings.** The partner schedules their own farmer meetings (farmer meeting, crop demo, field day, disease camp, soil health camp), invites up to 300 of their own farmers, marks attendance (walk-ins welcome, up to 300), and can **capture an interested attendee as a new lead** through the normal add-farmer rules — which can earn a reward. Lifecycle: scheduled → completed (needs at least one farmer present) or cancelled. **No delete, on purpose** — cancel keeps the record. WhatsApp invites are shared manually for now.
- **Events.** HO-run farmer events (Kisan Mela, training, webinar, field day) targeted by cohort. The partner sees what's for them, registers to take a seat (a full event says so; registering can earn a reward, once per event), and can cancel before the event starts.
- **Gigs.** Paid farmer meetings HO posts. The partner's journey: see **open** gigs for their cohort and state (with "Your rate" when the gig pays by cohort) → **accept** one (a taken gig says so; a same-day clash warns, never blocks) → **check in** at the venue on the day — check-in is never refused, but GPS problems are flagged for HO (early, late, no GPS, too far) → list the farmers who came (up to 300) and add photos (up to 6) → **submit** → HO **approves** (pay earned, plus any bonus coins a rule gives) or **rejects** (final, with reason). The partner can hand back an accepted gig only before its day.
- **Rewards.** A rewards screen shows coin balance, pending coins, approved and pending gig ₹, and each reward with the rule that earned it and what it was for (the farmer, or the order, meeting, gig, event, story or day).
- **Testimonials.** The partner records a farmer's video (≤ 90 s), photo or written quote about a product, with the farmer's versioned consent and a 1–5 star rating. The farmer must be the partner's own lead or customer. It goes to HO as **submitted**; on **approval** it appears in the Library every partner sees (and on Katyayani's product pages); **rejected** carries a reason; **removed** takes an approved one down later.
- **Feedback.** An NPS question (0–10, bucketed into detractor / passive / promoter), reason chips per bucket (HO-editable), an optional comment and app stars. **A detractor score opens a call-back for the partner's officer, due by the end of the second working day (Mon–Sat).** "Suggest a product" takes a product name, crop and monthly demand, and answers with a reference number. Caps: 10 answers and 20 suggestions per day.
- **Help and content.** FAQ sections and questions managed by HO; Terms & privacy (one versioned document, public, linked before login); three info pages — About Vistaar (how the program and earnings work), About Katyayani, Contact Us (with a live "Open now / Closed now" pill) — all editable by HO, reaching the app within a minute, with the app's bundled text as fallback. Help also shows the partner's reporting officer (section 2).

---

## 6. HO portal — the partner pipeline

The pipeline view shows counts per stage and lists partners with filters (stage, cohort, state, district, owner), search, and sorts including last login ("who has gone quiet"). The Partners directory is the approved list.

A partner's detail page brings everything to one place:

- the filled form, in exactly the version the partner submitted;
- **verification calls** — HO logs each call to the applicant (reached, not reached or verified, with a short note) at any stage before a decision; the list of calls is on the page, and the first verified call ticks the partner's application tracker (section 2);
- **per-document KYC review** — verify or reject each document, reason required to reject, only while in *kyc_review*. Verifying a standard document (Aadhaar, PAN, bank proof, selfie) also copies it to the person's org-wide record, never overwriting another portal's entry;
- a **duplicate Aadhaar / PAN warning** beside Approve — the other Vistaar partners whose form holds the same Aadhaar or PAN (the number itself is never listed). The app already refuses such a clash, so this catches applications saved before the check, or two saves at the same moment;
- the **nearby-network map** — other Vistaar partners and applicants, franchise stores, Prasar retailers and old-Vistaar outlets within a configurable radius (0.5–50 km, default 5), with a conflict warning beside Approve;
- HO's own corrections to form values (audited old vs new; a changed document goes back to pending; an Aadhaar or PAN another partner holds is refused here too), the owner, and the partner's earning-cohort history;
- for an approved partner, any **name change** waiting (section 2) and any **bank-account change** waiting, shown beside the account paid into now with its proof (section 4).

Decisions: **request changes** (notes per field; rejected documents are included automatically), **approve** (every required document must be verified first), **reject** (reason shown to the partner), **reopen**, **block / unblock**. For an approved partner: **approve or reject a new name** (approved, it becomes the partner's profile name and the name in HO's lists; a refusal carries a reason the partner sees) and **approve or reject a bank-account change** (section 4). There is no separate list of waiting name or bank changes — HO finds them on the partner's page.

A decision on a partner whose stage moved meanwhile is refused — the reviewer refreshes. The same goes for a name or bank decision when the partner changed or withdrew the request in the meantime: it applies only to the request HO saw.

---

## 7. HO portal — program operations

- **Cohorts and forms.** HO manages the partner types (create, rename, reorder, deactivate; delete only if unused) and one onboarding form per partner type. Forms are edited as drafts and **published as immutable versions** — each partner forever keeps the version they filled. Publish checks include an English label on everything and the rule that GPS can never be required.
- **Earning cohorts.** HO builds the earning cohorts — name, up to 12 conditions on place (state, district, pincode) and holdings (open leads, customers), and an optional meeting-gig rate. The portal builds the conditions form from a list of allowed fields and checks that the server sends, the same way it builds reward rules, and each cohort shows a one-line summary of its conditions. Screens still on the older filter form keep working: the server turns those filters into conditions. HO orders the cohorts by priority, archives ones no longer used (partners move to the next match; nothing is deleted), and can re-place every partner with one button. For each partner HO sees the current cohort, the facts it was based on, and the history.
- **Earning rules and the rewards desk.** For each cohort HO writes reward rules from the catalogue of ten events and their conditions (section 4), in order. Rewards from every event arrive pending in a queue, filterable by event; HO approves or rejects them one by one or up to 200 at a time, with totals of pending, approved and rejected coins and gig ₹.
- **Settings.** One screen of program dials: default owner for new signups, farmer-lead owner, lead/customer release days, nearby-check radius, farmer-consent wording (new words = new version every partner must re-accept), testimonial-consent wording, commission dials (return window, minimum withdrawal, TDS rates, monthly target), gig defaults (fallback payout, minimum farmers, photos, check-in radius, pay switch), and feedback reason chips.
- **Farmers oversight.** Every farmer every partner holds, with stage, consent version, hold and release dates, activity history, previous holders, and the farm on a map. HO can **transfer** a farmer to another approved partner (reason required, shown to the new partner); the new partner starts at *prospect*, a customer stays *won*, business history survives. The customers screen is read-only.
- **Orders, carts, attendance, meetings** — all read-only oversight. Orders with full breakdowns (by day, partner, state, product, repeat buyers) and search; carts as a window into what partners are about to buy; attendance day-boards and range views (late = first punch after 10:00, full day = 6+ hours); meetings with attendance and leads-captured counts.
- **Money desks** — withdrawals, bank-account changes, commission plans, payment options and keys, Form 16A (section 4 above).

---

## 8. HO portal — content and engagement management

- **Banners**: image (own art, 2.4:1, in-portal crop) or text banners, linked to in-app screens only, cohort-targeted, scheduled, drag-ordered; at most 10 live in the app.
- **My Story**: template cards (built-ins edited or hidden, custom cards created freely), designs (palettes and background art, with readability warnings), festival greetings, ready-made farmer sample quotes, every partner's saved stories (HO can delete one), and the stats: saves, shares by template / channel / day, and a partner ranking.
- **Events**: create and manage, seats never set below registrations already made, registrations list per event; switch off rather than delete to keep history.
- **Gigs**: post (with a fixed payout, or empty to pay each partner's cohort rate), assign, cancel (reason shown), reopen (clears the partner's proof), and the review desk: proof photos, farmer count against the minimum, GPS flags (early / late / no GPS / far) that inform but never block, and repeat-phone warnings (an attendee phone seen at another gig in the last 30 days). **Approve is what pays** (and is what can earn the partner bonus coins from a "Gig work approved" rule).
- **Testimonials**: the approval desk — approve (publishes to the Library and product pages), reject with reason, remove after approval, and **consent withdrawal**: when a farmer asks, HO records it, the published rows and files are erased, and that testimonial can never come back.
- **Feedback**: NPS dashboard (score, star distribution, top reasons per bucket), the **call-backs-to-make** list sorted by due date with close/reopen, reason-chip editing, and product suggestions grouped by "most asked-for" with statuses (new, reviewed, planned, declined).
- **FAQs, Terms, Info pages**: sections then questions (a section deletes only when empty; duplicate questions refused); the terms editor where HO writes the text and the server produces the Word document itself, one active version at a time, version raised on every edit; and the three info pages as validated forms, each edit versioned.

Everything HO publishes here reaches the app within a minute.

---

## 9. The loops that tie app and portal together

1. **Onboarding loop.** Partner applies in the app (an Aadhaar or PAN already on another partner is refused) → HO calls to verify them, reviews documents, the duplicate-ID warning and the nearby network → approves, requests changes (partner fixes, resubmits) or rejects → the app's tracker moves step by step → on approval the partner is placed in an earning cohort (a welcome reward may follow) and Home unlocks.
2. **Profile loop.** Approved partner edits their profile → most changes apply at once, and a new state, district or pincode re-places them in an earning cohort right away → a new name waits → HO approves (it becomes their name) or rejects with a reason the partner sees.
3. **Bank-change loop.** Partner asks for a new payout account with proof → new withdrawals pause while payouts still go to the old account → HO approves (the new account is verified and the bank file pays it) or rejects (the old account stays).
4. **Farmer to customer.** Partner adds a farmer (farmer confirms by OTP, consent recorded) → works them through the stages → places their first order → the order system tells Vistaar when Katyayani confirms it → the lead moves to *won* automatically and the farmer is now this partner's customer.
5. **KKD & App loop.** A partner's farmer walks into a KKD store, buys there or gets crop advice, or orders, opens the app or leaves a cart on the Katyayani app or website → it shows on the partner's KKD & App activity screen within a minute → the partner calls or visits. Follow-up only; no commission.
6. **Order to money.** Order placed (it takes a KSV number for that checkout attempt, and earns on the partner's cohort plan at that moment) → delivered → counts toward the month's slab → commission confirms 7 days after delivery → partner requests a withdrawal → HO approves (TDS fixed) → bank file → UTR → paid. Form 16A closes the quarter.
7. **Rewards loop.** Partner does something a rule pays for — adds a farmer, completes a due follow-up, moves a lead forward, captures a meeting attendee, registers for an event, keeps an attendance streak, saves a new story; or a customer reorders, HO approves their gig work, or HO approves the partner → the cohort's rules create a pending coin and/or gig reward → HO approves on the rewards desk → coins add to the balance; gig ₹ waits for the gig-pay switch, then joins the wallet.
8. **Cohort loop.** HO edits earning cohorts, a partner's holdings change, or the partner changes their own place → the partner is re-placed in a few seconds → new orders and rewards follow the new cohort; past orders keep the cohort they were placed in.
9. **Gig loop.** HO posts → partner accepts (a cohort-paid gig fixes their rate), checks in, submits proof → HO reviews flags and photos → approval records the pay (and any bonus coins); the wallet credit waits on the gig-pay switch.
10. **Testimonial loop.** Partner records farmer's consent and media → HO approves → the Library and product pages show it → a farmer's withdrawal of consent erases it for good.
11. **Content loop.** HO edits banners, stories, events, FAQs, terms, info pages → the app reflects it within a minute, no app release needed.
12. **Feedback loop.** Partner answers NPS → a detractor opens an officer call-back due in 2 working days → HO closes it with a note; product suggestions feed the "most asked-for" view.

---

## 10. Guardrails and what is not switched on yet

**Guardrails in plain words**

- A partner only ever sees and touches **their own** records; who the caller is always comes from their login, never from what the app sends.
- One farmer, one partner — every new farmer confirms by OTP, and consent, once worded anew by HO, must be shown and accepted again.
- One Aadhaar, one PAN, one partner — the same number can't be on two partners' forms, and a clash is reported without ever showing the number.
- Changes to who a partner is and where their money goes wait for HO: a new name and a new bank account apply only once HO approves; payouts keep going to the verified account meanwhile, and no new withdrawal starts while a bank change waits.
- Money is conservative: commission is computed from orders, never stored; an order keeps the cohort plan it was placed under; withdrawals are never edited or deleted; TDS is fixed at approval; payment keys need two different admins; past commission months are locked; every reward waits for HO approval; an order number is never given out twice, and a retry gets the same one.
- Records that matter are never deleted: partners, withdrawals, consent records, order numbers handed out, meetings (cancelled, not deleted), activity logs, rewards, earning cohorts and rules (archived, not deleted).
- Decisions made on stale information are refused — the reviewer refreshes and looks again. This includes a name or bank decision on a request the partner changed or withdrew meanwhile.
- KKD & App activity only reads other teams' records: it writes nothing and pays no commission.

**Built but waiting**

- **Online payment collection** — the options screen is gated by a company-wide switch. HO's side is ready (which apps show, Razorpay's Key ID, Cashfree on/off), and Katyayani Utils holds the gateway secrets and creates the Razorpay and Cashfree orders. Taking the money through Vistaar (checking the payment and confirming the order) is a separate piece, not built yet.
- **Gig pay and follow-up gig rewards into the wallet** — wait on Finance confirming the TDS treatment; approvals already record what is owed.
- **Per-cohort commission** — waits on HO saving an "Everyone else" plan (agreed with Finance); until then everyone earns their partner-type rates.
- **Coins** — build a balance but can't be spent or withdrawn yet.
- **Checkout from the app's cart** — orders are read from the shared order system and order numbers are already handed out; placing the order from the cart is not built yet. When it is, the app places orders through Katyayani Utils into the shared order system with their KSV number, and the order system must first accept a VST id on Vistaar's orders (owed by the Stockship team). The KSV number series must also be set up once in production before then.
- **KKD & App activity — no dummy data in production.** The Vistaar app's server build still shows sample KKD activity — on the KKD & App screen and its tiles, the customers list's "Active at KKD/app" badge and the customer details page (timeline, open app carts). Each must move to the live data before production, and nothing from the samples may ship: when there is no activity the app shows an empty screen, when a call fails it shows an error to retry — never sample rows. Soil tests, store services and opening hours have no data and stay hidden. A "farmer left an app cart" task on Today's tasks is not built.
- **Duplicate Aadhaar / PAN for older applications** — applications saved before the check existed are covered only once a one-time catch-up runs after deploy; HO then gets the list of partners who share a number.
- **WhatsApp invites and push notifications** — meetings and gigs work without them.
- **Smaller gaps**: attendance auto-close and regularisation, the My Performance PDF export, support tickets from Contact Us, coins for testimonials, partial-return commission handling, and no portal list of waiting name or bank changes (HO opens the partner).
- **Coming next (not on beta yet):** the Offline Head who approves a partner becomes their owner and the owner of the farmers they add.

