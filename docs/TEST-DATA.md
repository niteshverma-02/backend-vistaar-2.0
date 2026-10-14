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

On beta: 101–108 are `PII-1620690`–`697`, `L-4187744`–`751` (2026-10-13); 109–112 are
`PII-1620709`–`712`, `L-4187763`–`766` (2026-10-14). Every org lead is owned by A0-2691.

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
  -d '{"order_id":"<the order id>"}'
```

— makes the farmer `won` and lists them in `GET /customers`. `TEST-VST-1` (beta's only
Vistaar order) is VST-000006's own shop stock, so it is answered `ignored / not_held`.

## Removing it

Nothing deletes test data automatically: the farmers are also org records (`piis`,
`leads_v2`, `contacts_v2`, `addresses`, ids from `app_counters`). To clear them, delete
by the mobiles above — `vistaar_v2_leads` by `phone`, the org rows by their `pii_id` — and
only on beta.
