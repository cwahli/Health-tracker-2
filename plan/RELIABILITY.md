# Sync and reliability

**Pillar:** 3 — Sync / reliability. **Start work from:** [ROADMAP.md](./ROADMAP.md).  
**Laws:** `docs/agent/domains/sync.md`

Infra and quotas, not a patient/data lifecycle. Was `RELIABILITY_FREE_TIER_PLAN.md`. Full text kept below. Core M23–M28 is complete. Parked IDs **R-1…R-6** are also listed on `ROADMAP.md`.

---

**Pillar:** 3 — Sync / reliability. Map: `plan/README.md`.

**Status:** M23–M28 **core COMPLETE** (`assert-free-tier-complete.mjs` exit 0, 2026-08-16). Remaining parked R-ids are in §8–9. Standing gate for every new feature or update is §10.  
**Updated:** 2026-09-04  
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

## 8. Ship path

Core M23–M28 is **done** (`assert-free-tier-complete.mjs`). Remaining R-ids are on [ROADMAP.md](./ROADMAP.md) Track R (trigger only). No studio pack.

Local agents may commit/push after COMPLETE (`tsc` + named gates).

### After master COMPLETE — still optional later

Absorbed from archived `Reliability_perf.md`. **Do not start these to “finish reliability.”** Start only if the trigger is true.

| ID | Item | Trigger | Abandoned if |
|---|---|---|---|
| R-1 | Re-measure Firestore writes / Supabase egress on a normal day | Quota or bill spike | — |
| R-2 | Cloudflare Pages for `dist/` | Global static latency actually hurts | Never required for personal use |
| R-3 | Playwright leftover-English crawl plus Kosong empty Front Desk | After Track **S-1** string list is green; not a 10-case meal loop | Not a substitute for class goldens |
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

---

## 10. Reliability process for every new feature or update (2026-09-04)

Applies to AI Studio, Grok Bot, OpenCode, Antigravity, and humans. Track S on ROADMAP.md is only the burn-down of classes found in the 2026-09-03 live pass. This section is the standing gate so the next feature does not recreate those classes.

Infra and quotas stay in sections 1 to 9. Test method stays in QUALITY.md.

### 10.1 Before you write

If it is a bug: pick or add one class on Track S or an existing B / F / L / Q id. The work item is that class, not a live case.

If it is a feature or update: name which slices in 10.2 you must not regress, and add or extend the named vitest in the same change.

### 10.2 Gate table (new work, same change)

| If you touch | You must also | Named gate |
|---|---|---|
| UI chrome or copy | EN and ID keys in the same PR | src/utils/i18n.test.ts |
| Agent replies (Front Desk, coach, dietitian, medical) | Follow profile.language | dietitianInstructions.i18n.test.ts or handoffContract.test.ts |
| Vision or meal analyze | Heal truncated JSON; no raw fatal string to the user | server_vision_scout.test.ts |
| Meal numbers or meal card | Honest residual; show C/F if macros are shown | tests/golden_meals.test.ts |
| Demo, profile switch, or chat keys | Empty Kosong still wipes Front Desk | src/utils/storageUtils.test.ts |
| Front Desk or specialist handoff | UC fixture contract | src/server/receptionist/handoffContract.test.ts |
| Biomarker ingest or units | Class golden, not paint a 140-row NHS file green | tests/golden_biomarker.test.ts |
| Sync, jobs, or row size | One writer; no fat JSONB or base64 in rows | existing M23 to M28 asserts |
| `serverJobs` / submit / poller / Log Meal card / food-analyze SSE | Add or extend a **food process** row (dummy fixture, no Gemini). Walk every worker exit in QUALITY.md §1.3.1 — do not only test the dump’s branch | `src/utils/dumpContract.test.ts` + `server_gemini_retry.test.ts` + `src/jobs/__tests__/JobStore.test.ts` until Q-8 named files exist |
| medical-analyze / Apply / ingest job terminal | Biomarker **process** row (share stall/persist/SSE laws with food) | process-bio named vitest (Q-8.4) |
| Front Desk handoff / auto-send | Receptionist **process** row; specialist job then uses food or bio process board | `handoffContract.test.ts` + process-desk (Q-8.5) |

### 10.3 Order of work

