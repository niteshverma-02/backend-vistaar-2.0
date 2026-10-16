# Earnings — mobile app contract

Partners earn three ways (user + TL, 2026-10-16): **commission** on orders, **gig** ₹
for actions, and **coins** (points) for actions. Which rates and rewards apply depends
on the partner's **earning cohort**, which HO sets up (`EARNINGS-HO.md`). This doc covers
the cohort, the farmer OTP that lead add now needs, and the coin / gig **rewards**;
commission itself is `COMMISSION-APP.md`.

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
- `rules` may be empty: the cohort pays nothing extra yet.
- For one event, the **first** matching rule of each kind pays: a lead can earn one
  coin rule and one gig rule, not two coin rules. Show `rules` as a list of "how to
  earn" cards; `summary` is ready to show as is.

## How the cohort is chosen (for help text)

- By the partner's **profile** place (state, district, pincode — not GPS) and what they
  hold **now**: open leads (not won, not lost) and customers. Not lifetime, not monthly.
- It is worked out again on its own when the partner adds a farmer, a lead is won,
  lost, reopened or removed, or HO changes the cohorts. Refresh `/me` after adding a
  lead or on app resume; there is nothing to call.
- Commission on an order follows the cohort the partner was in **when the order was
  placed** (`COMMISSION-APP.md`).

## ⚠️ BREAKING — farmer OTP on every lead add

From this release `POST /leads` refuses to save without the farmer's own OTP (TL,
2026-10-16). The Add Lead screen gets one new step — full contract in `LEADS-APP.md`:

1. `GET /leads/check?phone=` as today (do not send an OTP to a farmer you cannot add).
2. `POST /leads/otp/send { "phone": "9876543210" }` → `{ "sent": true, "resend_after_seconds": 30 }`.
   Resend: same route with `"resend": true`. 3 sends per mobile per 10 minutes.
3. The farmer reads the code out; `POST /leads/otp/verify { "phone", "otp" }` →
   `{ "otp_token": "…", "expires_at": "…" }` — good for **15 minutes**, for **this
   mobile** and **this partner** only. 5 tries per mobile per 10 minutes.
4. `POST /leads { …farmer…, "otp_token": "…" }`. Missing → `400 LEAD_OTP_REQUIRED`;
   another mobile's, another partner's or expired → `400 LEAD_OTP_INVALID` (verify
   again). A retry of the same save within the 15 minutes reuses the token.

The farmer's OTP is separate from the partner's own sign-in OTP (own limits). Test
farmers on beta use `OTP_TEST_NUMBERS` / `OTP_TEST_CODE` as sign-in does.

## Rewards — coins and gig ₹

A reward is made **by the server**, when an event matches a rule of the partner's
cohort at that moment (the `rules` on `/me`). It starts **`pending`**; Katyayani (HO)
approves or rejects it. The app never creates one.

| Event | Trigger | When it counts |
|---|---|---|
| Add a farmer (`POST /leads`, OTP verified) | `lead_created` | a farmer new to the partner (`result` `created` or `linked`), not a save of one they already hold. **Once per farmer ever** — a farmer released and added again, or removed and re-added, does not pay again |
| Log a call / visit / WhatsApp (`POST /leads/:piiId/activities`) | `follow_up_done` | the lead's `next_follow_up` is due by the end of **today (IST)** or overdue. **Once per due day** per lead: set the next follow-up to earn on the next one. A note never counts |

- Per event, one coin rule and one gig rule at most.
- If the partner removes a lead while its `lead_created` reward is still pending, that
  reward is rejected (`reason: "lead removed"`).
- **Coins** are points: earned and counted, **no redeem / spend yet**, never money.
- **Gig ₹** joins the wallet (`GET /wallet` `gig_earned`, with approved meeting gigs)
  once **approved**, and only while gig pay is switched on (`pay_enabled` below; off
  until Finance confirms TDS). Approved before that, it counts from the switch-on.
- Saving a lead or logging an activity never fails because of a reward; refresh the
  rewards after either.

### `GET /api/v2/rewards/summary`

```jsonc
{
  "coins": { "approved": 120, "pending": 20 },            // coin balance = approved
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
  "pii_id": "PII-1620070",
  "farmer_name": "Ramesh Patel",          // as when it was earned
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
