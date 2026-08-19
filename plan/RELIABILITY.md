# Sync and reliability

**Pillar:** 3 — Sync / reliability. **Start work from:** [ROADMAP.md](./ROADMAP.md).  
**Laws:** `docs/agent/domains/sync.md`

Infra and quotas, not a patient/data lifecycle. Was `RELIABILITY_FREE_TIER_PLAN.md`. Full text kept below. Core M23–M28 is complete. Parked IDs **R-1…R-6** are also listed on `ROADMAP.md`.

---

**Pillar:** 3 — Sync / reliability. Map: `plan/README.md`.

**Status:** M23–M28 **core COMPLETE** (`assert-free-tier-complete.mjs` exit 0, 2026-08-16). Remaining = parked list in §9 only.  
**Updated:** 2026-08-16  
**Code truth:** Desktop working tree; ship via AI Studio packs only  
**Domain:** `docs/agent/domains/sync.md` (Class L/X when touching merge/tombstones)

---

## 1. Literature & best practice (what the industry already learned)

These are the principles behind this program — not new invention.

| Principle | Source / practice | Apply here |
|-----------|-------------------|------------|
| **Separate blob storage from relational rows** | 12-factor / cloud data modeling; “never put large objects in the row store” | Photos, debug JSON, mealBuild, scratchpads → **R2 only**; Supabase holds URLs + thin fields |
| **CQRS-lite: list projection vs detail** | API design / GraphQL field selection / mobile offline guides | History list = projected columns; expand fetches detail once |
| **Keyset (cursor) pagination over OFFSET** | Postgres + large feeds (use-the-index-luke, Supabase docs) | `WHERE (updated_at, id) < ($c_ts, $c_id) ORDER BY … LIMIT n` |
| **One writer per entity / single source of truth** | Distributed systems; dual-write is an anti-pattern without outbox | Stop dual Firestore+Supabase profile/log paths |
| **Write amplification kills free tiers** | Firestore pricing model (charged per doc write); chat-on-every-keystroke is classic failure | Kill high-frequency writers first |
| **Authn before authz (RLS is not enough alone)** | OWASP API Security; “never trust client uid” | Verify Firebase ID token on sync/job proxies; service_role only after auth |
| **Idempotent async jobs** | Queue workers (Sidekiq/Bull/Cloud Tasks patterns) | Job id stable; submit → durable status → poll; recover interrupted |
| **Retry with exponential backoff + jitter** | AWS Architecture; Google SRE | Wrap Gemini `generateContent` only — not infinite UI spins |
| **Observability before migration** | “Measure, then cut” | Instrument egress/writes before D1 or big rewrites |
| **Strangler fig over big-bang rewrite** | Fowler / industry migrations | Extract routes & kill writers incrementally; no 766KB rewrite |
| **Tombstones for multi-device delete** | CRDTs / offline-first (e.g. RxDB, Couch) | Existing law: absence ≠ delete |

### Experience-based ranking (personal-app free tiers)

1. **Quota crashes** almost always come from **write storms** (chat, telemetry, dual profile) before storage GB.  
2. **Egress bills** almost always come from **SELECT \*** + **fat JSONB** + **re-downloading history**, not from “having Postgres.”  
3. **D1 / edge SQL** is a **second migration**, not a free fix for dual-write or fat pulls.  
4. **Monolith splits** improve maintainability; they do **not** stop resource-exhausted by themselves.

---

## 2. Current-state audit (do not rebuild DONE work)