1. Named vitest first (content **and** process rows for that domain).
2. Smallest change that makes that gate green.
3. One frozen dummy fixture (recorded SSE/status) if the golden cannot see the UI. Not a new live meal.
4. No live case matrix as the inner loop.
5. **One** Tier 3 confirm after those rows are green: website live **or** API live, not both. Human or a script. Grok Bot does not sit in the wait loop.

### 10.4 Who runs new work

| Who | Does | Does not |
|---|---|---|
| OpenCode plus Token Plan Qwen | One class or one feature slice | Whole-file rewrite of huge chat files |
| OpenCode plus DeepSeek PAYG | Same, after Token Plan is gone | New Alibaba CLI |
| Antigravity on chiwah.liu@gmail.com | Large class-fix only | The other Google weekly pot |
| Grok Bot | Triage a red golden or review a short diff | Click remaining live cases |
| Aider or Lingma or Qwen Code | Do not use | — |

### 10.5 Playwright (two jobs — do not mix)

| Job | ID | Gemini? | What |
|---|---|---|---|
| Chrome smoke | **R-3** | No | Leftover-English crawl + Kosong empty Front Desk after S-1 list is green. `prototype/tests/*.spec.ts`. Not a meal-analyze soak. |
| Job card vs status | **Q-8.3** | No | Stub `/api/jobs/*` (and SSE). Card is not “Attempt 1 of 3” / Retry when the stub is `succeeded` with kcal; stays in-flight when `running` with no meal. |

Live Playwright that clicks Log Meal and waits on Gemini is **Tier 3**, not R-3 or Q-8.3. Do not use Grok Bot for that.

### 10.6 Chat and demo (S-5)

Empty-demo reseed must wipe chat keys and jobs (landed 155a49a). New stale-thread bugs extend storageUtils.test.ts; they do not start as a live Kosong click-through.

### 10.7 Unified Testing Pyramid (Vitest + Playwright + Live Model Benchmark)

Three **budgets** (not four live meals). Four surfaces: units, stubbed UI, live worker, live site. An agent on the live site is the same slot as the human.

```text
TIER 1  Every code change. Named vitest + tsc. 0 Gemini.
        Content goldens (G*, G-B, UC) + process goldens (Q-8).
        COMPLETE = matching regression-map row, not npm test.

TIER 2  When UI shell or job-card wiring changed. 0 Gemini.
        R-3 chrome/Kosong. Q-8.3 card vs stubbed job status.

TIER 3  Once per class/milestone. Real Gemini. Pick ONE shape:
        website (card+worker) OR API submit (worker only).
        Website subsumes API. Human or a script — not Grok in the wait loop.
        New class on that dump → add a process row, stop. Do not re-upload.
```

Also: `npm run test:benchmark:receptionist` / `test:benchmark:biomarkers` stay as optional Tier 3 shapes for those domains — still **once**, never inner loop.

#### How the Golden Tests and Journeys Fit:

1. **Golden Fixtures (Ground-Truth Invariants in Tier 1):**
   - **Files:** `tests/Golden_meal/G1..G7` and `tests/Golden_biomarker/examples/G-B1`.
   - **Test runner:** `npm run test:golden` (runs `tests/golden_meals.test.ts` and `tests/golden_biomarker.test.ts`).
   - **Role:** Immutable **content** anchors (identity, grams, Atwater, lab units). Process goldens (Q-8) sit beside them and score job exits. Do not collapse into one all_green tape.
   - **When to run:** Content — calc/catalog/portion/lab math. Process — `serverJobs`, submit, poller, card, SSE.

2. **Golden Journeys (User Critical Path in Tier 2):**
   - **Files:** `prototype/tests/key-journeys.spec.ts`.
   - **Test runner:** `npm run test:e2e` (or `npx playwright test prototype/tests/key-journeys.spec.ts`).
   - **Role:** Tests the "Golden Path" of user interaction in the real browser. Covers:
     - Journey 1: App Initial Load & Navigation Shell.
     - Journey 2: Tab Switching & Sub-tab Navigation.
     - Journey 3: Quick Action & Chat Logging Sheet interaction.
     - Journey 4: Health Portal & Biomarker Inspection.
   - **When to run:** Shell/nav/modals (R-3) or job-card wiring (Q-8.3). Stubbed. Not live Log Meal.

