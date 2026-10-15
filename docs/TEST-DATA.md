# Test data on beta

Records made only to try the flows on beta — **never in production**. Each feature adds its
own rows to a seed script under `src/scripts/` and to this page, so everyone knows which
records are fake and what each one is for. Test farmers use the mobile series
`60000xxxxx`.

## Before seeding

New farmers need an owner: **one active Offline Head (USR-1037)** in `agents_v2`, or
`settings.lead_owner_agent_id`. On beta the Offline Head is **A0-2691**
(manavbarodiya@katyayaniorganics.com, moved from USR-1001 Admin on 2026-10-14, at his
request); the settings override is **not** used, so nobody has to remember to remove it.
Without an Offline Head, `--apply` — and adding a new farmer in the app — stops with
`LEADS_NOT_CONFIGURED`, having written nothing.

## Partners

The two approved partners beta has. They log in with their own phones (OTP).

| Partner | Phone | Cohort | HO owner | Used for |
|---|---|---|---|---|
| VST-000006 | 7745963140 | other_company_employee | A0-2691 | the main test partner: every stage, takeover, transfer target |
| VST-000007 | 6232042773 | vistaar_agent | A0-2691 | "the other partner": farmers VST-000006 must not / may take |

## Farmers — `seed-test-leads`

```bash
pnpm build
node dist/scripts/seed-test-leads.js            # dry run — lists what it would add
node dist/scripts/seed-test-leads.js --apply    # adds the missing ones; existing are skipped
```

| Mobile | Farmer | Partner | What it tests |
|---|---|---|---|
| 6000000101 | Ramesh Patel | VST-000006 | contacted, follow-up tomorrow |
| 6000000102 | Suresh Yadav | VST-000006 | interested |
| 6000000103 | Mahesh Kushwaha | VST-000006 | negotiation |
| 6000000104 | Dinesh Verma | VST-000006 | prospect, no follow-up |
| 6000000105 | Kamla Bai | VST-000006 | lost ("Price too high") |
| 6000000106 | Rajendra Singh | VST-000006 | follow-up overdue |
| 6000000107 | Gopal Meena | VST-000006 | follow-up due (on the seed day) |
| 6000000108 | Sunita Ahirwar | VST-000006 | prospect, follow-up in 5 days |
| 6000000109 | Bhagwan Das | VST-000007 | VST-000006 checks it → `other_partner`; saving → `FARMER_TAKEN` |
| 6000000110 | Lakshmi Patidar | VST-000007 | not worked for 16 days → VST-000006 checks it → `released`; saving takes it over |
| 6000000111 | Om Prakash Lodhi | VST-000007 → VST-000006 | moved by HO; `holder_history` shows VST-000007 (reason `transferred`) |
| 6000000112 | Hari Ram Kirar | VST-000006 | not worked for 13 days → "releases in 2 days" |
| 6000000113 | Vikram Chouhan | VST-000006 | Today's tasks: follow-up 2 days overdue (red) |
| 6000000114 | Ramvati Bai | VST-000006 | Today's tasks: follow-up due the seed morning (09:30) |
| 6000000115 | Prakash Dangi | VST-000006 | Today's tasks: follow-up due the seed evening (18:00) |

On beta: 101–108 are `PII-1620690`–`697`, `L-4187744`–`751` (2026-10-13); 109–112 are
`PII-1620709`–`712`, `L-4187763`–`766` (2026-10-14); 113–115 are `PII-1620717`–`719`,
`L-4187773`–`775` (2026-10-14). Every org lead is owned by A0-2691.

Not from the seed: **"Test", 7745963132** on VST-000006 — added from the app on 2026-10-13
while testing the real add-lead flow.

Dates are set relative to the seed day, so they drift: "due today" becomes overdue the next
day, and "releases in 2 days" becomes released. For a fresh case, add a new mobile to the
script rather than editing an existing farmer.

## Customers

A customer needs a **confirmed order**, and `orders_v2` belongs to Stockship — the seed never
fakes one. To test: as VST-000006, place a real order for a test farmer (e.g. 6000000101) in
the app; once Stockship confirms it, the order service's call — or, until it is live, the
same call by hand with the beta `ORDER_EVENTS_SECRET`:

```bash
curl -X POST $VISTAAR_API/api/v2/hooks/orders/confirmed \
  -H "x-webhook-secret: $ORDER_EVENTS_SECRET" -H 'content-type: application/json' \
  -d '{"order_id":"<the order id>","pii_id":"PII-1620690","agent_id":"VST-000006"}'
```

— makes the farmer `won` and lists them in `GET /customers`. Shop stock (the partner's own
`pii_id`) is answered `ignored / not_held`.

## Today's tasks

`GET /today` as **VST-000006** shows its follow-ups: Vikram Chouhan, Ramvati Bai, Prakash Dangi (seeded for the card),
Rajendra Singh (overdue), Gopal Meena
(overdue), and those due on the day. The other kinds need real records, made through the
app — the seed does not fake them in shared collections:

- **saved cart** — VST-000006 saves a cart for a test farmer (Cart → Save for later);
- **event** — register VST-000006 for an event happening today or tomorrow (Events);
- **order to confirm** — an order placed and not yet confirmed by Stockship.

## Radar

`GET /radar?lat=23.2599&lng=77.4126&km=50` as **VST-000006** (Bhopal) shows its farmers
around Bhopal, nearest first — all approximate (pincode centres) until the app sends GPS
with an add, visit or order. Placed on beta by `backfill-lead-location` (2026-10-14).

## Meetings and gigs — `seed-test-meetings-gigs`

Applied on beta 2026-10-15. Writes only `vistaar_v2_meetings` and `vistaar_v2_gigs`, by
fixed ids; dates are set from the day it runs (re-run to move them to today). No index
is built and the gig counter is not used.

| Id | For | Test |
|---|---|---|
| meeting `…000000000001` | VST-000006 | scheduled tomorrow, 3 of his farmers invited — Today `meeting` task |
| meeting `…000000000002` | VST-000006 | later today — Today task (urgent); mark attendance, complete |
| meeting `…000000000003` | VST-000006 | completed yesterday: 1 of 2 invited came + 2 walk-ins (`600000020x`) — capture a walk-in as a lead |
| meeting `…000000000004` | VST-000006 | cancelled — attendance refused (`MEETING_CLOSED`) |
| meeting `…000000000005` | VST-000006 | next week, nobody invited — edit, reschedule, cancel |
| `GIG-900001` | anyone (MP) | open in 3 days — accept from Available |
| `GIG-900002` | anyone (MP) | open in 5 days — HO edit / assign / delete |
| `GIG-900003` | VST-000006 | accepted, tomorrow — Today `gig` task; give it back |
| `GIG-900004` | VST-000006 | checked in today, 6 farmers — add farmers and photos (3 needed), submit |
| `GIG-900005` | VST-000006 | submitted, 16 farmers, check-in 2 km off (`far`) — HO approve / reject |

`node dist/scripts/seed-test-meetings-gigs.js` = dry run, `--apply` writes, `--remove`
deletes exactly these ten rows. Gig pay is off, so approving `GIG-900005` does not touch the
wallet.

## Removing it

Nothing deletes test data automatically: the farmers are also org records (`piis`,
`leads_v2`, `contacts_v2`, `addresses`, ids from `app_counters`). To clear them, delete
by the mobiles above — `vistaar_v2_leads` by `phone`, the org rows by their `pii_id` — and
only on beta.