| Area | State | Evidence |
|------|--------|----------|
| Food/biomarker dual-write to Firestore | **DONE removed** | `syncUtils.syncLogsWithTimeBuckets` comment: Supabase sole store |
| Base64 images in Supabase food rows | **DONE cleaned** | R2 migrations + push interceptor; size check scripts |
| Debug / cold logs to R2 | **DONE pattern** | `debug_url`, strip helpers, cold debug |
| UI history page size 15 + lazy images | **DONE (UI only)** | `FOOD_HISTORY_PAGE_SIZE = 15` — **not** server cursor |
| Job crash recovery | **PARTIAL** | `recoverInterruptedServerJobs` — soak; not a new pack |
| Chat auto Firestore write | **DONE (M23)** | IDB primary; `[FreeTier] chat cloud write disabled` |
| API telemetry Firestore batch | **DONE (M23)** | `[FreeTier] telemetry cloud write disabled` |
| Profile dual-write | **DONE (M24 assert)** | Single writer; do not reintroduce `setDoc` profile |
| Pull `SELECT *` all logs | **DONE (M25 assert)** | Projected / keyset markers on `/api/sync/supabase-pull` |
| Fat `agent_jobs` JSONB | **DONE (M26 assert)** | Thin status + R2 |
| Proxy authn | **DONE (M27 assert)** | Firebase ID token |
| Gemini retry | **DONE (M28)** | `withGeminiRetry` |
| `server.ts` monolith | **OPEN — parked** | §9; not a free-tier crash fix |

**Historical claim (~83MB / 20–30 logs)** maps to **base64 era**. Re-measure if quota returns; do not re-migrate images.

---

## 3. Where the original 6-phase plan fails

| Failure mode | Why it happens | Mitigation |
|--------------|----------------|------------|
| **Stale diagnosis** | Plan targets dual-write in `firestoreUtils` / `SupabaseJobSync` | Correct targets: chat, telemetry, profile dual-write, fat pull |
| **Re-doing R2 migrations** | Agents re-upload base64 work already done | Pack §C “Already DONE” |
| **UI pagination ≠ data diet** | Slice(15) after full download still burns egress | Server projection + keyset |
| **RLS theater** | Policies present but service_role trusts client `uid` | Token verify first |
| **Big-bang router split** | Studio weak on 15k-line rewrites; merge hell | Strangler extracts |
| **D1 too early** | Rewrites Realtime/JSONB/jobs for unmeasured gain | Park until post-diet metrics fail free tier |
| **Detect without repair** | Flags quota but still writes | Kill write path |
| **Sync regression** | Full replace server list → ghost/loss | Keep mergeByRecency + tombstones |
| **Dual job paths** | Client SSE + server jobs diverge | Converge later pack; don’t mix into write kill-switch |
| **Repo fork (`-2` vs `-6`)** | Two origins, ambiguous ship target | One shipping repo; Desktop truth until push |
| **Overclaim COMPLETE** | “Infrastructure fixed” without gate | ≤6 IDs + assert exit 0 |

---

## 4. Optimized target architecture (near-term)

```text
Firebase Auth          → identity only (50k MAU class limits; no app-data writes)
Supabase Postgres      → thin rows: food_logs, biomarker_logs, profiles, agent_jobs (status only)
Cloudflare R2          → photos, debug JSON, mealBuild blobs, backend logs
Cloud Run (Express)    → AI + sync proxies + job workers (in-process → optional later split)
Local IDB              → chat transcripts, offline cache, in-flight jobs
```

**One writer per entity** (binding):

| Entity | Writer |
|--------|--------|
| Food / biomarker logs | Supabase only |
| Profile + tombstone maps + dashboard blobs | Supabase only (debounced) |
| Jobs (thin status) | Supabase via server |
| Blobs | R2 only |
| Chat | **IDB primary** (cloud optional rare export — off by default) |
| Telemetry | Local only (no free-tier DB) |

**Deferred “forever free hardcore”:** Cloudflare D1 + Pages only if **after** packs below, measured egress/writes still threaten free tiers.

---

## 5. Optimized pack program (ship order)

| Pack | Name | Goal | Class | ≤6 IDs |
|------|------|------|-------|--------|
| **M23** | Firestore write kill-switch | Stop chat + telemetry free-tier write storms; assert food/bio remain Supabase-only | L | 6 |
| **M24** | Profile single-writer | Profile/dashboard/reports/foodImages → Supabase-only; Firestore profile writes off | X | 6 |
| **M25** | Supabase payload diet | Projected SELECT + keyset pagination on pull; no full `SELECT *` history | L | 6 |
| **M26** | Thin agent_jobs | mealBuild/scratchpad off JSONB; progress flush throttle; R2 URLs only | L | 5 |
| **M27** | Authn on proxies | Firebase ID token on sync/job routes; drop trust-client-uid | X | 5 |
| **M28** | Gemini resilience | Retry/backoff wrapper; timeout → failed job; candidate cap audit | M | 4 |
| **M29** | Job path unify | Prefer server submit+poll; document/disable dead SSE path | L | later |
| **M30** | Optional CDN / D1 study | Pages for static; D1 only if metrics demand | — | research |