3. **Golden Promotion Lifecycle (Bug → Fixture):**
   - Capture the debug.md (one live job).
   - Classify **all** process oracles on that dump (`test-from-debug`). Content bugs still promote to G* / G-B*.
   - Process bugs promote to a **process-board row + dummy fixture**, not G8.
   - Historical dump stays red. Dummy replay / code probe goes green.
   - Walk remaining worker exits (QUALITY.md §1.3.1) in the same pass so the next meal is not an unnamed class.

#### How the Three Tiers Work Together:
1. **Tier 1** protects laws (math, identity, job exits, tombstones). Process green + FALSE_FRIEND is still a bug — do not delete content goldens.
2. **Tier 2** protects stubbed UX (chrome, card vs status). Not live Analyze.
3. **Tier 3** is one live confirm that the **this build’s** worker (and card, if website) still work with real Gemini. Never a PR blocker; never Grok watching screenshots for four minutes.

The download from that run is the **debug file** (§11). Inner loop after the download is `test-from-debug`, not another meal.

---

## 11. Debug file — contract report (the run artifact)

**Canonical truth (do not strip):** [docs/agent/domains/debug-contract.md](../docs/agent/domains/debug-contract.md). If this section and that file disagree, **the domain file wins**. ROADMAP F-8.13 / Q-8 are execute IDs only.

**Why this section exists:** Soto dumps were long, duplicated, and still missing the card. The pipeline matrix looked like a scoreboard and **lied** (calc Standby while logs had a finalized ledger). Agents then guessed. This is the execute-facing summary; the domain file is the full law.

**Code:** `src/utils/debugPayload.ts` (one writer) · `src/utils/dumpContract.ts` (scorer) · `scripts/test-from-debug.ts`  
**Execute:** [ROADMAP.md](./ROADMAP.md) **F-8.13** (file shape) + **Q-8** (process/UI laws). Do not add a sixth `plan/` file.

### 11.1 Job of the file

One download per job. Same bytes for a human and for vitest.

It must answer: **did this run complete the contract?**  
PASS/FAIL per law, with a **shape fault** (MISSING / DUPLICATE / WRONG_PLACE / WRONG_TIME / WRONG_COUNT) and a **layer** (ui / content / process).

It is **not** a second copy of `server_food_analyze_run` logs, not a meal-green tape, and not G8.

**Invariants (do not drop when adding packs / handoff / edits):**

1. **One writer** — `buildDebugMarkdownReport` only (§11.3.1).
2. **Contract table first** (after identity) — every applicable law PASS/FAIL with MISSING / DUPLICATE / WRONG_PLACE / WRONG_TIME / WRONG_COUNT (§11.3.10, §11.7).
3. **Snapshot at Download** — **dialog inventory** (structured tree of the open modal), not a screenshot and not innerHTML. Card chrome + displayed macros + control counts. Optional PNG on R2 for humans only (§11.3.9, §11.12).
4. **Fixed section order, one heading each** — later sections **point**, they do not reprint kcal (§11.3.2–3, §11.4).
5. **Prompts once per dispatch that ran** — received + instruction + user + output once; not again in the log excerpt (F-8.13, §11.3.4, §11.5).
6. **Matrix must match logs** — Finalized ledger ⇒ calc Connected, never Standby (`DEBUG_MISS`, §11.3.8).
7. **Same scorer at download and in vitest** — `classifyDump` / `dumpContract` / `test-from-debug`. Do not fork a second classifier (§11.7, §11.9).

### 11.2 Two kinds of duplicate and missing (do not mix)

| | **Malformed file** (builder bug — always FAIL the debug tests) | **Real job fault** (contract FAIL — keep in the file, do not “clean up”) |
|--|--|--|
| **DUPLICATE** | Same `##` heading twice; same breadcrumb row pasted twice; scout instruction in “Agent prompts” **and** pasted again in backend logs; matrix + body restating the same totals as three tables | `AnalyzeFinished` ×4; user clicked Retry twice because the job failed; two runner loops; two dishes that both ran |
| **MISSING** | No session trail; no contract table; no card snapshot; matrix Standby while `[Budget] Finalized ledger` is in the log (`DEBUG_MISS`) | No `{final,result}`; no 3.1 hop after stall; dish dropped; Retry showing while succeeded |

