# Database

Database: **`CRM-Database`** (shared with ko-sales, Stockship, prasar, franchise).
Vistaar owns only `vistaar_v2_*`. A partner is not a customer: the partner is never written
to `leads_v2`, `contacts_v2`, `customers`, `addresses` or `agents_v2`. The **farmers a partner
adds** are — as org leads (`leads_v2` + `contacts_v2` + `addresses`, below), the way prasar
writes its retailers.

## Owned (`vistaar_v2_*`)

| Collection | One row per | Key fields |
|---|---|---|
| `vistaar_v2_agents` | phone that asked for an OTP | `_id` UUID (token `sub`), `agent_id` `VST-000001` (at OTP verify), `pii_id`, `user_role` `USR-1040`, `phone` + `country_code`, `otp_verified`, `stage`, `stage_history[]`, `blocked_from`, `onboarding_id`, `cohort`, `preview{name,district,state,pincode}`, `owner_agent_id`, `is_approved`, `decided_by/at`, `rejection_reason`, `profile{…}` + `location` (mapped at approval; `state` / `district` from a known pincode, as `preview`; the partner's Edit Profile (`PATCH /me`) then sets `email`, `village`, `district`, `state`, `pincode`, `photo` (private path under `KO-documents/<pii_id>/`) and `details.language_pref`, and mirrors place into `preview`), `verification_calls[]{at, by (HO email), outcome reached/not_reached/verified, note}` (HO calls before a decision; absent on older rows), `pending_name{value, requested_at}` (a name waiting for HO; `null` = none), `name_change{value, approved, reason, by, at}` (HO's last decision; approval also sets `profile.name` + `preview.name`), `monthly_target` (HO's own target for the partner, ₹; `null` = the settings default), `earning_cohort {id, since}` (copy of the open `vistaar_v2_earning_assignments` row; absent until first placed; written only by the earning module, without touching `updated_at`), `is_active`, `created_by/updated_by`, timestamps |
| `vistaar_v2_onboarding_data` | partner (`vistar_onboarding_data`) | `agent_ref`, `agent_id`, `pii_id`, `cohort`, `config_id` + `config_version`, **`raw_data{}`**, `current_step`, `completed_steps`, `completion_pct`, `documents_review{key:{status,reason,by,at,sig}}`, `remarks{}`, `location`, `submitted_at`, `submit_count`, `updated_data[]` (HO edits and approved bank changes, last 200), `id_keys{aadhaar_hash (SHA-256 of the 12 digits), pan (upper case)}` (rewritten on every form write, for the cross-partner duplicate check; never returned), `bank_change{status pending/approved/rejected/withdrawn, account_holder, account_number, ifsc, proof_path, requested_at, decided_at, decided_by (HO email or `self`), reason}` (the latest request only; the form's account changes only on approval), `source`, `created_by/updated_by`, `version` (optimistic lock) |
| `vistaar_v2_onboarding_configs` | cohort × version | `_id` `<cohort>@<version>`, `status` draft/published/archived, `steps[]`, `published_at/by` |
| `vistaar_v2_cohorts` | partner type | `_id` key, `label{}`, `description{}`, `icon`, `sub_types[]`, `order`, `is_active` |
| `vistaar_v2_sessions` | signed-in device | `_id` = SHA-256 of the refresh token, `agent_ref`, `expires_at` (TTL) |
| `vistaar_v2_settings` | — (`_id: vistaar`) | `default_owner_agent_id`, `lead_owner_agent_id` (override owner of farmer leads; `null` = the Offline Head), `farmer_consent { version, text { en, hi } }` (`null` = built-in version 1), `testimonial_consent` (same shape; the wording a farmer agrees to before a partner sends their testimonial), `lead_release_days` (15), `customer_release_days` (45), `return_window_days` (7), `min_withdrawal` (500), `tds_rate_with_pan` (2), `tds_rate_without_pan` (20), `monthly_target` (1,00,000), `conflict_radius_km`, `feedback_reasons { detractor, passive, promoter: { question, chips[] } }` (`null` = the app's built-in chips), meeting gigs: `gig_payout` (250 — a cohort-paid gig's pay when the taker's earning cohort has no `meeting_gig_payout`), `gig_min_farmers` (15), `gig_photos_required` (3), `gig_checkin_radius_m` (500), `gig_pay_enabled` (`false` — approved gigs' and follow-up gig rewards' pay reaches the wallet only when on), `gig_pay_enabled_at` (set once at the first switch-on, never cleared) |
| `vistaar_v2_leads` | farmer a partner holds (unique `pii_id`) | `_id` UUID, `pii_id`, `agent_id` (`VST-…`), `lead_id` (org `L-…`, `null` until written / contact-only person), `origin` `created`/`linked`, farmer copy `name`, `phone`, `village`, `district`, `state`, `pincode`, `crops[]`, `acreage`; `found_via`, `expected_value`, `stage` (prospect · contacted · interested · negotiation · won · lost), `stage_history[]` (last 50), `next_follow_up`, `lost_reason`, `activities[]` `{id, type, text, at, by}` (last 100), `consent {version, at}`, `ex_employee_declared_at`, `otp_verified_at` (the farmer's mobile OTP-verified on the partner's last add — mandatory from 2026-10-16; `null` on older rows), `customer_at` (first order), `last_order_at`, `held_since`, `last_worked_at`, `holder_history[]` `{agent_id, from, to, reason released·partner_blocked·transferred, by, note?}` (last 20), `location` (GeoJSON point or `null`), `location_source` (`visit` · `add` · `order` · `pincode`), `location_at`, timestamps |
| `vistaar_v2_counters` | id series | `_id` `agent_id` (`VST-`) / `product_suggestion` / `withdrawal_id` (`WD-`) / `gig_id` (`GIG-`), `seq` |
| `vistaar_v2_commission_plans` | cohort × month a plan starts (HO) | `_id` `<partner type or ec_id>@<YYYY-MM>`, `cohort` (a partner type, or an earning cohort `ec_…`), `effective_from`, `kind` `slabs`/`fixed` (missing on rows saved before 2026-10-16 = `slabs`; a fixed plan is stored as one slab `{from: 0, to: null, rate}`), `slabs[]{from, to, rate}`, `min_order_value` (₹ of base or `null`; earning cohorts other than `ec_default` only — below it an order earns `ec_default`'s plan), `notes[]`, `draft`, `created_by/updated_by`, `history[]{at, by, action, kind, slabs, min_order_value, notes, draft}` (every earlier state), timestamps. Read whole, held in memory. Past months' plans are never changed or deleted (they have been paid on) |
| `vistaar_v2_withdrawals` | partner's payout request | `_id` `WD-000001`, `agent_id`, `amount` (₹, before TDS), `status` requested · approved · paid · rejected · cancelled, `open: true` while requested / approved (else unset), `tds_rate`, `tds_amount`, `net_amount`, `account_last4`, `requested_at`, `approved_at/by`, `paid_at/by`, `utr`, `rejected_at/by`, `rejection_reason`, `cancelled_at`, timestamps. Moves only by conditional update on its status. Never deleted (the payment record) |
| `vistaar_v2_tds_certificates` | partner × quarter Form 16A (HO) | `_id` `<agent_id>:<FY2026-Q2>`, `agent_id`, `quarter`, `path` (private PDF), `uploaded_by`, timestamps. Deleted by HO with its file |
| `vistaar_v2_banners` | Home banner (HO) | `_id` UUID, `title{}` (localized, `en` required), `subtitle{}` / `cta{}` (required unless an image), `image_path` + `image_url` + `image_width/height` (HO art), `link` (in-app route), `tone`, `emoji`, `cohorts[]` (empty = everyone), `starts_at` / `ends_at`, `order`, `is_active`, `created_by/updated_by`, timestamps. Deleted for good by HO |
| `vistaar_v2_attendance` | partner × IST day | `_id` `<agent_id>:<YYYY-MM-DD>`, `agent_id`, `date`, `sessions[]{in_at, in_location, out_at, out_location}` (location = `lat`, `lng`, `accuracy_m`, `label`, `source` gps/registered; at most 10), `punched_in`, `first_in_at`, `last_out_at`, `worked_ms` (closed sessions), timestamps. Times are server time. Never deleted |
| `vistaar_v2_stories` | partner's saved My Story (≤ 20 each) | `_id` UUID, `agent_id`, `signature` (SHA-256 of config + photo path), `template`, `lang`, `theme` (design key), `card` (custom card key or null), `fields{emoji,headline,body,detail1-3,price,mrp,stars}`, `show_whatsapp`, `photo_mode`, `selection{}`, `image_path` (+ `image_width/height`) and `photo_path` (private, `vistaar/stories/<agent_id>/`), `share_count`, `last_shared_at`, `last_used_at` (list order), timestamps. Oldest beyond 20 deleted with their files |
| `vistaar_v2_otp_attempts` | OTP sends / guesses per phone | `_id` `send:<phone>` or `verify:<phone>` (partner sign-in), `lead-send:<phone>` or `lead-verify:<phone>` (a farmer's OTP on lead add — own counts, same limits), `hits[]` (inside the 10-min window), `allowed`, `expires_at` (TTL). Shared limit across server processes |
| `vistaar_v2_story_stats` | partner × IST day | `_id` `<agent_id>:<YYYY-MM-DD>`, `agent_id`, `date`, `saved`, `shares`, `templates{<template>:n}`, `channels{<channel>:n}`, timestamps. `$inc` upserts only; never deleted |
| `vistaar_v2_story_content` | My Story content item (HO): a festival greeting, "Choose a design" card, story look or ready-made farmer quote | One Mongoose discriminator per `kind` `festival` / `template` / `design` / `sample`; every query carries its `kind`. Shared: `_id` `<kind>:<id>` — `id` is what the API shows and takes, unchanged by the merge (a UUID; a card's key for `template`), `kind`, `key` (unique per kind, never changes; a card's `key` is its id and is not returned for cards), `order`, `is_active`, `created_by/updated_by`, timestamps. **festival**: `label{}`, `emoji`, `text{<lang>:{headline,body}}` (`en` required), `starts_at` / `ends_at`. **template**: id = card key (a layout name for the six built-in cards, else HO's key), `base` (layout), `builtin`, `label{}`, `hint{}`, `texts{<lang>:{kicker,cta}}` (`en` required), `fields{<lang>:{emoji,headline,body,detail1..3}}`, `emojis[]`, `default_design` (design key or null), `suggested`, `starts_at` / `ends_at`. **design**: `key` = `vistaar_v2_stories.theme`, `label{}`, `colors{bg_from,bg_to,text,subtext,accent,accent_text,soft,deco,avatar}` (`#RRGGBB[AA]`), `image_path` / `image_url` / `image_width` / `image_height` (public art under `vistaar/story-designs/`, or null), `overlay`, `templates[]`, `starts_at` / `ends_at`. **sample**: `name`, `village`, `district`, `state`, `product`, `crop`, `quote`, `stars` |
| `vistaar_v2_story_festivals`, `vistaar_v2_story_templates`, `vistaar_v2_story_designs`, `vistaar_v2_story_samples` | **retired 2026-10-22** (merged into `vistaar_v2_story_content`) | no code reads them; `node dist/scripts/migrate-story-content.js` (dry run, then `--apply`) copies their rows, `_id` → `<kind>:<_id>` (a card's old `_id` also becomes its `key`), never touching the old ones. Drop them once the counts match (`PROD-CHECKLIST.md`) |
| `vistaar_v2_faqs` | the FAQs screen (HO): a section **or** a FAQ, told apart by `kind` | `kind: 'section'` — FAQ section / app category chip: `_id` = section key (`payments`), `label`, `emoji`, `order`, `is_active` (off hides its FAQs too), `created_by/updated_by`, timestamps; deleted by HO only when no FAQ names it. `kind: 'faq'` — help FAQ: `_id` UUID, `category` = a section key, `q`, `a`, `q_key` (normalised `q`, unique among FAQs), `order`, `is_active`, `created_by/updated_by`, timestamps; deleted for good by HO. A key cannot hold `-`, so a key and a UUID never share an `_id`. Every query names `kind`; the API never returns it. `GET /faqs` is one read of both (`$facet`) |
| `vistaar_v2_faq_sections` | **retired 2026-10-22** (merged into `vistaar_v2_faqs` as `kind: 'section'` by `migrate-faqs-merge`) | no code reads it; drop it once the merge is checked (PROD-CHECKLIST) |
| `vistaar_v2_crop_calendar` | **retired 2026-10-14** (module removed; crops are ko-sales `/crops`) | no code reads it; the beta rows are still there, drop the collection when ready |
| `vistaar_v2_events` | farmer event (HO) | `_id` UUID, `title`, `type` kisan_mela/training/webinar/field_day, `starts_at`, `location`, `note`, `seats`, `registered_count` (conditional `$inc`), `cohorts[]` (empty = everyone), `is_active`, `created_by/updated_by`, timestamps |
| `vistaar_v2_event_registrations` | partner's seat | `_id` `<event_id>:<agent_id>`, `event_id`, `agent_id`, `created_at`. Deleted on un-register or with the event |
| `vistaar_v2_meetings` | partner's farmer meeting (PRD C5) | `_id` UUID (made by the app — a retried create is the same meeting), `agent_id`, `type` farmer_meeting/crop_demo/field_day/disease_camp/soil_health_camp, `title`, `starts_at`, `village`, `venue`, `pincode`, `organiser` self/officer, `agenda`, `status` scheduled/completed/cancelled, `attendees[]{phone, name, village, pii_id, invited, present, walk_in, lead_captured}` (embedded, ≤ 300, one row per phone, saved whole in one write), `counts{invited, present, leads}` (kept in step with `attendees` on every write), `completed_at`, `cancelled_at`, `cancel_note`, timestamps (`updated_at` is the attendee list's optimistic lock). Written only by the partner; never deleted (cancel instead) |
| `vistaar_v2_gigs` | paid farmer meeting HO posts (PRD AD14) | `_id` `GIG-000001` (`vistaar_v2_counters` `gig_id`), `title`, `village`, `district`, `state` (upper case), `pincode`, `venue`, `venue_point {lat, lng}` (HO's pin), `starts_at`, `ends_at`, `expected_farmers`, `min_farmers`, `photos_required` (these two default from settings), `payout` (₹, or `null` only while an open gig is cohort-paid — fixed at accept / assign to the taker's earning-cohort `meeting_gig_payout`, else settings `gig_payout`; back to `null` on release / reopen), `payout_source` `gig`/`cohort` (missing on rows before 2026-10-16 = `gig`), `products[]`, `requirements[]`, `cohorts[]` (partner types; empty = everyone), `earning_cohorts[]` (`ec_…` ids; empty or missing on rows before 2026-10-22 = every earning cohort; a partner must match both lists), `status` open/accepted/checked_in/submitted/approved/rejected/cancelled, `agent_id` (holder or `null`), `accepted_at`, `assigned_by` (HO email; `null` = the partner took it), `releases[]{agent_id, at, by partner/ho}`, `check_in{lat, lng, accuracy_m, at (server time), distance_m, flags[] early/late/no_gps/far}`, `attendees[]{phone, name, village}` (≤ 300, saved whole), `photos[]{id, path, at}` (≤ 6, private), `submitted_at`, `reviewed_by/at`, `reject_reason`, `cancelled_by`, `cancel_reason`, `posted_by`, `updated_by`, timestamps. Every move is a conditional update on the status read. Deleted only while open and never taken; else cancelled |
| `vistaar_v2_info_pages` | info page (HO) | `_id` = page `about_program` / `about_company` / `contact_us`, `content{}` (page's shape — see `INFO-PAGES-HO.md`), `version` (1 on first save, +1 each; a save names the one it was made from), `created_by/updated_by`, timestamps. Read only by `_id`; never deleted |
| `vistaar_v2_feedback` | Feedback-screen answer | `_id` ObjectId, `agent_id`, `partner{name, phone, cohort, district, state, owner_agent_id}` (copy at submit), `nps` 0–10, `bucket` detractor/passive/promoter, `reasons[]` (chip text as shown), `comment`, `rating` 1–5 or null, `follow_up{status open/done, due_at, owner_agent_id, note, done_by, done_at}` (detractors only, else null), timestamps. Never edited by the partner; never deleted |
| `vistaar_v2_product_suggestions` | "Suggest a product" | `_id` `SUG-000001` (`vistaar_v2_counters` `product_suggestion`), `agent_id`, `partner{…}` (as above), `product`, `product_key` (lower-case, single spaces — groups the same ask), `crop`, `monthly_demand` (free text), `note`, `status` new/reviewed/planned/declined, `ho_note`, `updated_by`, timestamps. Never deleted |
| `vistaar_v2_payment_options` | online payment option (HO) | `_id` = provider `razorpay` / `cashfree` / `phonepe` (closed set in code), `label`, `hint`, `is_active`, `order`, `cohorts[]` (empty = everyone), `version` (1 on first save, +1 each; a save names the one it read), `updated_by`, timestamps. No row = off. **No merchant key, secret or URL — ever.** Never deleted |
| `vistaar_v2_payment_credentials` | one set of merchant keys (admin) | `_id` UUID, `provider`, `mode` test/live, `status` pending/approved/active/superseded/revoked/rejected/expired, `public_fields{}` (Key ID, App ID…), `secrets{field: {kid, iv, tag, ct}}` (AES-256-GCM, AAD = row+provider+field; **`null` once not pending/active**), `masked{field: '••••abcd'}`, `note`, `submitted_by`, `expires_at` (24 h), `test{ok, message, by, at}`, `decided_by/at`, `reason`, `activated_at`, `retired_at/by`, timestamps. Unique: one `active` and one `pending` per provider. Never deleted |
| `vistaar_v2_payment_option_audit` | who changed a payment option | `_id` UUID, `option_id` (provider, `*` for a reorder), `action` update/reorder/credentials_*, `before`, `after` (just the changed fields), `by` (HO email), `at`. Insert-only, **never deleted** |
| `vistaar_v2_testimonials` | **retired 2026-10-22** — a partner testimonial is its `product_reviews` row (see *Shared — written*) | `src/scripts/migrate-testimonials-to-shared.ts` moves the rows; drop the collection once the counts agree |
| `vistaar_v2_earning_cohorts` | earning cohort (HO) — **not** the onboarding cohort | `_id` `ec_<slug>` (never changes; `ec_default` built in, upserted on first read), `name`, `description`, `conditions[]{field state/district/pincode/open_leads/customers, op eq/any_of/gte/lte, value}` (authoritative; all must hold, a list value on any entry; `[]` only on the default; `null` on a pre-conditions row — converted from `filters` on read), `filters{states[] (upper case), districts[], pincodes[], min_leads, min_customers}` (the legacy view, derived from `conditions` best effort), `priority` (1 = first among active; the default is always last), `status` active/archived, `meeting_gig_payout` (₹ or `null` = settings `gig_payout`), `starts_on` / `ends_on` (IST days `YYYY-MM-DD`, both included, `null` = open; absent on rows before 2026-10-22 = `null`; never on `ec_default` — a cohort takes partners only while running), `commission_off[]{from, to}` (IST months `YYYY-MM`, both included, `to: null` = still off: the cohort's own commission plan switched off — its partners earn `ec_default`'s; absent on rows before 2026-10-22 = `[]`; never on `ec_default`), `version` (optimistic; +1 on every edit and archive of the cohort's own fields — never on a rule's), `created_by/updated_by`, `archived_by/at`, timestamps; **`rules[]`** — its coin / gig rules (since 2026-10-22; were `vistaar_v2_earning_rules`): `_id` UUID (unique across cohorts), `name`, `trigger` (code catalog: `lead_created`, `follow_up_done`, …), `conditions[]{field, op eq/in/any_of/gte/lte, value}` (checked against the catalog on save; all must hold), `reward{kind coin/gig, amount}` (whole ≥ 1; gig = ₹), `order` (within the cohort), `status` active/archived, `enabled` (HO's ON/OFF; off never pays and is hidden from the app, keeps its place in the order; absent = on), `version` (the rule's own optimistic version; the ON/OFF switch is an edit too), `created_by/updated_by`, `archived_by/at`, `created_at/updated_at` (set by the code); ≤ 100 per cohort, archived ones too; no `cohort_id` (the holding cohort says it — the API still answers it). A rule is written alone by its id with positional `rules.$[rule]` updates guarded by its own `version` / `status`, with schema timestamps off — the cohort's `version` / `updated_by` / `updated_at` stay; a cohort edit `$set`s only its own fields. Missing `rules` (a row not migrated yet) reads as none. Read whole (a few dozen rows) — an event's cohort read brings its rules. Never deleted — archived; rules archived, never removed (rewards name them) |
| `vistaar_v2_earning_rules` | **retired 2026-10-22** — the rules live in `vistaar_v2_earning_cohorts.rules[]` | Read only by `migrate-earning-rules-into-cohorts`; no code reads or writes it. Dropped by hand once the migration's counts agree (PROD-CHECKLIST) |
| `vistaar_v2_earning_assignments` | stretch of time a partner spent in an earning cohort | `_id` UUID, `agent_id`, `cohort_id`, `from`, `to` (`null` while current), `open` (`true` while current; one per partner, unique partial), `reason` partner_approved/partner_unblocked/profile_changed/holdings_changed/cohorts_changed/first_assignment/recompute/cohort_window, `created_at`. A move closes the open row (`to` = now) and opens a new one; never edited after, never deleted (commission follows the cohort at an order's placing time — every commission book reads the partner's stretches) |
| `vistaar_v2_rewards` | coin / gig reward an event earned a partner | `_id` `lead_created:<pii_id>:<kind>` or `follow_up_done:<pii_id>:<YYYY-MM-DD IST due day>:<kind>` (the event pays once per kind — a duplicate insert is "already rewarded"), `agent_id`, `rule_id` + `rule_name` (as then), `kind` coin/gig, `trigger` lead_created/follow_up_done, `pii_id` + `farmer_name` (as then), `due_day` (follow-ups; else `null`), `amount` (whole ≥ 1; coins or ₹), `cohort_id` (the partner's earning cohort then), `status` pending/approved/rejected, `reason`, `reviewed_by` (HO email or `system`), `reviewed_at` (an approved gig is earned from it), timestamps. Only a pending row is decided (status in the update filter). Commission reads the approved `kind: gig` rows into the wallet (while `gig_pay_enabled`). Never deleted — an approved gig is wallet money |
| `vistaar_v2_order_ids` | order number handed out | `_id` `<agent_id>:<request_id>` (one number per checkout attempt — `_id` keeps it unique with no other index), `order_id` `KSV-n` (from `app_counters` `vistaar_orders`), `agent_id`, `request_id` (the app's UUID), `created_at`. **Never deleted** — a number given out is never given again |
| `vistaar_v2_testimonial_consents` | the farmer's consent for one testimonial | `_id` = the testimonial's, `agent_id`, `pii_id`, `farmer_name`, `version`, `text` (the exact words shown), `lang` en/hi, `given_at` (server time), `status` given/withdrawn, `withdrawn_at/by/reason`, timestamps. **Never deleted** |

### Indexes (declared on the schemas; listed in PROD-CHECKLIST)

- agents: `{phone, country_code}` unique · `{agent_id}` unique partial (string) · `{pii_id}` unique partial (string) · `{otp_verified, stage, updated_at:-1}` · `{owner_agent_id, stage}` · `{otp_verified, stage, decided_at:-1}` · `{otp_verified, stage, last_login_at:-1}` · `{location: 2dsphere}`
- onboarding_data: `{agent_ref}` unique · `{location: 2dsphere}` · `{id_keys.aadhaar_hash}` partial · `{id_keys.pan}` partial (not unique: the save refuses a clash; older rows may hold duplicates)
- onboarding_configs: `{cohort, version:-1}` unique · `{cohort, status}` unique partial `status: draft` (one draft per cohort)
- sessions: `{agent_ref}` · `{expires_at}` TTL 0
- leads: `{pii_id}` unique · `{agent_id, created_at:-1}` · `{agent_id, stage}` · `{agent_id, next_follow_up}` · `{created_at:-1}` · `{phone}` · `{last_order_at:-1, _id}` (HO customers) · `{next_follow_up, _id}` (HO follow-ups)
- banners: `{is_active, order}`
- attendance: none beyond `_id` — today and every punch are `_id` lookups, a month is an `_id` range
- stories: `{agent_id, signature}` unique · `{agent_id, last_used_at:-1}`
- story_stats: `{date, agent_id}` (HO ranges); one partner's days are an `_id` range
- story_content: `{kind, key}` unique · `{kind, is_active, order}` — declared on the base schema only, so the four kind models have no index of their own to build. Cards are read whole (`kind` alone)
- otp_attempts: `{expires_at}` TTL
- faqs: `{q_key}` unique partial `kind: faq` · `{is_active, order}` (`GET /faqs`, both kinds) · `{category, order}`
- events: `{is_active, starts_at}`
- event_registrations: `{event_id, created_at}`; a partner's seat is an `_id` lookup
- meetings: `{agent_id, starts_at:-1}` (the partner's list, Today's tasks, My Story picker) · `{starts_at:-1}` (HO list and summary)
- gigs: `{status, starts_at}` (open gigs, HO calendar) · `{agent_id, starts_at:-1}` (the partner's gigs, Today's tasks, earnings) · `{attendees.phone, starts_at:-1}` (HO review's repeat phones)
- feedback: `{agent_id, created_at:-1}` (daily cap) · `{created_at:-1}` · `{bucket, created_at:-1}` · `{follow_up.status, follow_up.due_at}` partial (detractors)
- testimonials: `{agent_id, created_at:-1}` · `{status, created_at:-1}` · `{status, shares:-1}` · `{status, bulk, created_at:-1}` · `{status, crop, created_at:-1}` · `{status, state, district, created_at:-1}` · `{testimonial_id}` partial (ObjectId) · `{pii_id}`
- testimonial_consents: `{pii_id, given_at:-1}` · `{agent_id, given_at:-1}`
- product_suggestions: `{agent_id, created_at:-1}` · `{status, created_at:-1}` · `{created_at:-1}` · `{product_key, created_at:-1}`
- commission_plans: `_id` only (read whole)
- withdrawals: `{agent_id, requested_at:-1}` · `{status, requested_at}` · `{status, paid_at}` · `{agent_id}` **unique partial `open: true`** (one open withdrawal per partner)
- tds_certificates: `{quarter, agent_id}`
- earning_cohorts: `{status, priority}` · `{rules._id}` **unique partial** (`rules._id` exists — a cohort with no rules would index `null`; a rule by id for HO's get / edit / archive, and no id in two cohorts)
- earning_rules: retired (rules are in `earning_cohorts.rules[]`); its `{cohort_id, trigger, status, order}` goes with the collection
- earning_assignments: `{agent_id, from:-1}` (history, cohort at a time) · `{agent_id}` **unique partial `open: true`** (one current stretch per partner across processes)
- rewards: `{status, created_at:-1, _id}` (HO queue; all statuses = an `$in` merge of the three) · `{agent_id, created_at:-1, _id}` (the partner's list and summary, the wallet's approved gigs)

## Shared — written
## Shared — written by this service with `source: 'vistaar'`

### `product_reviews` and `product_testimonials` (owner: Stockship v3 — its rows are `kkd_app`, `kkd_website`, `retailer`)

A partner's testimonial has no collection of our own (user's decision, 2026-10-22): it **is**
its `product_reviews` row, from the moment it is sent. Stockship's fields as its other writers
use them, plus one `vistaar` sub-document for what Stockship has no field for (user-approved).
Undecided it is `verified: false` — Stockship's lists hide it — with `rating: null`, since
Stockship's averages count every row not deleted. Raw driver, no schema or index declared
here; every read and write filters on `source: 'vistaar'` (+ `_id` for a write).

| Collection | Row | When |
|---|---|---|
| `product_reviews` | `_id` = first 12 bytes of sha256(`vistaar-testimonial:<app UUID>`) (a retried submit is a duplicate key), `source: 'vistaar'`, `verified` (approved only), `deleted` (rejected / removed), `verified_by` / `deleted_by` (HO email), `rating` (the stars once approved, else `null`), `review` (the farmer's words; wiped on consent withdrawal), `images: []`, `pii_id` (farmer), `user{contact +91…, email: null, name, profile_image: null}`, `type`, `bulk`, `family`, `created_at`, `updated_at`, `__v: 0`, **`vistaar{id` (app UUID), `agent_id`, `partner_name`, `village`, `district`, `state`, `product_name`, `crop`, `kind` video/photo/text, `rating` 1–5, `media_path` (private) + `media_url` (while approved) + `duration_sec`, `status` submitted/approved/rejected/removed, `reason`, `decided_by/at`, `approved_at`, `testimonial_id` (reserved; `null` for a quote), `gig_id` (reserved), `views`, `shares}`** | every kind, at submit; each HO decision moves `vistaar.status` and Stockship's flags in one write; never deleted |
| `product_testimonials` | `_id` (reserved at submit), `source: 'vistaar'`, `type`, `bulk`, `family`, `verified`, `deleted`, `verified_by` / `deleted_by`, `media{media_type video/image, media_url}` (download-token link), `review`, `pii_id`, `user{contact, name, profile_image: null}`, `feedbacks: []`, timestamps, `__v: 0`, `vistaar{id, agent_id}` (which submission) | video / photo only, on approval (upsert by `_id`); removal sets `deleted: true`; consent withdrawal deletes it |

HO can also file a testimonial directly on `product_testimonials` (`/admin/testimonials`); a
row a partner sent is refused there (`409 TESTIMONIAL_FROM_PARTNER`) and decided on
`/admin/testimonial-submissions`. Stockship's own app likes (`feedbacks[]`) are left alone.

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

### `app_counters` — one row, `_id: 'vistaar_orders'` (`KSV-n` order numbers)

Created once by hand (`{ _id: 'vistaar_orders', count: 0 }`, user's decision
2026-10-16: the series starts at `KSV-1`). `POST /orders/id` makes the same
`$inc: { count: 1 }` + `updated_at`, never upserted. The old Vistaar's
`KSV-` orders are still in `orders_v2` (beta: 127 of `KSV-1`…`KSV-271`), so
each process reads those numbers once at boot (one scan — `orders_v2` has no
`order_id` index) and holds them in memory; a taken number is skipped, and no
order waits on an `orders_v2` lookup.

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
`leads_v2` are not touched (only its `follow_up_date` is cleared, below) — as across the org, a customer is a person with an order. The hold lapses after
`lead_release_days` without work (or `customer_release_days` without an order, or at once
when the partner is blocked); the next partner to add the farmer takes the row over
(guarded on `updated_at`), and HO can transfer it. `leads_v2` is not touched by either,
except `follow_up_date` (the earlier partner's date is dropped).

**Follow-up mirrored to `leads_v2.follow_up_date`** (user, 2026-10-16), so the org's own
screens see when the farmer is next due. Every save that sets, changes or clears
`vistaar_v2_leads.next_follow_up` — add / re-submit, `PATCH` (incl. lost), takeover after a
release, HO transfer, the first order (won), and removing the lead (cleared) — writes the
partner's row first, then `updateOne({ lead_id, source: 'vistaar' }, { $set: { follow_up_date } })`
(`null` when cleared; nothing else, not even `updated_at`). A farmer from another channel
fails the `source` filter, so their lead keeps its own date; a row with no `lead_id` is
skipped. A `leads_v2` failure is logged, never answered to the partner. Follow-ups set
before 2026-10-16 reach `leads_v2` only on their next change.

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
| `follow_up_date` | `null` at insert; then the holding partner's `next_follow_up` (`null` when cleared) — `$set` of that field only, filter `lead_id` + `source` (above) |

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
| `piis` | `$set documents.<org_document>` = `{ id, image, back_image?, is_verified, validity: null, source: 'vistaar', verified_at }` — only if the slot is empty or ours; reject sets our `is_verified: false` | HO verifies / rejects a KYC document; HO approves a bank account change (`bank_details`, the new proof as `{ id: null, image }`) |
| `app_counters` | `$inc` on `_id: piis` — same as ko-sales | when a PII is inserted |

## Shared — read only

| Collection | Why |
|---|---|
| `orders_v2` (owner: Stockship) | the partner's orders: `{ marketplace: 'MKTP-5', agent: <VST id> }` (Stockship rewrites `source` on create), newest by `date`; status filter is `order_status $in`, `?customer=` adds `pii_id`. Customers: each farmer's confirmed business (count, Σ `total_amount`, latest) grouped by `pii_id` over the same filter, for the lists. Rides Stockship's `{ agent, order_status, date }` index. Never written here |
| `orders_v2` — commission | the partner's whole book for commission, wallet and My Performance: one aggregation on `{ agent, source }` (the `{ agent, order_status, date }` index), `order_status $nin` failed / pseudo / split / merged; projects lines (`sku, qty, total_price, is_free`), Σ discounts, coins, and only the delivery / cancel / return entries of `order_status_map`. Cached 60 s per partner |
| `products_v2` (owner: Stockship) | name, `hero_image`, `variant` of an order's skus, one `$in` per page, on its `sku` index. Also read **whole** (with `bulk_v2` → `gst_rate`, `category.cat_id`, and `categories_v2` → `name`) into memory hourly for commission's GST and My Performance's categories (~4,900 packs, 7 categories) |
| `agents_v2` | HO role (`user_role`), owner names; the owner's phone (`contact.phone_number`) for the app's reporting officer |
| `pincode_map_v2` | pincode → state / district (cached 6 h) |
| `franchises`, `prasar_v2_retailers`, `vistaaragents` | nearby-network warning at approval. ⚠️ `vistaaragents.latestCoordinates.coordinates` is stored `[lat, lng]` (swapped) — matched with a box, not a geo query |
| `orders_v2` — KKD & App activity | the partner's held farmers' **own** orders: `{ pii_id $in, marketplace $in MKTP-2 / MKTP-3 / MKTP-4, date ≥ earliest hold }`, newest first, ≤ 2,000; projects `order_id, date, pii_id, marketplace, sub_source, created_by, warehouse.warehouse_id, order_status, total_amount, items.sku, items.qty`. Rides `{ pii_id, date }`. MKTP-4 counts only when sold at a store (POS login `created_by` or the store's warehouse) and not `sub_source: 'founder_office'` |
| `franchise_v2_walkins`, `franchise_v2_prescriptions`, `franchise_v2_pos_orders` (owner: franchise backend) | KKD & App activity: walk-ins, crop advice, the POS archive (`in_stockship: false` only — the rest is in `orders_v2`), by `pii_id $in` **or** `phone $in` (10 digits), from the earliest hold, ≤ 2,000 each. No index on `pii_id` / `phone` there (48 / 11 / 507 rows on 2026-10-21) — see PROD-CHECKLIST |
| `kkd_events` (owner: Katyayani app) | KKD & App activity: `APP_LAUNCH` and `Cart Abandoned` by `user_id $in` (the farmer's 10-digit mobile) from the earliest hold, ≤ 2,000; projects `event_values.total_price` and `event_values.items.{name, quantity}`. Only `_id` is indexed — see PROD-CHECKLIST |
| `franchises`, `franchise_v2_franchises`, `employees` | KKD & App activity: the store list (id, address, city, state, pincode, phone, map point, warehouse id, email) and the POS logins that tie an MKTP-4 order to a store — from `employees` only `email` + `franchiseId` of rows with a `franchiseId`. Cached 60 s |

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
| `vistaar/testimonials/<agent_id>/<video\|photo>/<uuid>.<ext>` | private (signed URLs, 1 h) until approved; then a Firebase download token (the link on product pages), taken away on removal | the app, by a signed PUT from `POST /testimonials/uploads`. Deleted when the farmer withdraws consent |
| `vistaar/gigs/<agent_id>/<gig_id>/<uuid>.<ext>` | private, signed URLs (1 h) | the app, by a signed PUT from `POST /gigs/:id/photos/upload-url` (≤ 5 MB, jpg/png/webp/heic). Deleted when the partner removes the photo; kept (unlinked) when HO reopens the gig |

## External

| Source | Use |
|---|---|
| B2B Sales `GET /marketplace-products/v2` (`B2B_MARKETPLACE_CODE`) | Cart prices and stock. Fetched with the calling agent's B2B token (no server token — they expire). Cached in memory per instance (`CATALOG_CACHE_TTL_SECONDS`), shared across agents (prices are per marketplace), stale served up to 15 min while B2B is down. Page size must stay ≤ 100 — above it `avl_qty` is omitted |