**Do not** open M24–M26 until M23 gate green.  
**Do not** open M27 until M24 green (auth on dual-write is worse than auth on single writer).

---

## 6. Success metrics (measure each pack)

| Metric | Before (re-baseline) | After M23–M26 target |
|--------|----------------------|----------------------|
| Firestore writes / active day | Often hits 20k | **≪ 1k** (ideally ~0 app-data writes) |
| Supabase egress / day | Spike risk | Dominated by intentional image CDN (R2), not JSON dumps |
| Login pull payload | Full `SELECT *` | Projected page ≤ N rows |
| `resource-exhausted` incidents | Daily risk | None under normal personal use |
| Food/bio multi-device | Must stay correct | merge + tombstone soak |

---

## 7. Explicit non-goals (this program)

- Rewriting nutrient math / food-calc pipeline  
- Temporal/LangGraph  
- Full `server.ts` Controller-Service rewrite  
- knip-only dead code as a milestone  
- E2E Playwright before M25  
- Migrating primary DB to D1 in M23–M28  

---

## 8. Studio ship path

### Preferred: one continuous master pack

```text
plan/RELIABILITY_FREE_TIER_PLAN.md
  → studio/M23_FULL_FREE_TIER_RELIABILITY.md   ← upload THIS for full program
  → Studio iterates M23→M28 until:
       node scripts/assert-free-tier-complete.mjs  exit 0
  → tsc + sync vitest
  → AI Studio commit/push
  → archive + AI_HANDOVER update
```

### Optional: single-phase only

```text
studio/M23_FIRESTORE_WRITE_KILL_SWITCH.md  → m23 gate only (not full program)
```

Local agents may commit/push after COMPLETE (`tsc` + named gates).

### After master COMPLETE — still optional later

Absorbed from archived `Reliability_perf.md`. **Do not start these to “finish reliability.”** Start only if the trigger is true.

| ID | Item | Trigger | Abandoned if |
|---|---|---|---|
| R-1 | Re-measure Firestore writes / Supabase egress on a normal day | Quota or bill spike | — |
| R-2 | Cloudflare Pages for `dist/` | Global static latency actually hurts | Never required for personal use |
| R-3 | Playwright E2E (upload → parse → edit → save) | After soak; not before | Not a substitute for class goldens |
| R-4 | Extract `server.ts` routes (food / jobs / biomarkers) | Touching the monolith anyway | Do not big-bang for free-tier |
| R-5 | Investigate D1 as primary SQL | **After** R-1, free tier still fails | Default: stay on thin Supabase + R2 |
| R-6 | Job crash recovery soak | Interrupted jobs still orphan | Partial today — fix the bug, no new plan |
| R-7 | knip / memoize `getBiomarkerStatus` | Never a reliability gate | **Abandoned** as a milestone |
| R-8 | Measure client TTI + request count (Home / Health / first chat) | Page feels slow (**now true**) | No unmeasured “60%” claims |
| R-9 | Defer golden ingest + full job hydrate past first paint | After R-8 baseline | Do not extract `App.tsx` to do this |
| R-10 | Header code-split (theme audit, Drive backup, catalog admin, quota) | After R-9 | Do not grow Header |
| R-11 | Keep `HomeTab` / `LogChat` out of other tabs’ first paint | Regression check after R-10 | Do not eagerly re-import |

R-8–R-11 are **client speed**. They do not reopen M23–M28. Method and catalog: `QUALITY.md` §13. Execute order: `ROADMAP.md` platform program.

---

## 9. PostgREST Egress & Data Conservation Best Practices (< 50 MB / Month Target)