**Law:** Dedupe **serialization** (builder). Never dedupe **process** (session events, AnalyzeFinished, real Retry clicks). If the job did it twice, the file shows it twice **and** the Contract table says DUPLICATE. Pretty dumps that hide storms are a defect.

### 11.3 Builder laws (`buildDebugMarkdownReport`)

1. **One writer.** All markdown downloads go through this function. No second formatter in the debug route.
2. **One section per topic, one heading.** `headingCount === 1` for each `##`. Tested.
3. **Each fact once.** Later sections **point** (“ledger: see Contract / Calc”) instead of reprinting kcal tables.
4. **Prompts once per dispatch that actually ran** (F-8.13): lead, each worker, edit. Schema/instruction not pasted into the log excerpt.
5. **Breadcrumbs:** unique by `timestamp + action + target + details`. A real second click at a new timestamp stays (process DUPLICATE). Copy-paste of the same row is malformed.
6. **Logs:** keep status, error, ledger, stall, hop, stage lines. Strip inlined system/user prompts that already have a Dispatch section.
7. **No base64.** Photos = https URLs only (`stripHeavyImages`).
8. **Matrix is derived from the body, not a separate guess.** If logs have Finalized ledger, stage 5 is Connected. Matrix vs body mismatch = contract FAIL (`DEBUG_MISS`), not a green Standby.
9. **Snapshot at Download click** — **dialog inventory**, not a screenshot as source of truth, not the whole modal HTML (that reprints kcal and is unscorable).
   - Job: `status`, `inFlightTurnAt`, `pendingFoodLog?`, AnalyzeFinished count
   - Open dialog (if any): `pack`, title, `on_card` macros `{kcal,P,C,F}` (must match ledger or WRONG_TIME)
   - `visible` / `hidden` control ids: Retry, Attempt 1 of 3, View Analysis, Download Debug, Log Meal CTA
   - Composer: Take picture / Add image / paste / send present? counts === 1
   - Expand: worker/tiles open if `shouldExpandMealAgent` was true this turn (WRONG_COUNT if not)
   - Optional: one dialog screenshot URL on R2 for the human when a UI contract row is FAIL. Contract scores the inventory, never the PNG.
10. **Contract table is the first body section** (after identity: job id, status, mode, photos, exportedAt).
11. **Exhaustive ≠ long.** Score **every** law for this pack (QUALITY.md §1.3.1 + §11.7). Include evidence **only** to prove a FAIL or to make a PASS auditable (one ledger line, one stall line).
12. **Surface pack** (the file is **not** one layout). Pack = `food` | `receptionist` | `medical` | `health_coach`. Wrong pack’s sections = WRONG_PLACE. See §11.4.
13. **Durable capture.** Console errors, network/activity errors, last user actions, breadcrumbs, session trail, and **every agent I/O that ran** are first-class. Dropping them in a later refactor is a builder FAIL (`debugPayload.test.ts` fixtures per pack must still contain those headings). Do not “simplify” the download by omitting them.
14. **Agent I/O once.** For each dispatch that ran: **received** (payload) + **instruction** + **user text/answers** + **output**. Exactly one block. Not also inside backend logs, not also as a second “prompts” appendix. Multi-edit and handoff = **one block per turn / per agent**, keyed, not a concatenated blob.
15. **JSON tree is canonical; markdown is a view.** `classifyDump` scores the structured run (cold debug JSON). Markdown is printed from that tree. Do not keep regex-on-`.md` as the only scorer (§11.12).
16. **Correlation id.** `jobId` (and turn/dispatch id) on console lines, network errors, and server log lines so the file can join them. Handoff carries the same id.
17. **Per-dispatch signals.** Each dispatch block also records `model`, `latency_ms` (time-to-first-token if streamed — Soto stall), `tokens` if the API returned them, `error` / finish. Missing on a dispatch that ran = malformed.

### 11.4 Packs and required sections

Omit a section only when that pack **did not run** it. If it ran and the section is absent → malformed file. Shared chrome (0–5, 12–13) is on **every** pack.

**Shared (all packs)**

