# Nearby radar (Vistaar app)

**Base URL:** `{API_BASE}/api/v2` · bearer = partner `access_token` (AUTH-APP.md).
The **Nearby** screen (PRD C9; Lovable `NearbyFarmers`), centred on the phone's GPS:

| Layer | What | Drawn as |
|---|---|---|
| `mine` | the partner's own **customers** and **open leads** | a dot each — their own GPS, else their pincode's centre (`exact: false`) |
| `kkd_leads` | farmers from the **KKD app / website** that no partner holds | a **pincode marker** with a count |
| `org_customers` | the org's **customers** (any channel) no partner holds | a **pincode marker** with a count |
| `stores` | **KKD stores** (Katyayani Krishi Kendra) | a dot each |

KKD leads and org customers carry a pincode and no GPS of their own, so they are counted
per pincode, never drawn as single dots. Tapping a marker lists them, with the mobile
masked (`98******12`) until the farmer gives the OTP on **Add as lead**. A farmer another
partner holds never shows; a KKD lead who has become an org customer shows as the customer.

## `GET /radar?lat=&lng=&km=10&layers=`

| Query | |
|---|---|
| `lat`, `lng` | the phone's GPS now — send both. Left out: where the partner signed up, else their pincode |
| `km` | the ring: 1–50, default 10 (the app's chips: 2 · 5 · 10 · 15) |
| `layers` | comma-separated, any of `mine,kkd_leads,org_customers,stores`. Left out = all |

```jsonc
{
  "centre": { "lat": 23.2599, "lng": 77.4126, "source": "gps" },   // gps · signup · pincode
  "km": 10,
  "counts": {
    "customers": 3, "leads": 7, "unplaced": 2,                        // mine; unplaced = no place known yet
    "stores": 1,
    "kkd_leads": 214, "org_customers": 96                             // summed over `pincodes`
  },
  "items": [                                                          // mine — nearest first, up to 500
    {
      "pii_id": "PII-1620690", "kind": "customer",                    // customer · lead
      "name": "Ramesh Patel", "phone": "6000000101",
      "village": "Rampur", "district": "BHOPAL",
      "crops": ["Wheat"], "acreage": 6,
      "stage": "won", "expected_value": 4500,
      "orders": 3, "spend": 12500, "last_order_at": "…",              // customers only; leads: null
      "distance_km": 5.2,
      "lat": 23.21, "lng": 77.41,
      "exact": false                                                  // false = approximate (pincode area)
    }
  ],
  "pincodes": [                                                       // nearest first, only those with someone
    {
      "pincode": "462022", "district": "BHOPAL", "state": "MADHYA PRADESH",
      "lat": 23.27, "lng": 77.45,                                     // the pincode area's centre: put the marker here
      "distance_km": 3.4,
      "kkd_leads": 12, "org_customers": 5
    }
  ],
  "stores": [                                                         // in the ring, nearest first, up to 50
    {
      "id": "FR-100", "name": "Katyayani Krishi Kendra · Raisen",
      "address": "…", "city": "Raisen", "state": "Madhya Pradesh", "pincode": "464551",
      "phone": "9000000001",                                          // null when the store has none
      "lat": 23.33, "lng": 77.78, "distance_km": 3.1,
      "exact": true                                                   // false = no pin on record: its pincode's centre
    }
  ],
  "nearest_store": null,                                              // the closest store anywhere when `stores` is []
  "pools": { "ready": true, "built_at": "2026-10-27T10:00:00.000Z" }  // ready: false for a few seconds after a deploy
}
```

**Pincode markers:** the ring is every pincode whose centre lies within `km`; when none
does (a small ring between centres), the nearest pincode. Counts are at most an hour old
(`pools.built_at`). While `pools.ready` is `false` the list is empty — call again in a few
seconds, or keep the last answer.

**Stores:** the offline franchise master's **active** franchises (StockShip and head
office), each at HO's map pin, else StockShip's GPS, else its pincode's centre
(`exact: false`). Two records on the same spot show once, the older one — StockShip's test
copy of the Raisen store is hidden that way. **Call** (`phone`), **Map** (`lat`,`lng`),
**Send farmer** = share the store's name and address on WhatsApp from the phone (nothing is
sent by the server). Stores have no services or opening hours on record yet — leave those
lines out. If the store list cannot be read, `stores` is `[]` and the farmers still show.

**On the map:** draw `exact: false` dots as approximate (the screen's "Locations are
approximate" footer). Dot actions: **Call** (`phone`), **Map** (`lat`,`lng`), **View** →
`/farmers/:pii_id` (customer) or `/leads/:pii_id` (lead). "Further than X km" = call again
with a larger `km`.

## `GET /radar/pincodes/:pincode?layer=kkd_leads&page=1&limit=50`

The list behind a marker, newest first. `layer` = `kkd_leads` or `org_customers`
(required). Up to 60 calls a minute per partner.

```jsonc
{
  "items": [
    {
      "pii_id": "PII-2003114", "layer": "kkd_leads",
      "name": "Ram Lal",                                              // null when the record has none
      "phone_masked": "98******10",                                   // null when no mobile is on record
      "pincode": "462022", "state": "MADHYA PRADESH", "district": "BHOPAL",
      "channels": ["kkd_app"], "has_app": true,                       // kkd_leads; []/null for customers
      "since": "2026-03-01T…",                                        // kkd_leads: when they first came in
      "orders": null, "last_order_at": null                           // org_customers: orders on record, latest
    }
  ],
  "page": 1, "limit": 50, "total": 12, "has_more": false
}
```

A farmer a partner added since the hour's count is dropped from the page, so a page can
hold fewer than `limit` while `has_more` is still `true` — keep paging by `has_more`.

**Add as lead:** the usual add-farmer flow (`POST /leads/otp/send` → `/otp/verify` →
`POST /leads`, LEADS-APP.md). The farmer's mobile is never sent to the app before their OTP.

## How the partner's own farmers get a place

The phone's GPS, sent with the partner's own actions — no extra step:

| Action | Send `location` with | Trust |
|---|---|---|
| a farm **visit** logged | `POST /leads/:piiId/activities` (`type: "visit"`) | best — the partner is at the farm |
| adding / editing the farmer | `POST /leads`, `PATCH /leads/:piiId` | good |
| ordering for the farmer | `PUT /cart/customer` | weakest — often placed from the shop |

`location` = `{ "lat": 23.21, "lng": 77.41, "accuracy_m": 20, "at": "<when the fix was
taken — for an offline save>" }`. A weaker source never moves a place set by a stronger one;
a vague fix (accuracy worse than 500 m) or one outside India is not used. Without a usable
fix the farmer sits at their **pincode's centre** (approximate; a pincode point that is
clearly wrong in the org's book is replaced by its district's centre). No pincode and no
fix = `unplaced`.

## Errors

| Code | HTTP | Show |
|---|---|---|
| `VALIDATION_FAILED` | 400 | only one of `lat` / `lng`; a location outside India; no GPS and no signup place — "Turn on location to see farmers near you."; an unknown `layers` value; a pincode that is not six digits; a list without `layer` |
| `TOO_MANY_REQUESTS` | 429 | more than 60 pincode lists a minute |

## Server notes

The pools (who is filed under each pincode) are read from `leads_v2` (sources `kkd_app`,
`kkd_web`) and `customers` once an hour into each server process (~6–10 MB; the reads go to
a secondary). Nothing is written. `RADAR_POOLS_ENABLED=false` switches the two pincode
layers off.