### 9.1 Root-Cause Analysis (Why 9.60 GB Historical Egress Occurred)
1. **Historical Base64 Images (~85% of total egress):** Prior to M23–M28, food photos were stored as raw base64 data (2–8MB each) in `food_logs.image_urls`. Every `.select('*')` multi-device sync pulled hundreds of MBs per session, peaking at **2.7 GB on 31-Jul** and **2.4 GB on 08-Aug**.
2. **Full Table `SELECT *` without Column Projection (~10%):** Fetching entire collections including unused metadata and JSONB blobs (`profiles.data`, `agent_jobs.clean_result`, `issue_backlog.payload`) rather than projected thin fields.
3. **Unbounded Sync Queries on Every Reload (~5%):** Calling `fetchAllConsolidatedLogs` without passing `lastSyncTime`, causing the client to redownload 1,000 food and biomarker records on every page reload, session restore, or tab focus.

---

### 9.2 The 5 Golden Rules of Data Conservation

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                       5 DATA CONSERVATION LAWS                              │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1. Incremental Delta Syncing  → WHERE updated_at >= lastSyncTime (0 rows)   │
│ 2. Explicit Column Projection → SELECT id, date, name (never SELECT *)      │
│ 3. 100% Blob Offload to R2    → Photos/Debug to R2 (Supabase holds URLs)    │
│ 4. Gated Background Polling   → Poll only when hasActiveJob === true        │
│ 5. Single Authoritative Store → Supabase sole DB; IDB/LocalStorage cache    │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Rule 1: Incremental Timestamp Delta Syncing (Zero-Cost Verification)
- **Law:** Always supply `lastSyncTime: parsedLocal.lastSyncedAt` to synchronization pull endpoints.
- **Impact:** When no remote changes have occurred, `gte('updated_at', ts)` returns `[]` (empty array), consuming **< 500 bytes** over the wire instead of re-downloading entire multi-megabyte collections.
- **Exception:** Full collections (`lastSyncTime = undefined`) are strictly reserved for explicit user actions ("Force Pull" / "Force Replace Local").

#### Rule 2: Explicit Column Projection (No Wildcard `SELECT *`)
- **Law:** Never use `.select('*')` on tables that contain JSONB blobs or unstructured payloads (`food_logs`, `biomarker_logs`, `profiles`, `food_items`, `dish_cache`, `agent_jobs`).
- **Impact:** Restricts serialization strictly to scalar IDs, names, dates, and numbers. Drops network payload per row by up to 95%.

#### Rule 3: 100% Blob Offload to Zero-Egress Storage (Cloudflare R2)
- **Law:** Never write binary data, Base64 images, raw LLM multimodal streams, or debug logs to Supabase or Firestore tables.
- **Impact:** Images upload to Cloudflare R2 (free unlimited egress). Supabase Postgres stores only the compact 90-character URL pointer (`https://pub-...r2.dev/photos/...jpg`). Average row size stays **< 300 bytes**.

#### Rule 4: State-Aware Conditional Polling
- **Law:** Never set up unconditional `setInterval` database polling loops.
- **Impact:** Fallback job polling is gated strictly on active job presence (`hasActiveJob = true`). When all jobs are complete, zero background network traffic is generated.

#### Rule 5: Single Authoritative Writer per Entity
- **Law:** Stop dual-writing entities across Firestore and Supabase.
- **Impact:** Eliminates write amplification, prevents race conditions, and ensures clean cache hydration from LocalStorage/IndexedDB.

---

### 9.3 Diagnostic & Monitoring Toolkit

#### 1. PostgREST Top Paths Diagnostic (Supabase Logs Explorer)
Run this SQL query in **Supabase Dashboard > Logs > Edge Logs** to detect any emerging high-traffic routes:

```sql
select
  request.path as endpoint,
  request.method as method,
  count(*) as request_count
from
  edge_logs
  cross join unnest(metadata) as metadata
  cross join unnest(metadata.request) as request
where
  request.path like '/rest/v1/%'
group by 1, 2
order by request_count desc
limit 20;
```

#### 2. Automated Local Row-Size & Image Audit Script
Run locally to verify that all images remain in Cloudflare R2 and no fat rows exist in database tables:
```bash
npx tsx scripts/check-supabase-row-sizes.ts
```
**Expected Target Output:**
- `Remaining Base64 images: 0`
- `Average Row Size: < 300 bytes`

---

**Abandoned from the 6-phase draft (do not rebuild):** dual-write removal in `firestoreUtils` / `SupabaseJobSync` (already gone); re-running image→R2 migrations; RLS-only without token verify (M27 did token verify).