| # | Section | Once | Must not lose |
|---|---------|------|----------------|
| 0 | Identity | yes | jobId, status, mode, pack, exportedAt, photo URLs |
| 1 | **Contract** | yes | Scoreboard for **this pack’s** laws |
| 2 | Last user action | yes | The click/prompt that triggered this download or last send. Explicit empty if none |
| 3 | Breadcrumbs | yes | Last actions (cap e.g. 80 **distinct** rows). Dedupe identical copies; keep real re-clicks |
| 4 | Session trail | yes | Do **not** collapse real repeated events |
| 5 | Console errors | yes | `error` / `warn` from the client. Explicit “none” if empty. Do not drop because the job succeeded |
| 6 | Network / activity errors | yes | Failed fetches, 4xx/5xx, latency warnings (`network_slow`). Explicit “none” if empty |
| 7 | Pipeline matrix | yes | Stages for **this pack** only; must match body |

**Pack `food`** (Log Meal, including **multiple edits** on the same job)

| # | Section | Once per | Must not lose |
|---|---------|----------|----------------|
| 8 | Dialog inventory | job | Structured tree: title, on_card macros, visible/hidden, composer counts, expand. Not a screenshot |
| 9 | Gate + ledger | job | One totals table |
| 10 | Scout | each **create** turn that ran scout | Item table once |
| 11 | Calc / breakdown | each turn that finalized | One table; kcal = ledger |
| 12 | Turns (edit log) | **each user send** | See §11.5. Turn 1 create, turn 2+ edits. Do not flatten into one dietitian blob |
| 13 | Backend log excerpt | job | No prompt reprint |

**Pack `receptionist`** (Front Desk, including **transfer to another agent**)

| # | Section | Once per | Must not lose |
|---|---------|----------|----------------|
| 8 | Handoff chain | job | Ordered agents: Front Desk → Health Coach / Medical / Food … |
| 9 | Front Desk turn | that agent | Received + instruction + user utterance + output **once** |
| 10 | Downstream job | each transfer | Pointer + the specialist pack’s sections (food or medical or coach), not a second Front Desk prompt |
| 11 | UC / intent | if classified | Door / target agent once |

**Pack `medical` / `health_coach`:** ingest/Apply or clinical report instead of scout/ledger; same agent-I/O rule; no meal scout tape.

Contract rows **differ by pack** (food: stall hop, card Retry; receptionist: handoff reached specialist, DIAG5 allowed here; medical: Apply wrote). Do not score food laws on a Front Desk-only dump (`n/a`).

### 11.5 Agent I/O (handoff + multi-edit) — shown once

This is the part that currently explodes (instruction in “Agent prompts” **and** again in `[UnifiedLLM-Prompt]` logs).

**One dispatch key:** `{turn, agent, role}` e.g. `t1/scout`, `t1/dietitian`, `t2/dietitian` (edit), `fd/front_desk`, `fd→medical`.

For **each** key that ran, **exactly one** block:

```text
### Dispatch t2/dietitian
- **User:** (verbatim send / portion choice / edit text)
- **Received:** (payload the agent got: activeMeal, scout items, userProfile, photos count — not base64)
- **Instruction:** (system instruction once; schema once)
- **Output:** (model reply once)
- **Signals:** model, latency_ms (TTFT if stream), tokens, error/finish
- **Parent:** t1/scout | fd/front_desk | …
```

**Laws:**

- If Front Desk transfers: Front Desk block **and** specialist block. Both present. Instruction for Front Desk is **not** copied under the specialist. Also emit a **handoff record**: `from`, `to`, received snapshot, **keys dropped** (silent context loss is a named industry failure). Same `jobId`.
- If the user edits the food log three times: `t1`, `t2`, `t3` — three user lines, three received snapshots (activeMeal must show what that turn saw), three outputs. Do not only keep the last turn.
- Backend log excerpt **must not** repeat those instruction/output bodies (`[UnifiedLLM-Prompt:*]` / `Complete response` stripped or replaced with `see Dispatch t1/scout`).
- `conversationHistory` is the user/agent chat once; do not also dump it inside Received.
- Missing Received / Instruction / Output for a dispatch that ran = malformed MISSING. A second copy = malformed DUPLICATE.

### 11.6 Durable capture (do not lose as the app grows)

