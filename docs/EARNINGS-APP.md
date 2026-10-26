# Earnings — mobile app contract

Partners earn three ways (user + TL, 2026-10-16): **commission** on orders, **gig** ₹
for actions, and **coins** (points) for actions. Which rates and rewards apply depends
on the partner's **earning cohort**, which HO sets up (`EARNINGS-HO.md`). This doc covers
the cohort, what it changes in commission and gig pay, the farmer OTP that lead add now
needs, and the coin / gig **rewards**; the full commission contract is `COMMISSION-APP.md`.

> ⚠️ **BREAKING (2026-10-16): Add Lead needs the farmer's OTP.** `POST /leads` without
> a fresh `otp_token` now answers `400 LEAD_OTP_REQUIRED`. Ship the new OTP step
> (below and `LEADS-APP.md`) with this backend.

> The earning cohort is **not** the partner type picked at signup
> (`onboarding.cohort` on `GET /me`). The app never chooses or changes it.

## Where it shows: `GET /api/v2/me`

`GET /me` (see `AUTH-APP.md`) now carries `earning_cohort` — read-only:

```jsonc
{
  // … everything GET /me already returns …
  "earning_cohort": {                    // null until the partner is approved
    "id": "ec_paddy_belt",
    "name": "Paddy belt, 10+ leads",
    "since": "2026-10-16T09:12:44.120Z", // when the partner entered it
    "rules": [                           // what it pays for now, in HO's order
      {
        "name": "Paddy farmer, 2+ acres",
        "trigger": "lead_created",
        "trigger_label": "Farmer lead added",
        "reward": { "kind": "coin", "amount": 20 },          // kind: coin · gig (gig amount is ₹)
        "summary": "Crops has any of Paddy · Acreage at least 2"
      },
      {
        "name": "Any follow-up on time",
        "trigger": "follow_up_done",
        "trigger_label": "Follow-up done",
        "reward": { "kind": "gig", "amount": 15 },
        "summary": "Every time"
      }
    ]
  }
}
```

- `earning_cohort` is `null` before approval, and also if it could not be read at that
  moment (the rest of `/me` still answers) — show nothing then, never an error.
- `rules` may be empty: the cohort pays nothing extra yet. A rule HO has switched off
  is not in the list (it pays nothing until switched on again).
- For one event, the **first** matching rule of each kind pays: a lead can earn one
  coin rule and one gig rule, not two coin rules. Show `rules` as a list of "how to
  earn" cards; `summary` is ready to show as is.

## How the cohort is chosen (for help text)

- By the partner's **profile** place (state, district, pincode — not GPS) and what they
  hold **now**: open leads (not won, not lost) and customers. Not lifetime, not monthly.
- It is worked out again on its own when the partner adds a farmer, a lead is won,
  lost, reopened or removed, or HO changes the cohorts. Refresh `/me` after adding a
  lead or on app resume; there is nothing to call.

## Commission and meeting-gig pay

- An order earns on the plan of the cohort the partner was in **when it was placed**
  (fixed % or slabs, maybe with a minimum order value). Orders placed before the
  partner's first earning cohort keep their old rate.
- **"My plan"** = `GET /commission/plans` → `my_plan` (new): `earning_cohort`,
  `inherits`, `kind`, `slabs` (a fixed plan is one slab), `min_order_value`,
  `below_min_order` (what an order under the minimum earns on). Shapes and screen text in
  `COMMISSION-APP.md`.
- Ledger rows (`GET /commission/ledger`) carry `cohort_id`, `plan_id` and
  `below_min_order`.
- Meeting gigs: `payout_source: "cohort"` means the payout is the partner's own cohort
  rate — label it "Your rate". It is shown per viewer (two partners may see different
  amounts on an open gig) and fixed when the partner takes the gig (`GIGS-APP.md` *Pay*).

## ⚠️ BREAKING — farmer OTP on every lead add

From this release `POST /leads` refuses to save without the farmer's own OTP (TL,
2026-10-16), so a `lead_created` reward is always for a verified mobile. Add Lead gets one
new step: `GET /leads/check` → `POST /leads/otp/send` → the farmer reads the code out →
`POST /leads/otp/verify` → `otp_token` (15 minutes, this mobile, this partner) → sent with
`POST /leads`. The full contract — bodies, limits, errors — is in `LEADS-APP.md`
(*Farmer OTP*); this doc does not repeat it.

## Rewards — coins and gig ₹

A reward is made **by the server**, when an event matches a rule of the partner's
cohort at that moment (the `rules` on `/me`). It starts **`pending`**; Katyayani (HO)
approves or rejects it. The app never creates one.

