# ⚡ Performance and capacity

> Measured 2026-10-13 on a 12-core laptop: the production build (`NODE_ENV=production`)
> against the **beta** Mongo, which is ~28 ms away over the network. The load generator
> (autocannon) ran on the same machine, so absolute numbers are a floor. A production
> server next to its database (~1 ms) will be faster per request.

## 1. 📊 Results

Requests per second for **one Node process**, 50 connections at once, before and after the
optimisations in section 3:

| API | DB calls per request | Before | After | p50 after |
|---|---|---|---|---|
| `/faqs` (cached) | 0 | ~600 | **~1,700** | 27 ms |
| `/banners` | 1 → **0** (cohort cached) | ~700 | **~1,630** | 28 ms |
| `/attendance/today` | 1 | ~660 | **~880** | 54 ms |
| `/events` | 2 → **1** | ~550 | **~840** | 56 ms |
| `/stories` | 1 (+ image signing) | ~680 | **~780** | 60 ms |
| `/stories/content` | 2 → **1** | ~460 | **~560** (720 at 200 conn.) | 82 ms |
| `/orders` | 2 → **1** (short page) | ~455 | **~520** | 92 ms |

At 200 connections, `/stories/content`'s slowest 1% went from **4.3 s to 0.38 s**.

**4-worker cluster** (`pnpm start:cluster`, 200 connections; measured while Redis was still in the design — the request path is the same with in-memory limits):

| API | Requests/s | p50 |
|---|---|---|
| `/faqs` | **~6,200** | 28 ms |
| `/attendance/today` | **~2,070** | 92 ms |
| `/events` | **~1,730** | 98 ms |
| `/stories/content` | **~1,140** | 144 ms |

The cached APIs scale with cores. The DB-bound ones roughly doubled; past that they were
held back by the beta Mongo and its 28 ms round trip.

## 2. 👥 What it means in users

| Assumption | Number |
|---|---|
| An active user sends ~1 request every 10 s | — |
| One process, mixed traffic, ~800 req/s | ≈ **8,000 users at the same moment** |
| One 4-core VM (cluster) | ≈ **25,000–35,000** |
| 20M registered, 1–2% online at peak | 200K–400K at once → 20K–40K req/s |
| Processes needed | **~25–50** (about 7–12 four-core machines), plus a Mongo cluster sized for ~20K queries/s |

## 3. 🔧 What was optimised

| # | Change | Where | Effect |
|---|---|---|---|
| 1 | One short log line per request (id, method, URL, status, time); `/health` not logged | `core/logging/http-log.config.ts` | Default serializers wrote ~1.3 KB of headers per request: **2–3× throughput** on cheap routes |
| 2 | Cluster entry: one worker per core, dead workers restarted | `src/cluster.ts`, `pnpm start:cluster` | Throughput × cores (6,200 req/s on 4 workers) |
| 3 | Signed image URLs reused while 15+ min remain (LRU, 50K) | `StorageService.sign` | Signing is ~1.6 ms of CPU each, up to 40 per "My stories" page |
| 4 | Partner cohort cached 60 s (LRU, 100K) | `AgentsService.cohortById / cohortByAgentId` | One DB call fewer on banners, events, My Story |
| 5 | Shared part of `/stories/content` built once per 15 s; seat lookup skipped when no events | `StoriesService.sharedContent`, `EventsService` | Only the partner's events are per request |
| 6 | **No Redis.** Caches and the per-partner request limit stay in server memory; **OTP attempt counts** (3 SMS, 5 guesses / number / 10 min) go in Mongo `vistaar_v2_otp_attempts` with one atomic update | `OtpAttemptRepository`, `OtpService` | OTP limits hold across all processes; verified on beta: 10 concurrent guesses → exactly 5 allowed |
| 6b | Public cached reads (terms, signup forms) 60 → 600 per minute per IP | `terms`, `onboarding` controllers | Phones behind one carrier IP (CGNAT) no longer block each other. OTP limits unchanged |
| 7 | Upload paths carry a signed receipt; a fresh one skips the bucket check on save | `receiptStem / readReceipt`, `StoriesService.requireUpload` | Saving a story: **2 bucket calls fewer** (~100 ms warm, 1–2 s cold each) |
| 8 | `/orders` counts only when the page is full | `OrderRepository.list` | Most partners have < 1 page: no count on Stockship's shared `orders_v2` |
| 9 | Mongo pool sizes set by env (`50` / `5`) | `database.module.ts` | Processes × pool stays inside the server's connection limit |

## 4. 🚧 Still to do (outside this code)

| What | Who |
|---|---|
| Run the app in the **same region** as the production Mongo | Ops |
| Create the `vistaar_v2_otp_attempts` TTL index on production (`PROD-CHECKLIST`) | Ops / DBA |
| Build the `PROD-CHECKLIST` indexes on production (beta's disk is full, so none are built there) | Ops / DBA |
| `{ agent: 1, date: -1 }` on `orders_v2` once partners have thousands of orders | Stockship |
| Re-run this load test against staging with production-like data | Backend |

## 5. 🧪 How to re-run

1. `pnpm build`, then start `PORT=3100 NODE_ENV=production node dist/main.js`. Use a test
   build with the default throttle raised, or tokens for many partners, or the per-user
   limit (120 per minute per route) will answer 429.
2. Mint partner tokens with `VISTAAR_JWT_SECRET` (`sub` = the agent `_id`, plus `agent_id`,
   `pii_id`, `typ: 'access'`, issuer `vistaar-api`, audience `vistaar-app`).
3. Run autocannon per route for 12 s at 50 and 200 connections, and compare with section 1.
