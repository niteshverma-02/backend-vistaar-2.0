# Database

Database: **`CRM-Database`** (shared with ko-sales, Stockship, prasar, franchise).
Vistaar owns only `vistaar_v2_*`. A partner is not a customer: the partner is never written
to `leads_v2`, `contacts_v2`, `customers`, `addresses` or `agents_v2`. The **farmers a partner
adds** are — as org leads (`leads_v2` + `contacts_v2` + `addresses`, below), the way prasar
writes its retailers.

## Owned (`vistaar_v2_*`)

| Collection | One row per | Key fields |
|---|---|---|
| `vistaar_v2_agents` | phone that asked for an OTP | `_id` UUID (token `sub`), `agent_id` `VST-000001` (at OTP verify), `pii_id`, `user_role` `USR-1040`, `phone` + `country_code`, `otp_verified`, `stage`, `stage_history[]`, `blocked_from`, `onboarding_id`, `cohort`, `preview{name,district,state,pincode}`, `owner_agent_id`, `is_approved`, `decided_by/at`, `rejection_reason`, `profile{…}` + `location` (mapped at approval; `state` / `district` from a known pincode, as `preview`), `monthly_target` (HO's own target for the partner, ₹; `null` = the settings default), `is_active`, `created_by/updated_by`, timestamps |
| `vistaar_v2_onboarding_data` | partner (`vistar_onboarding_data`) | `agent_ref`, `agent_id`, `pii_id`, `cohort`, `config_id` + `config_version`, **`raw_data{}`**, `current_step`, `completed_steps`, `completion_pct`, `documents_review{key:{status,reason,by,at,sig}}`, `remarks{}`, `location`, `submitted_at`, `submit_count`, `updated_data[]` (HO edits, last 200), `source`, `created_by/updated_by`, `version` (optimistic lock) |
| `vistaar_v2_onboarding_configs` | cohort × version | `_id` `<cohort>@<version>`, `status` draft/published/archived, `steps[]`, `published_at/by` |
| `vistaar_v2_cohorts` | partner type | `_id` key, `label{}`, `description{}`, `icon`, `sub_types[]`, `order`, `is_active` |
| `vistaar_v2_sessions` | signed-in device | `_id` = SHA-256 of the refresh token, `agent_ref`, `expires_at` (TTL) |
| `vistaar_v2_settings` | — (`_id: vistaar`) | `default_owner_agent_id`, `lead_owner_agent_id` (override owner of farmer leads; `null` = the Offline Head), `farmer_consent { version, text { en, hi } }` (`null` = built-in version 1), `lead_release_days` (15), `customer_release_days` (45), `return_window_days` (7), `min_withdrawal` (500), `tds_rate_with_pan` (2), `tds_rate_without_pan` (20), `monthly_target` (1,00,000), `conflict_radius_km` |
| `vistaar_v2_leads` | farmer a partner holds (unique `pii_id`) | `_id` UUID, `pii_id`, `agent_id` (`VST-…`), `lead_id` (org `L-…`, `null` until written / contact-only person), `origin` `created`/`linked`, farmer copy `name`, `phone`, `village`, `district`, `state`, `pincode`, `crops[]`, `acreage`; `found_via`, `expected_value`, `stage` (prospect · contacted · interested · negotiation · won · lost), `stage_history[]` (last 50), `next_follow_up`, `lost_reason`, `activities[]` `{id, type, text, at, by}` (last 100), `consent {version, at}`, `ex_employee_declared_at`, `customer_at` (first order), `last_order_at`, `held_since`, `last_worked_at`, `holder_history[]` `{agent_id, from, to, reason released·partner_blocked·transferred, by, note?}` (last 20), `location` (GeoJSON point or `null`), `location_source` (`visit` · `add` · `order` · `pincode`), `location_at`, timestamps |
| `vistaar_v2_counters` | id series | `_id: agent_id` (`VST-`) · `_id: withdrawal_id` (`WD-`), `seq` |
| `vistaar_v2_commission_plans` | cohort × month a plan starts (HO) | `_id` `<cohort>@<YYYY-MM>`, `cohort`, `effective_from`, `slabs[]{from, to, rate}`, `notes[]`, `draft`, `created_by/updated_by`, `history[]{at, by, action, slabs, notes, draft}` (every earlier state), timestamps. Read whole, held in memory. Past months' plans are never changed or deleted (they have been paid on) |
| `vistaar_v2_withdrawals` | partner's payout request | `_id` `WD-000001`, `agent_id`, `amount` (₹, before TDS), `status` requested · approved · paid · rejected · cancelled, `open: true` while requested / approved (else unset), `tds_rate`, `tds_amount`, `net_amount`, `account_last4`, `requested_at`, `approved_at/by`, `paid_at/by`, `utr`, `rejected_at/by`, `rejection_reason`, `cancelled_at`, timestamps. Moves only by conditional update on its status. Never deleted (the payment record) |
| `vistaar_v2_tds_certificates` | partner × quarter Form 16A (HO) | `_id` `<agent_id>:<FY2026-Q2>`, `agent_id`, `quarter`, `path` (private PDF), `uploaded_by`, timestamps. Deleted by HO with its file |
| `vistaar_v2_banners` | Home banner (HO) | `_id` UUID, `title{}` (localized, `en` required), `subtitle{}` / `cta{}` (required unless an image), `image_path` + `image_url` + `image_width/height` (HO art), `link` (in-app route), `tone`, `emoji`, `cohorts[]` (empty = everyone), `starts_at` / `ends_at`, `order`, `is_active`, `created_by/updated_by`, timestamps. Deleted for good by HO |
| `vistaar_v2_attendance` | partner × IST day | `_id` `<agent_id>:<YYYY-MM-DD>`, `agent_id`, `date`, `sessions[]{in_at, in_location, out_at, out_location}` (location = `lat`, `lng`, `accuracy_m`, `label`, `source` gps/registered; at most 10), `punched_in`, `first_in_at`, `last_out_at`, `worked_ms` (closed sessions), timestamps. Times are server time. Never deleted |
| `vistaar_v2_stories` | partner's saved My Story (≤ 20 each) | `_id` UUID, `agent_id`, `signature` (SHA-256 of config + photo path), `template`, `lang`, `theme` (design key), `card` (custom card key or null), `fields{emoji,headline,body,detail1-3,price,mrp,stars}`, `show_whatsapp`, `photo_mode`, `selection{}`, `image_path` (+ `image_width/height`) and `photo_path` (private, `vistaar/stories/<agent_id>/`), `share_count`, `last_shared_at`, `last_used_at` (list order), timestamps. Oldest beyond 20 deleted with their files |
| `vistaar_v2_otp_attempts` | OTP sends / guesses per phone | `_id` `send:<phone>` or `verify:<phone>`, `hits[]` (inside the 10-min window), `allowed`, `expires_at` (TTL). Shared limit across server processes |
| `vistaar_v2_story_stats` | partner × IST day | `_id` `<agent_id>:<YYYY-MM-DD>`, `agent_id`, `date`, `saved`, `shares`, `templates{<template>:n}`, `channels{<channel>:n}`, timestamps. `$inc` upserts only; never deleted |
| `vistaar_v2_story_festivals` | festival greeting (HO) | `_id` UUID, `key` (unique, never changes), `label{}`, `emoji`, `text{<lang>:{headline,body}}` (`en` required), `starts_at` / `ends_at`, `order`, `is_active`, `created_by/updated_by`, timestamps |
| `vistaar_v2_story_templates` | "Choose a design" card (HO) | `_id` = card key (a layout name for the six built-in cards, else HO's key), `base` (layout), `builtin`, `label{}`, `hint{}`, `texts{<lang>:{kicker,cta}}` (`en` required), `fields{<lang>:{emoji,headline,body,detail1..3}}`, `emojis[]`, `default_design` (design key or null), `suggested`, `starts_at` / `ends_at`, `order`, `is_active`, `created_by/updated_by`, timestamps |
| `vistaar_v2_story_designs` | story look (HO) | `_id` UUID, `key` (unique, never changes — `vistaar_v2_stories.theme`), `label{}`, `colors{bg_from,bg_to,text,subtext,accent,accent_text,soft,deco,avatar}` (`#RRGGBB[AA]`), `image_path` / `image_url` / `image_width` / `image_height` (public art under `vistaar/story-designs/`, or null), `overlay`, `templates[]`, `starts_at` / `ends_at`, `order`, `is_active`, `created_by/updated_by`, timestamps |
| `vistaar_v2_story_samples` | ready-made farmer quote (HO) | `_id` UUID, `key` (unique), `name`, `village`, `district`, `state`, `product`, `crop`, `quote`, `stars`, `order`, `is_active`, `created_by/updated_by`, timestamps |
| `vistaar_v2_faq_sections` | FAQ section / app category chip (HO) | `_id` = section key (`payments`), `label`, `emoji`, `order`, `is_active` (off hides its FAQs too), `created_by/updated_by`, timestamps. Deleted by HO only when empty |
| `vistaar_v2_faqs` | help FAQ (HO) | `_id` UUID, `category` = a section key, `q`, `a`, `q_key` (normalised `q`, unique), `order`, `is_active`, `created_by/updated_by`, timestamps. Deleted for good by HO |
| `vistaar_v2_crop_calendar` | crop (HO) | `_id` = crop key (`wheat`), `crop`, `emoji`, `season` kharif/rabi/zaid, `sowing`, `harvest`, `stages[]{stage, month, advice, products[]}`, `order`, `is_active`, `created_by/updated_by`, timestamps |
| `vistaar_v2_events` | farmer event (HO) | `_id` UUID, `title`, `type` kisan_mela/training/webinar/field_day, `starts_at`, `location`, `note`, `seats`, `registered_count` (conditional `$inc`), `cohorts[]` (empty = everyone), `is_active`, `created_by/updated_by`, timestamps |
| `vistaar_v2_event_registrations` | partner's seat | `_id` `<event_id>:<agent_id>`, `event_id`, `agent_id`, `created_at`. Deleted on un-register or with the event |
| `vistaar_v2_info_pages` | info page (HO) | `_id` = page `about_program` / `about_company` / `contact_us`, `content{}` (page's shape — see `INFO-PAGES-HO.md`), `version` (1 on first save, +1 each; a save names the one it was made from), `created_by/updated_by`, timestamps. Read only by `_id`; never deleted |

### Indexes (declared on the schemas; listed in PROD-CHECKLIST)

- agents: `{phone, country_code}` unique · `{agent_id}` unique partial (string) · `{pii_id}` unique partial (string) · `{otp_verified, stage, updated_at:-1}` · `{owner_agent_id, stage}` · `{otp_verified, stage, decided_at:-1}` · `{location: 2dsphere}`
- onboarding_data: `{agent_ref}` unique · `{location: 2dsphere}`
- onboarding_configs: `{cohort, version:-1}` unique · `{cohort, status}` unique partial `status: draft` (one draft per cohort)
- sessions: `{agent_ref}` · `{expires_at}` TTL 0
- leads: `{pii_id}` unique · `{agent_id, created_at:-1}` · `{agent_id, stage}` · `{agent_id, next_follow_up}` · `{created_at:-1}` · `{phone}`
- banners: `{is_active, order}`
- attendance: none beyond `_id` — today and every punch are `_id` lookups, a month is an `_id` range
- stories: `{agent_id, signature}` unique · `{agent_id, last_used_at:-1}`
- story_stats: `{date, agent_id}` (HO ranges); one partner's days are an `_id` range
- story_festivals: `{key}` unique · `{is_active, order}`
- story_samples: `{key}` unique · `{is_active, order}`
- otp_attempts: `{expires_at}` TTL
- story_designs: `{key}` unique · `{is_active, order}`
- story_templates: `_id` only (a few dozen rows, read whole)
- crop_calendar: `{is_active, order}`
- faq_sections: `{is_active, order}`
- faqs: `{q_key}` unique · `{is_active, order}` · `{category, order}`
- events: `{is_active, starts_at}`
- event_registrations: `{event_id, created_at}`; a partner's seat is an `_id` lookup
- commission_plans: `_id` only (read whole)
- withdrawals: `{agent_id, requested_at:-1}` · `{status, requested_at}` · `{status, paid_at}` · `{agent_id}` **unique partial `open: true`** (one open withdrawal per partner)
- tds_certificates: `{quarter, agent_id}`

## Shared — written
## Shared — written by this service with `source: 'vistaar'`

### `carts` (owner: B2B Sales — its rows are `source: 'b2b' | 'retailer'`)

A Vistaar row is **a B2B cart row** — the same fields, names and types as the
rows already there (checked 2026-10-09), nothing Vistaar-only. Only the values
say whose it is. There is **no `user_id`**, as on B2B's rows (user's decision,
2026-10-09): the partner is only in the `_id`. Every query filters on `_id` +
`source`, so no service reads or writes another's carts. One cart per partner;
its customer must be a farmer the partner holds in `vistaar_v2_leads` (one farmer, one
partner — so a farmer is only ever in their own partner's cart). There are no saved /
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

## Shared — written by this service with `profiles: ['vistaar']`

### `terms_and_conditions` (rows of Krishi Sampark `TOC-1`, B2B Portal `TOC-2`, RLM `TOC-3`)

One row per T&C document, in the existing shape — nothing added:

| Field | Vistaar row |
|---|---|
| `_id` | ObjectId |
| `toc_id` | `TOC-n` — next after the highest in the collection (any app); unique index already there, retry on collision |
| `title` | e.g. `Vistaar Partner T&C` |
| `link` | https URL of the document (docx / pdf) |
| `profiles` | `['vistaar']` — what every Vistaar read and write filters on |
| `is_active` | One Vistaar row `true` at a time |
| `__v` (version) | Edit count — `PUT /:toc_id/text` (or a title / link change) raises it; version = `__v + 1` |

Existing indexes (not built by us): `{toc_id}` unique, `{profiles, is_active}`.
Vistaar's one document holds both the privacy policy and the partner terms.

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

**Which partner a farmer belongs to is `vistaar_v2_leads.agent_id`, never
`leads_v2.lead_owner`.** The owner is HO staff (it must be an `agents_v2` account, and
ko-sales' upsert refuses any other); partners are not staff. The cart's "Ordering for" and
draft orders check the partner through `LeadsService.holds()`.

A partner can **remove** a lead that is not a customer (`DELETE /leads/:piiId`): the row is
deleted, the farmer is free (a Vistaar org lead with no partner row is just a Katyayani
farmer), and the org's rows stay.

**Where a farmer is** (the radar): `location` comes from the partner's phone GPS sent with
an action — a farm visit (best), adding / editing the farmer, ordering for them (weakest;
never overwrites a stronger source) — else the pincode's centre. A real fix is also set as
`geo {lat, lng}` on the farmer's `addresses` row Vistaar filed (`source: 'vistaar'` only),
where ko-sales and prasar's map read it. The radar reads one partner's rows by `agent_id`
with `$geoWithin` (`{agent_id, location: 2dsphere}` in production; works without it).
**Pincode centres** come from `pincode_map_v2.geo`, held in memory (one read a day per
process). About 13% of its points are more than 60 km from their own district (2026-10-14 —
e.g. 455001 Dewas sits near Bhopal), so a point that far from its district's median centre
is replaced by that centre.

**Customers** are these rows at stage `won`: the order service's call
(`POST /hooks/orders/confirmed`, ORDER-EVENTS.md — trusted as sent, the order is not read
again) on the first confirmed order the holding partner placed sets `stage: won`,
`customer_at`, `last_order_at` (by `system`), once; later orders move `last_order_at`. `customers` (written by ko-sales from Stockship) and
`leads_v2` are not touched — as across the org, a customer is a person with an order. The hold lapses after
`lead_release_days` without work (or `customer_release_days` without an order, or at once
when the partner is blocked); the next partner to add the farmer takes the row over
(guarded on `updated_at`), and HO can transfer it. `leads_v2` is not touched by either.

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
| `leads_v2` | draft orders: customer name, `lead_id`; leads: does this `pii_id` already have a lead, and whose (`source`, `created_by`) | `pii_id` |
| `contacts_v2` | draft orders: `contact_id` ↔ `pii_id`; leads: the person's `profile` (farmer or not) | `pii_id`, `contact_id` |
| `addresses` | leads: the row this service wrote for the person (`pii_id` + `source`) | `pii_id` |

## Read-only, other apps

| Collection | What | When |
|---|---|---|
| `piis` | find by phone (oldest first); **insert** a new person only if none holds the phone (`pii_id`, `phone_number[]`, `country_code`, empty `addresses` / `gst_numbers`; never `referral_id`) | first OTP verify |
| `piis` | `$set documents.<org_document>` = `{ id, image, back_image?, is_verified, validity: null, source: 'vistaar', verified_at }` — only if the slot is empty or ours; reject sets our `is_verified: false` | HO verifies / rejects a KYC document |
| `app_counters` | `$inc` on `_id: piis` — same as ko-sales | when a PII is inserted |

## Shared — read only

| Collection | Why |
|---|---|
| `orders_v2` (owner: Stockship) | the partner's orders: `{ source: 'vistaar', agent: <VST id> }`, newest by `date`; status filter is `order_status $in`, `?customer=` adds `pii_id`. Customers: each farmer's confirmed business (count, Σ `total_amount`, latest) grouped by `pii_id` over the same filter, for the lists. Rides Stockship's `{ agent, order_status, date }` index. Never written here |
| `orders_v2` — commission | the partner's whole book for commission, wallet and My Performance: one aggregation on `{ agent, source }` (the `{ agent, order_status, date }` index), `order_status $nin` failed / pseudo / split / merged; projects lines (`sku, qty, total_price, is_free`), Σ discounts, coins, and only the delivery / cancel / return entries of `order_status_map`. Cached 60 s per partner |
| `products_v2` (owner: Stockship) | name, `hero_image`, `variant` of an order's skus, one `$in` per page, on its `sku` index. Also read **whole** (with `bulk_v2` → `gst_rate`, `category.cat_id`, and `categories_v2` → `name`) into memory hourly for commission's GST and My Performance's categories (~4,900 packs, 7 categories) |
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

`node dist/scripts/seed-info-pages.js [--apply]` — About Vistaar, About Katyayani and Contact Us as the app shipped them (`src/scripts/info-pages-content.ts`), v1 of each. Insert-only; a page that exists is skipped.

`node dist/scripts/seed-terms.js [--apply] [--file <docx|pdf> --title <t>]` — writes Vistaar Privacy & Terms from `src/scripts/terms-content.ts` as an editor-made .docx (`--replace` to add a new version over an active one; `--file` uploads a finished document instead) to `toc/` and adds it to `terms_and_conditions` as the next `TOC-n`, active. Skipped if Vistaar already has an active one. Applied on beta 2026-10-13 → `TOC-6` (active, editable); `TOC-4`, `TOC-5` switched off.

`node dist/scripts/seed-banners.js [--apply | --remove]` — five **test** banners (3 text, 2 image; targeted, scheduled, ending) as `created_by: 'seed:test-banners'`, for beta/local only. Applied on beta 2026-10-12; `--remove` deletes them and their images.
(`src/scripts/default-forms.ts`). Insert-only; dry run by default. Applied on beta 2026-10-09.
| `vistaaragents`, `vistaarfarmers` | old Vistaar (CRM-Backend) | Still written by the old KSS app. Never modified here |

## Storage (Firebase, org bucket)

| Folder | Access | Written by |
|---|---|---|
| `KO-documents/<pii_id>/<purpose>/` | private, signed URLs (1 h) | `POST /uploads` (partner KYC) |
| `KO-documents/<pii_id>/form16a/<quarter>-<ts>.pdf` | private, signed URLs (1 h) | `PUT /admin/tds/certificates/:agentId/:quarter` (HO). The replaced file is deleted |
| `vistaar/banners/<uuid>.<ext>` | anyone with the URL (Firebase download token); `Cache-Control: public, max-age=31536000, immutable` | `POST /admin/banners/image` (HO). Width and height stored as object metadata. Deleted when no banner uses it |

## External

| Source | Use |
|---|---|
| B2B Sales `GET /marketplace-products/v2` (`B2B_MARKETPLACE_CODE`) | Cart prices and stock. Fetched with the calling agent's B2B token (no server token — they expire). Cached in memory per instance (`CATALOG_CACHE_TTL_SECONDS`), shared across agents (prices are per marketplace), stale served up to 15 min while B2B is down. Page size must stay ≤ 100 — above it `avl_qty` is omitted |
