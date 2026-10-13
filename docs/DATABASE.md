# Database

Database: **`CRM-Database`** (shared with ko-sales, Stockship, prasar, franchise).
Vistaar owns only `vistaar_v2_*`. A partner is not a customer: the partner is never written
to `leads_v2`, `contacts_v2`, `customers`, `addresses` or `agents_v2`. The **farmers a partner
adds** are — as org leads (`leads_v2` + `contacts_v2` + `addresses`, below), the way prasar
writes its retailers.

## Owned (`vistaar_v2_*`)

| Collection | One row per | Key fields |
|---|---|---|
| `vistaar_v2_agents` | phone that asked for an OTP | `_id` UUID (token `sub`), `agent_id` `VST-000001` (at OTP verify), `pii_id`, `user_role` `USR-1040`, `phone` + `country_code`, `otp_verified`, `stage`, `stage_history[]`, `blocked_from`, `onboarding_id`, `cohort`, `preview{name,district,state,pincode}`, `owner_agent_id`, `is_approved`, `decided_by/at`, `rejection_reason`, `profile{…}` + `location` (mapped at approval), `is_active`, `created_by/updated_by`, timestamps |
| `vistaar_v2_onboarding_data` | partner (`vistar_onboarding_data`) | `agent_ref`, `agent_id`, `pii_id`, `cohort`, `config_id` + `config_version`, **`raw_data{}`**, `current_step`, `completed_steps`, `completion_pct`, `documents_review{key:{status,reason,by,at,sig}}`, `remarks{}`, `location`, `submitted_at`, `submit_count`, `updated_data[]` (HO edits, last 200), `source`, `created_by/updated_by`, `version` (optimistic lock) |
| `vistaar_v2_onboarding_configs` | cohort × version | `_id` `<cohort>@<version>`, `status` draft/published/archived, `steps[]`, `published_at/by` |
| `vistaar_v2_cohorts` | partner type | `_id` key, `label{}`, `description{}`, `icon`, `sub_types[]`, `order`, `is_active` |
| `vistaar_v2_sessions` | signed-in device | `_id` = SHA-256 of the refresh token, `agent_ref`, `expires_at` (TTL) |
| `vistaar_v2_settings` | — (`_id: vistaar`) | `default_owner_agent_id`, `lead_owner_agent_id` (override owner of farmer leads; `null` = the Offline Head), `farmer_consent { version, text { en, hi } }` (`null` = built-in version 1), `conflict_radius_km` |
| `vistaar_v2_leads` | farmer a partner holds (unique `pii_id`) | `_id` UUID, `pii_id`, `agent_id` (`VST-…`), `lead_id` (org `L-…`, `null` until written / contact-only person), `origin` `created`/`linked`, farmer copy `name`, `phone`, `village`, `district`, `state`, `pincode`, `crops[]`, `acreage`; `found_via`, `expected_value`, `stage` (prospect · contacted · interested · negotiation · won · lost), `stage_history[]` (last 50), `next_follow_up`, `lost_reason`, `activities[]` `{id, type, text, at, by}` (last 100), `consent {version, at}`, `ex_employee_declared_at`, `customer_at` (first order), timestamps |
| `vistaar_v2_counters` | id series | `_id: agent_id`, `seq` |

### Indexes (declared on the schemas; listed in PROD-CHECKLIST)

- agents: `{phone, country_code}` unique · `{agent_id}` unique partial (string) · `{pii_id}` unique partial (string) · `{otp_verified, stage, updated_at:-1}` · `{owner_agent_id, stage}` · `{otp_verified, stage, decided_at:-1}` · `{location: 2dsphere}`
- onboarding_data: `{agent_ref}` unique · `{location: 2dsphere}`
- onboarding_configs: `{cohort, version:-1}` unique · `{cohort, status}` unique partial `status: draft` (one draft per cohort)
- sessions: `{agent_ref}` · `{expires_at}` TTL 0
- leads: `{pii_id}` unique · `{agent_id, created_at:-1}` · `{agent_id, stage}` · `{agent_id, next_follow_up}` · `{created_at:-1}` · `{phone}`

## Shared — written
## Shared — written by this service with `source: 'vistaar'`

### `carts` (owner: B2B Sales — its rows are `source: 'b2b' | 'retailer'`)

A Vistaar row is **a B2B cart row** — the same fields, names and types as the
rows already there (checked 2026-10-09), nothing Vistaar-only. Only the values
say whose it is. There is **no `user_id`**, as on B2B's rows (user's decision,
2026-10-09): the partner is only in the `_id`. Every query filters on `_id` +
`source`, so no service reads or writes another's carts. One cart per partner
(two partners ordering for one farmer have two carts); there are no saved /
draft carts here — those, and their `reminder_sent`, are `draft_orders`.