These inputs already exist on `DebugReportInput` (`lastUserAction`, `userActionBreadcrumbs`, `clientConsoleLogs`, `networkErrors`, `sessionEvents`, `conversationHistory`, `agentInstructions`, `agentPayload`, `handoffChain`, `handoffPayload`). **Keeping them in the markdown is a gate**, not a nicety.

| Field | Builder must | Test |
|-------|----------------|------|
| `lastUserAction` | Always a section; “none” if empty | Heading present on every fixture pack |
| Breadcrumbs | Distinct last actions; cap after dedupe, not before | Soto-style duplicate Log Meal row does not appear twice |
| Console | All error/warn for the session slice; do not strip `[error]` because GATE PASS | Fixture with a console error still shows it |
| Network / activity | Failures + `network_slow`; 503/4xx of `/api/jobs/*` and `/api/gemini/*` | Fixture with NET LATENCY / 503 still shows it |
| Session trail | Full enough to see fail→retry→succeed (raise cap; skip poll heartbeats if needed, **keep** status changes) | Fail + Retry + succeeded all visible |
| Agent I/O | §11.5 one block per dispatch | Same scout instruction not in logs + Dispatches |
| Handoff | Chain + each agent block | Front Desk dump without specialist after transfer = MISSING |
| Edits | One turn block per user send | Two edits → two `t2`/`t3` blocks, not one |

Refactors of `LogChat` / `serverJobs` / debug route that stop forwarding these fields = FAIL the named debug tests. That is how this does not rot.

### 11.7 Contract table (how the file finds bugs)

At export, run the same classifiers as `classifyDump` (do not fork a second scorer). Print:

```text
## Contract
| Law | Layer | Fault | Result |
| SSE {final,result} | process | MISSING | FAIL / PASS |
| AnalyzeFinished count = 1 | process | DUPLICATE | FAIL xN / PASS |
| Stall/503/quota → 3.1 hop, same job | process | MISSING | FAIL / PASS / n/a |
| Submit JSON status = running | process | WRONG_TIME | FAIL / PASS |
| pendingFoodLog → succeeded before R2 | process | WRONG_TIME | FAIL / PASS |
| Card Retry hidden if succeeded or kcal in logs | ui | WRONG_TIME | FAIL / PASS |
| Attempt 1/3 hidden if succeeded | ui | WRONG_TIME | FAIL / PASS |
| Dialog on_card kcal = ledger | ui | WRONG_TIME | FAIL / PASS / n/a |
| Composer controls count = 1 each | ui | DUPLICATE / MISSING | FAIL / PASS |
| Each dispatch has model + latency_ms | process | MISSING | FAIL / PASS |
| Handoff from/to + same jobId if transfer | process | MISSING | FAIL / PASS / n/a |
| DIAG5 off on food chat | process | WRONG_PLACE | FAIL / PASS |
| Matrix calc matches ledger | content | MISSING | FAIL / PASS |
| Composer Take picture + Add image + paste | ui | MISSING | FAIL / PASS |
| Heading / breadcrumb unique | ui | DUPLICATE | FAIL / PASS |
```

Plus every QUALITY.md §1.3.1 exit that applies to this **pack**. Unused = `n/a`, not FAIL.

**Also always score (shared):** last user action present or explicit none; breadcrumbs heading; console section; network/activity section; each ran dispatch has Received+Instruction+Output **once**; handoff chain complete if transfer happened; food edits have one turn block each.

**Pack extras (examples):** food — card Retry vs kcal, stall hop, submit `running`. Receptionist — transfer target ran; no food ledger required. Medical — Apply/salvage terminal; no meal scout.

**Shape faults** (same five on ui, content, process):

| Fault | Detector |
|-------|----------|
| MISSING | expected count 1, actual 0 |
| DUPLICATE | expected 1, actual > 1 **in the job** (not in the markdown serializer) |
| WRONG_PLACE | present on a surface that must_hide it |
| WRONG_TIME | right object, wrong status/order (kcal in logs, card still in-flight) |
| WRONG_COUNT | expand/N items off |

Content **value** bugs (wrong dish, wrong grams) stay G* / G-B. This table does not replace Layer B.

### 11.8 What this file can and cannot catch