| Event | Trigger | When it counts |
|---|---|---|
| Add a farmer (`POST /leads`, OTP verified) | `lead_created` | a farmer new to the partner (`result` `created` or `linked`), not a save of one they already hold. **Once per farmer ever** — a farmer released and added again, or removed and re-added, does not pay again |
| Log a call / visit / WhatsApp (`POST /leads/:piiId/activities`) | `follow_up_done` | the lead's `next_follow_up` is due by the end of **today (IST)** or overdue. **Once per due day** per lead: set the next follow-up to earn on the next one. A note never counts |
| Move a lead forward (`PATCH /leads/:piiId` `stage`) | `lead_stage_advanced` | the stage moves ahead (prospect → contacted → interested → negotiation). **Once per lead per stage reached**; moving back and forward again never pays twice. `won` and `lost` never fire it |
| A customer orders again (order service confirms) | `reorder` | a repeat confirmed order, newer than the last. **Once per order** — nothing for the app to call |
| Capture a meeting attendee (`POST /meetings/:id/attendees/:phone/lead`) | `meeting_attendee_captured` | the attendee becomes a lead. **Once per attendee per meeting** (the new lead may also pay `lead_created`) |
| HO approves gig work | `gig_approved` | a bonus over the gig's own ₹ payout. **Once per gig** — nothing for the app to call |
| Register for an event (`POST /events/:id/register`) | `event_registered` | the seat is taken. **Once per event ever** — leaving and registering again never pays twice |
| Punch out (`POST /attendance/punch-out`) | `attendance_streak` | fired with the unbroken run of field days (today included, 60 days back at most). **Once per IST day** |
| HO approves the partner | `onboarding_approved` | the welcome reward. **Once per partner ever** |
| Save a new story (`POST /stories`) | `story_created` | a brand-new story only — an edit or re-share of a saved one never pays. **Once per story** |

- Per event, one coin rule and one gig rule at most.
- If the partner removes a lead while its `lead_created` reward is still pending, that
  reward is rejected (`reason: "lead removed"`).
- **Coins** are points, never money: earned and counted, and **spent only as ₹1 off per
  coin on an order** (*Coins at checkout* below) — never paid out.
- **Gig ₹** joins the wallet (`GET /wallet` `gig_earned`, with approved meeting gigs)
  once **approved**, and only while gig pay is switched on (`pay_enabled` below; off
  until Finance confirms TDS). Approved before that, it counts from the switch-on.
- Saving a lead or logging an activity never fails because of a reward; refresh the
  rewards after either.

### `GET /api/v2/rewards/summary`

```jsonc
{
  "coins": {
    "approved": 120,                                       // every coin HO approved
    "pending": 20,                                         // waiting for HO
    "spent": 40,                                           // held by orders
    "available": 80,                                       // coin balance = approved − spent
    "max_pct": 10,                                         // coins pay at most this % of an order subtotal (earning cohort `coin_redeem_pct`, default 10)
    "max_per_order": 200                                   // and at most this many coins on one order (cohort `coin_redeem_max`); null = no cap
  },
  "gig": {
    "approved_amount": 45,                                 // ₹
    "pending_amount": 15,                                  // ₹, waiting for HO
    "pay_enabled": false                                   // false: approved ₹ not in the wallet yet
  }
}
```

### `GET /api/v2/rewards?kind=&status=&page=&limit=`

The partner's own, newest first. `kind` `coin` · `gig`; `status` `pending` ·
`approved` · `rejected`. `PageResult<Reward>`:

```jsonc
{
  "id": "follow_up_done:PII-1620070:2026-10-14:gig",
  "kind": "gig",
  "trigger": "follow_up_done",
  "trigger_label": "Follow-up done",
  "rule_name": "Any follow-up on time",
  "pii_id": "PII-1620070",                // the farmer; null on a trigger not about one
  "farmer_name": "Ramesh Patel",          // as when it was earned
  "ref_id": null,                         // the order / meeting / gig / event / story / day it is about; else null
  "due_day": "2026-10-14",                // follow-ups: the day it was due; else null
  "amount": 15,                           // coins, or ₹ for a gig
  "status": "rejected",
  "reason": "Follow-up not done",         // show it on a rejected one
  "created_at": "2026-10-16T05:31:02.000Z",
  "reviewed_at": "2026-10-16T09:00:00.000Z"
}
```

Read-only: there is no create, edit or delete for the app — rewards come from events,
and HO decides them.

### Coins at checkout

The order goes to Katyayani Utils (`coin` = coins used, `total_amt` = paid + coins);
the coins come off here, keyed on the checkout attempt's `x-request-id` (the same UUID
as `POST /orders/id`). One partner's spends are serialised: two orders at once never
spend the same coins.

`PUT /api/v2/rewards/coins/:requestId` `{ "coins": 40, "subtotal": 1250 }` — **before** the order is sent;
`subtotal` = the order's items in ₹ before coins, coupon and delivery.

```jsonc
{ "request_id": "…uuid…", "coins": 40, "available": 80 }   // available = after this one
```

- The same `requestId` again answers what it holds (a retry never spends twice); one
  released is held again.
- `409 NOT_ENOUGH_COINS` (`details[0]` `available=N`) past the approved coins not spent.
- `409 COINS_OVER_LIMIT` (`details[0]` `max_coins=N`) past `max_pct` % of `subtotal` (rounded down) or `max_per_order`.

`DELETE /api/v2/rewards/coins/:requestId` — the order was **not** placed (refused,
payment failed or cancelled): the coins go back. `{ "request_id": "…", "released": true }`;
`released: false` = it held none. Never release while the order may still be placed
(no answer in time, payment not confirmed yet).