| Field | Vistaar value |
|---|---|
| `_id` | Derived from the partner's `VST-` id (sha256 → ObjectId): the only place the partner is, so "one cart per partner" holds on the `_id` index alone and nobody else's id reaches it |
| `source` | Always `vistaar` |
| `pii_id` | Always set: the farmer the cart is for (`PII-n`), or the **partner's own `pii_id`** (from the login token) for shop stock — the API shows that as `pii_id: null` |
| `items[]` | B2B's line: `_id`, `product_id` (bulk sku), `sku` (pack), `product_name`, `product_image` (absent if none), `price`, `quantity`, `total`, `gst`, `moq`, `packaging_size` (pack weight as a string, `"0.92"`), `packaging_type` `""`, `uom` (`kg`/`l`/…), `requested_weight` `0`, `item_type` `bulk`, `packaging_sku` `null`, `is_custom_packaging` `false`. At most 100 lines, quantity ≤ 9999 |
| `subtotal`, `total` | Σ line totals (`total` = `subtotal`) |
| `tax`, `discount` | `0`, as on B2B's rows |
| `created_at`, `updated_at` | Mongoose timestamps (UTC `Date`) |
| `__v` | Mongoose version key, as on B2B's rows; Vistaar writes also use it as the compare-and-set counter |

