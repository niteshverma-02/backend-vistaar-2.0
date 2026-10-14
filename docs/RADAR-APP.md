# Nearby radar (Vistaar app)

**Base URL:** `{API_BASE}/api/v2` · bearer = partner `access_token` (AUTH-APP.md).
The **Nearby** screen (PRD C9; Lovable `NearbyFarmers`): the partner's own **customers**
and **open leads** within N km — no retailers, nobody else's farmers.

## `GET /radar?lat=&lng=&km=10`

| Query | |
|---|---|
| `lat`, `lng` | the phone's GPS now — send both. Left out: where the partner signed up, else their pincode |
| `km` | the ring: 1–50, default 10 (the app's chips: 2 · 5 · 10 · 15) |

```jsonc
{
  "centre": { "lat": 23.2599, "lng": 77.4126, "source": "gps" },   // gps · signup · pincode
  "km": 10,
  "counts": { "customers": 3, "leads": 7, "unplaced": 2 },          // unplaced = no place known yet
  "items": [                                                          // nearest first, up to 500
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
  ]
}
```

**On the map:** draw `exact: false` dots as approximate (the screen's "Locations are
approximate" footer). Dot actions: **Call** (`phone`), **Map** (`lat`,`lng`), **View** →
`/farmers/:pii_id` (customer) or `/leads/:pii_id` (lead). "Further than X km" = call again
with a larger `km`.

## How farmers get a place

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
| `VALIDATION_FAILED` | 400 | only one of `lat` / `lng`; a location outside India; or no GPS and no signup place — "Turn on location to see farmers near you." |