**Can (this run):** SSE wrap, queue lie, poller/card lag, persist order, stall with no hop, AnalyzeFinished storms, DIAG5 on food, matrix vs ledger, duplicate chrome **if snapshotted**, dish drop vs scout table, Apply missing on a lab job, console/network failures, last user actions, **which agent ran and what they saw**, **edit turns**, **Front Desk → specialist** gaps.

**Cannot:** a worker exit this job never took (stall on a happy path). Those stay dummy rows on the process board (Q-8.1). One debug file is the alarm for **this** branch, not the whole suite.

**Malformed file** is itself a bug class (`DEBUG_DUP` / `DEBUG_MISS`). Inner test: `debugPayload.test.ts` + dumpContract HEADING_ONCE / DEBUG_MATCHES_LOG. Do not wait for a live meal to notice two “Log Meal” crumb rows from the builder.

### 11.9 Inner loop

```bash
npx tsx scripts/test-from-debug.ts path/to/debug.md
# named vitest: dumpContract.test.ts debugPayload.test.ts
```

- Historical captures stay **red** if that run was broken or the builder was malformed.
- Code probes / dummy fixtures must go **green** without a new photo.
- If a new live dump’s FAIL is already a Contract row: the inner loop failed; do not re-upload.

### 11.10 Do not

- `POST /loop` / meal-green / promote Soto to G8  
- Hash-only prompts or hide schema (F-8.13)  
- Green matrix that disagrees with logs  
- Strip real process duplicates to look clean  
- Second debug formatter  
- Biomarker history on a food dump (WRONG_PLACE)  
- Grok reading a 600-line prompt reprint as the classifier — that is the Contract table’s job  
- Dropping console, network, breadcrumbs, or last action because “the meal succeeded”  
- Flattening multi-edit or handoff into a single dietitian prompt  
- A second copy of instruction/output in the log excerpt  
- Screenshot or innerHTML of the whole modal as the contract source  
- LangSmith / Phoenix / LLM-as-judge inside `dumpContract`  
- Regex-on-markdown as the **only** scorer once the JSON tree exists  
- A metrics product; stall/503 belong as a one-line count later, not a dashboard

### 11.12 Gaps to close (from Soto + 2025–26 agent observability)

Industry (OTel GenAI SIG, LangSmith/Phoenix evals, SRE golden signals) splits **trace** (what happened) from **eval** (was it good). §11 is the eval + forensic **view**. These gaps are in **F-8.13 / Q-8.1**, not a new pillar and not a SaaS buy.

| Gap | Why Soto / literature | Do in |
|-----|------------------------|-------|
| **A. Canonical JSON run tree** | Markdown regex will rot; cold debug JSON on R2 should be the tree (`dispatches[]` with `id, parent, agent, user, received, instruction, output, model, latency_ms, error`). Markdown **prints** it. `classifyDump` scores JSON. | F-8.13 |
| **B. Correlation id** | Debug looked done, card still Attempt 1/3 — client and worker did not join. Stamp `jobId` (+ turn) on console, network, server. Handoff carries it (`traceparent` in spirit). | F-8.13 |
| **C. Dialog inventory** | Flags-only snapshot cannot prove “everything in the modal is shown.” Structured tree of the open dialog; optional PNG for humans; never HTML dump. | F-8.13 + Q-8.3 |
| **D. Per-dispatch latency / model / tokens** | 90s stall was “no tokens” with no first-class TTFT field. SRE: latency, errors (traffic/saturation later). | F-8.13 |
| **E. Handoff as its own record** | Failure and symptom often live in different agents. `from`, `to`, received, **dropped keys**. | F-8.13 + Q-8.5 |
| **F. Same scorer download + vitest** | Already invariant 7; must run on the JSON tree, not a second classifier. | F-8.13 |
| **G. Dummy rows for exits this dump did not take** | One file ≠ whole suite. Q-8.1 audit. | Q-8.1 |
| **H. Stall/503 one-line rate** | M28 retries; no SLO. Optional later — a count in handover, **not** a metrics product. | Later (not F-8.13) |
| **I. No LLM-judge / no Phoenix inner loop** | Burns the quota we refused to spend on Grok-in-the-spinner. Code evals only. | Standing |

Do **not** import LangSmith. Do **not** add a fourth live-testing tier.