Not stored (B2B's rows have no field for them): MRP, the pack label and the
item count — the API reads them from the catalogue / works them out.

Indexes: see `PROD-CHECKLIST.md` — none are built from this service.

## Shared — written by this service with `entry_path: 'vistaar'`

### `draft_orders` (writers: B2B order portal `deal` / `customer`, Sankalp `sankalp`)

A Vistaar draft is **the same document** the other writers make (shape checked
on beta, 2026-10-09). Only `entry_path: 'vistaar'` and the partner in
`agent_id` say whose it is; every query filters on both plus
`status: 'draft'`. One open draft per partner per customer.

| Field | Vistaar value |
|---|---|
| `draft_order_id` | `DFT-n` from `app_counters._id = 'draft_orders'` (the same `$inc` the other writers make; unique index) |
| `agent_id` | The partner's `VST-` id, from the Vistaar login token |
| `deal_id` | `null` |
| `contact_id` | `contacts_v2.contact_id` (`C0-n`) of the customer's `pii_id`, or `null` (own stock, or no contact) |
| `customer_name` | `leads_v2` first + last name of the `pii_id`; `null` = own stock |
| `contact_number` | `piis.phone_number[0]`; `null` = own stock |
| `status` | `draft` (set to `converted` by checkout, later) |
| `order_id` | `null` |
| `entry_path` | Always `vistaar` |
| `form_data` | The `customer` path's camelCase form: `customerType` (`farmer` / `null`), `leadId`, `customerName`, `businessName`, `contactNumber`, empty addresses / customization / payment, and `products[]` = `{ id, productName, variant, sku, quantity, unitPrice, mrp, gstPercent, discount 0, total, weight 0, inStock, _source 'products', imageUrl? }` at the prices of the save |
| `grand_total` | Σ `products[].total` |
| `reminder_sent` | **Vistaar-only** (user's decision, 2026-10-09): WhatsApp reminder sent. Reset to `false` on every save |
| `created_at`, `updated_at`, `__v` | Mongoose timestamps and version key, as on the other rows |

"This customer's draft" = same `contact_number` + `customer_name` (both
`null` for own stock): `draft_orders` has no `pii_id`, so a restore finds the
person again through `contact_id` → `contacts_v2.pii_id`, else
`contact_number` → `piis.phone_number`.

### `app_counters` — one row, `_id: 'draft_orders'`

`$inc: { count: 1 }` + `updated_at` on save of a new draft, never upserted.
Nothing else in `app_counters` is touched.

## Shared — farmer leads, written with `source: 'vistaar'`

Farmers partners add (`POST /leads`, LEADS-APP.md). ko-sales' `/leads/upsert` is the
reference; the rows are inserted directly, as prasar-backend does. Only **new** people get
rows (`vistaar_v2_leads.origin: created`). A farmer who already has a lead or contact from
another channel is only linked to the partner (`origin: linked`) — their org rows are never
changed; a non-farmer is refused. A partner's re-submit updates only rows Vistaar wrote.
The partner's row is written first (unique `pii_id`), the org rows after. No pipeline, LQS
or webhook.

### `leads_v2` — one per person (unique `pii_id`)

| Field | Vistaar value |
|---|---|
| `lead_id` | `L-(100000 + n)`, `n` from `app_counters._id: 'leads'` (as ko-sales) |
| `source` | `vistaar` |
| `created_by` | the partner's `VST-` id |
| `lead_owner` | `{ agent_id, agent_ref }` (`agent_ref` = the account's `agents_v2._id`, ObjectId) of the one active Offline Head (USR-1037), or `settings.lead_owner_agent_id` when set; `assigned_by` the same, `assigned_date` now |
| `first_name` / `last_name` | name split at the first space, lower case (ko-sales casing) |
| `state` | from the pincode, else the partner's state — upper case. `pin_code` = pincode or `''` |
| `status` / `is_profiled` | `contact_created` / `true`; `contact_profile: 'farmer'`, `agent_category: 'vistaar'`. **No `profiled_at`** — with it the lead matches sales-operation's "Profiled Farmer" cohort and would be routed to telecallers (prasar's leads carry none either) |
| everything else | ko-sales' schema defaults (`call_count` zeros, `pipeline_id: null`, `lqs: {}`, `tags: []`, `__v: 0`, …) |
| re-submit | `$set` names, `state`, `pin_code`, `updated_by` / `last_updated_by` = `VST-…`, `updated_at` — filter `lead_id` + `source` |

### `contacts_v2` — one per person (unique `pii_id`)

`contact_id` `C0-n` (`app_counters._id: 'contacts'`), `profile: 'farmer'`,
`profile_details.name`, `profile_category` = band, `farm_details { farm_area, farm_area_type:
'Acre', sub_profile, crops: [{ crop_name }] }` (bands: ≤ 5 small, ≤ 30 medium, else super),
`agent_category: 'vistaar'`, `source: 'vistaar'`, `last_updated_by: VST-…`, ko-sales'
defaults for the rest. Re-submit: `$set` the name, band and `farm_details`.

### `addresses` — one Vistaar row per person

`address_id` `ADDR-n` (`app_counters._id: 'addresses'`), `pii_id`, `address_line` = `village`,
`district`, `city` = district, `state`, `zipcode`, `country: 'India'`, `is_primary` (only when
the person had none), `source: 'vistaar'`, `created_by: VST-…`; listed on
`piis.addresses[]` (`$addToSet`). Re-submit updates that row only.

### `app_counters` — `leads`, `contacts`, `addresses` (and `piis`)

`$inc: { count: 1 }` + `updated_at`, never upserted. A taken id (counter behind) is retried
with the next number, up to 3 times.

## Read-only, shared identity

| Collection | Read by | Index used |
|---|---|---|
| `piis` | draft orders: phone of a `pii_id`; `pii_id` of a phone | `pii_id`, `phone_number` |
| `leads_v2` | draft orders: customer name, `lead_id`; farmer lists (`source` + `created_by`) | `pii_id`, `source` |
| `contacts_v2` | draft orders: `contact_id` ↔ `pii_id`; farm of a listed farmer | `pii_id`, `contact_id` |
| `addresses` | the village of a listed farmer | `pii_id` |

## Read-only, other apps

| Collection | What | When |
|---|---|---|
| `piis` | find by phone (oldest first); **insert** a new person only if none holds the phone (`pii_id`, `phone_number[]`, `country_code`, empty `addresses` / `gst_numbers`; never `referral_id`) | first OTP verify |
| `piis` | `$set documents.<org_document>` = `{ id, image, back_image?, is_verified, validity: null, source: 'vistaar', verified_at }` — only if the slot is empty or ours; reject sets our `is_verified: false` | HO verifies / rejects a KYC document |
| `app_counters` | `$inc` on `_id: piis` — same as ko-sales | when a PII is inserted |

## Shared — read only

| Collection | Why |
|---|---|
| `agents_v2` | HO role (`user_role`) and owner names |
| `pincode_map_v2` | pincode → state / district (cached 6 h) |
| `franchises`, `prasar_v2_retailers`, `vistaaragents` | nearby-network warning at approval. ⚠️ `vistaaragents.latestCoordinates.coordinates` is stored `[lat, lng]` (swapped) — matched with a box, not a geo query |

## Checks

```js
db.vistaar_v2_agents.aggregate([{ $group: { _id: { s: '$stage', v: '$otp_verified' }, n: { $sum: 1 } } }])
db.vistaar_v2_onboarding_configs.find({ status: 'published' }, { steps: 0 })
db.vistaar_v2_agents.find({ agent_id: { $type: 'string' }, pii_id: null })   // must be empty
```

## Seed

`node dist/scripts/seed-onboarding.js [--apply]` — the five PRD cohorts and a first form each
(`src/scripts/default-forms.ts`). Insert-only; dry run by default. Applied on beta 2026-10-09.
| `vistaaragents`, `vistaarfarmers` | old Vistaar (CRM-Backend) | Still written by the old KSS app. Never modified here |

## External

| Source | Use |
|---|---|
| B2B Sales `GET /marketplace-products/v2` (`B2B_MARKETPLACE_CODE`) | Cart prices and stock. Fetched with the calling agent's B2B token (no server token — they expire). Cached in memory per instance (`CATALOG_CACHE_TTL_SECONDS`), shared across agents (prices are per marketplace), stale served up to 15 min while B2B is down. Page size must stay ≤ 100 — above it `avl_qty` is omitted |
