# Health Cockpit — Master AI Handover (WIP status board)

**Last updated:** 2026-08-11 (Free Tier Reliability M23-M28 completed: auth token verification, Gemini retry backoff, optimized payloads; all gates & tests PASS)  
**Source of truth code intent:** https://github.com/cwahli/Health-tracker-2  
**Tree of truth for product completeness:** **Desktop** working tree until Slice 0 / governance ship lands on origin.  
**Always `git fetch` + re-audit before a session.**

## Document roles (read this)

| Doc | What it is | Update freely? |
|-----|------------|----------------|
| **This file (`AI_HANDOVER.md`)** | **WIP / status / multi-agent handoff** — where we are, what’s next, session notes | **Yes** |
| **`plan/*`** | **Architecture & planned design** (modal, food-calc hybrid, R2, bugs…) | When design changes |
| **`AGENTS.md` + `docs/agent/**`** | **How agents work** (laws, domain guides, gates) | **Protected** — confirmation + before→after (`AGENTS.md` §3) |
| **`studio/`** | Active AI Studio pack only | Pack authoring |
| **`archive/`** | Completed packs | After COMPLETE |

**Commits/pushes to GitHub:** **AI Studio only** — local Grok/Claude/Cursor prepare code and packs; they do not push (`AGENTS.md` §4).

**Consolidated DONE / TODO (snapshot):** `plan/STATUS_CONSOLIDATED_2026-08.md` — **stale as of 2026-08-08**; re-audit before trusting GitHub vs Desktop bullets.  
**Detail roadmap:** `plan/REMAINING_ROADMAP_2026-08.md` — same: use as map, verify against tree.  
**Active Studio pack for ship:** **`studio/M20_AGENT_GOVERNANCE_AND_REGRESSION.md`**.

---

## 0. Critical: GitHub vs Desktop (read first)

| Fact | Detail |
|------|--------|
| Local branch | `main` at `ab8ab74` |
| `origin/main` | `4412fb6` — local is **behind by 5 commits**, **0 ahead** (no Desktop commit yet) |
| Dirty tree | **~57** modified + untracked paths (all real product work sits here) |
| Origin quality risk | Origin added **stub** `server_portion_clarify.ts` / `server_refine_scale.ts` (~15 lines, no-ops). Desktop has **full** modules (~193 / ~335 lines) + gates green |
| Origin missing | `foodLogDedupe`, `dataSanitize`, `foodImageSources`, `debugPayload`, Data Sanitize UI, several assert scripts (b11/b14/m3-executor local names) |
| Origin has partial | FoodAgentExecutor, `awaiting_user` wiring, B5f `skip-dietitian` in `server.ts`, label-lock edits, thin assert scripts |

**Do not** assume “GitHub is the website.” The **runnable product with green gates** is Desktop working tree.  
**Slice 0 (required):** merge/rebase the 5 origin commits carefully (prefer Desktop modules over stubs), commit, push.

```bash
# Baseline on Desktop (all PASS as of 2026-08-08 audit)
node scripts/assert-unified-modal-m3-executor.mjs
node scripts/assert-label-truth-locks.mjs
node scripts/assert-backlog-b1-portion-clarify.mjs
node scripts/assert-backlog-b5-refine.mjs
node scripts/assert-backlog-b2-b7.mjs
node scripts/assert-backlog-b14-cold-b9b.mjs
node scripts/assert-backlog-b11-image-sync.mjs
node scripts/assert-async-durable-remaining.mjs
```

---

## 1. How to work (everyone)

| Rule | Detail |
|------|--------|
| One focus | One initiative / one Studio milestone at a time |
| Review GitHub first | Audit origin → instruct **gaps only** (do not rebuild DONE work) |
| Prefer Desktop for truth | Until Slice 0 push, Desktop working tree beats origin stubs |
| Do not undo | Prior patches are intentional unless a gate proves breakage |
| Free tier | Minimize Firestore reads/writes; never remove image recompression on load |
| Models | Default app runtime: `gemini-3.5-flash-lite`. No `gemini-2.5-flash` |
| COMPLETE | Only after the **named gate** exits 0 + STATUS table |
| Studio files | Upload **one** file from `studio/` per session |
| After COMPLETE | Move finished pack `studio/` → `archive/studio/completed-2026-08/`; update this board |

---

## 2. Architecture (short)

| Layer | Tech |
|-------|------|
| Frontend | React + TypeScript (`src/`) |
| Backend | Express (`server.ts` + helpers) |
| DB | Firebase Firestore (free tier) |
| Auth | Firebase Auth |
| AI | Gemini via `@google/genai` |
| Hosting | Google Cloud Run |
| Local heavy data | IndexedDB (`idb-keyval`) |

**Dual food paths:** (1) `POST /api/jobs/submit` → `serverJobs` poll; (2) client `JobQueueRunner` → `executeFoodAgent` SSE. Remaining work must name which path.

---

## 3. Initiative status (all tracks)

| # | Initiative | Status | Notes |
|---|------------|--------|-------|
| **A** | **Unified modal + async multi-job** | 🟡 **IN PROGRESS** | M1–M5 **DONE on Desktop** (gates); GitHub incomplete / stubby; push + soak next |
| B | Multi-language (i18n) | ⏸️ **PAUSED** ~75% | Resume only if user explicitly asks |
| C | Admin panel | 🟢 **Done** | |
| D | Food Mode D menu screening | 🟢 **Done** | |
| E | Health coach polish | 🟢 **Done** | |
| F | Theme engine | 🟢 **Done** | |
| G | Storage / sync / tombstones / recompress | 🟢 **Done** | Do not remove recompress-on-load |
| H | Food calc hybrid / label truth / backlog | 🟢 **Mostly done** | B5f/B3g/B1/B5/B7 green; **B8c applied** (Co-op per_100g) |
| **Sync / images** | B11 + B11d + B13 + sanitize | 🟢 **Code done** | Dedupe, sanitize, **proxy photos**, **lazy history**; multi-device soak still recommended |
| I | Cloudflare images greenfield | ⚪ Later | Not needed if B11d proxy works |
| J | True server background workers | ⚪ Later | After soak |
| **K** | **Bug tracking (food + biomarker)** | 🟢 **Done Desktop** | No Session Replay. Master: `plan/BUG_TRACKING_COMPREHENSIVE_PLAN.md` |

---

## 4. Unified modal + backlog board (Desktop truth)

### Plan / packs

| Doc | Role |
|-----|------|
| `plan/REMAINING_ROADMAP_2026-08.md` | **Master remaining map** (includes Slice K) |
| `plan/UNIFIED_MODAL_ASYNC_JOB_PLAN.md` | Architecture reference |
| `plan/FOOD_LOG_UX_CALC_BACKLOG.md` | Issue-level backlog |
| `plan/BUG_TRACKING_COMPREHENSIVE_PLAN.md` | **Master: food + biomarker bug tracking** (domain packs, durable triage, K1–K6) |
| `plan/BUG_SNAPSHOT_TRIAGE_PLAN.md` | Earlier snapshot/R2/triage detail + literature §13 |
| **`studio/`** | **Active:** `M20_AGENT_GOVERNANCE_AND_REGRESSION.md` (commit governance + regression via AI Studio) |
| `archive/studio/completed-2026-08/` | Completed Studio packs (M2.5–M14, hotfixes, multipass) |
| `AGENTS.md` + `docs/agent/` | Always-on laws + domain rulebooks (protected) |

### Milestone board (Desktop gates 2026-08-08)

| ID | Name | Desktop | GitHub `origin/main` |
|----|------|:-------:|:--------------------:|
| M1 | JobStore / Runner / credits | 🟢 | 🟢 partial |
| M2 | Nav `+` / FloatingActionSheet | 🟢 | 🟢 |
| M2.5 | Phase 1 harden | 🟢 | 🟢 |
| **M3** | `FoodAgentExecutor` extract | 🟢 gate | 🟡 present, incomplete vs Desktop |
| **M4** | Mode A async E2E + progress | 🟢 local | 🟡 |
| **M5** | Mode D + Edit async | 🟢 tests | 🟡 |
| B3 label truth | Locks / receipt / soft micros | 🟢 L1–L8 | 🟡 partial |
| B1 portion clarify | Pause + chips + skipScout | 🟢 full module | 🔴 **stub no-op on origin** |
| B5 / B5f refine | Scale-only + skip-dietitian | 🟢 | 🔴 **stub refine helpers**; B5f wired in server.ts |
| B2 / B7 / B14-hot | Jobs durability + resolver skip | 🟢 | 🟡 |
| B14 cold + B9b | R2 debug strip + report.md | 🟢 | ❌ missing helpers |
| B11 | Dedupe / images / Data Sanitize | 🟢 helpers+UI | ❌ missing modules |
| B2d reload | Keep `awaiting_user` + server running | 🟢 | 🟡 weak |
| **B11d** R2 public/signed photos | 🟢 proxy+signed | ⬜ push |
| **B13** lazy history | 🟢 page 15 + IO | ⬜ push |
| **B8c** Co-op data repair | 🟢 applied | 🟢 Supabase verified |

### Frozen decisions (D1–D10)

| ID | Decision |
|----|----------|
| D1 | maxQueued = 5, concurrency = 1 (FIFO) |
| D2 | Reload: preserve `awaiting_user` + server-owned `running` |
| D3 | Explicit Save for food |
| D4 | Edit = same jobId |
| D5 | Health Info sync for now |
| D6 | Placeholders on food history with honest progress |
| D7 | Auto-retries ×2; Page Visibility wake |
| D8 | Pure weight scale on label-locked meals skips Dietitian |
| D9 | Core macros label-locked; soft micros from USDA |
| D10 | User photo → badge; never inject Unsplash stock |

---

## 5. Multi-language (i18n) — paused

**Status:** PAUSED (~75%). Do not work until the user explicitly asks.

---

## 6. Admin panel — done

Complete. Not the master focus of this handover.

---

## 7. Next action (right now)

| Who | Do this |
|-----|---------|
| **AI Studio** | M20 shipped!
|-----|---------|
| **Human** | Upload **`studio/M20_AGENT_GOVERNANCE_AND_REGRESSION.md`** (+ docs/agent + AGENTS + listed tests/code) to **AI Studio** → Studio gate + **commit/push** |
| **Local agents (Grok/Claude/Cursor)** | Prepare code only; **do not** `git push`; put session notes here |
| **After M20 ships** | Reconcile origin vs Desktop (merge carefully; prefer full modules over stubs); multi-device soak |

**Do not** re-upload archived packs. **Do not** rebuild M/B/K already green unless gate FAIL.  
**Do not** edit `AGENTS.md` / `docs/agent/**` without confirmation + before→after.

### Session notes (multi-agent — append short bullets)
- 2026-08-09: Completed Firestore to Cloudflare R2 image migration preparation & Supabase row/image size diagnostics:
  - Created a Firestore-to-R2 image migration script `scripts/migrate-firestore-images-to-r2.ts` that handles scanning the `foodImages` collection group, uploading base64 data to R2, and rewriting the Firestore documents with R2 URLs.
  - Added a dedicated POST endpoint `/api/r2/migrate-firestore-images` in `server.ts` to execute this Firestore migration server-side under privileged Cloud Run default service account roles, overcoming local terminal authorization barriers.
  - Developed and ran `scripts/check-supabase-row-sizes.ts`, confirming that the Supabase database is completely free of heavy base64 strings (0 remaining base64 images).
  - Verified Supabase size stats: total of 221 log rows, average row size is only 255 characters (~0 KB), and the absolute largest row size is just 695 characters (~1 KB). Every image is perfectly backed by Cloudflare R2 URLs (~90 chars each).
- 2026-08-09: Completed Supabase to Cloudflare R2 image migration and real-time R2 interceptor:
  - Created and ran a comprehensive migration script `scripts/migrate-supabase-images-to-r2.ts` that parsed all existing food logs in Supabase (`food_logs` table), uploaded 266 heavy base64-encoded images to Cloudflare R2, and updated all 177 affected Supabase rows with clean R2 URLs, clearing out massive database storage bloat.
  - Added an automatic interceptor in the push-sync handler (`/api/sync/supabase-push`) in `server.ts` that seamlessly uploads any new base64 data URLs to R2 and writes only clean R2 CDN links to the Supabase database.
- 2026-08-09: Completed Portion Precision & Log Download enhancements:
  - Added a download icon next to the copy button in `LiveBackendStreamViewer` inside `FoodCard.tsx` to allow downloading filtered logs as a text file.
  - Fixed meal buildup and context loss after portion selection by removing the `!extraOptions?.portionChoices` check in `lastFoodLogForJob` resolution within `LogChat.tsx`, allowing it to correctly fall back to the latest logged food log as `activeMeal`.
- 2026-08-09: Completed M22 Meal Build True Complete (`studio/M22_MEAL_BUILD_TRUE_COMPLETE.md`):
  - Hard gate `scripts/assert-meal-build-m22.mjs` passed (exit 0).
  - Applied live `projectDietitianInput` block to dietitian LLM prompt (`promptText`).
  - Added `attachHappyPathMealBuild` on edit/modify math fallback path with `staleDietitianNarrative: true`.
  - Upgraded Mode D evaluation route to safely stream `comparisonSet` (SSE payload format).
  - Wired `stageLifecycle.ts` tracking (`beginStage`, `endStage`) for `dietitian` with StageLimits circuit breaker.
  - Implemented `coldDebug.ts` package generator for R2 forensics and integrated into debug payload views.
  - Verified M22 chaos tests, M21.1 completion tests, food-calc tests, and TypeScript compiler output (all zero errors).
- 2026-08-09: Completed M21.1 Meal Build Completion (`studio/M21_1_MEAL_BUILD_COMPLETION_GATES.md`):
  - Hard gate `scripts/assert-meal-build-m21-1.mjs` passed (exit 0).
  - Wired `attachHappyPathMealBuild` on `new_log` success path in `server.ts`.
  - Wired `projectDietitianInput` call site in `server.ts` before dietitian LLM call.
  - Updated Mode D evaluation branch in `server.ts` to attach `comparisonSet` and log `[MealBuild] mode=D`.
  - Updated `TaskPlaceholderCard.tsx` to handle `comparison.groups` / `comparisonSet` and render `staleDietitianNarrative` warning badge.
  - Updated `JobQueueRunner.ts` done handler to store `mealBuild` on job completion.
  - Verified all tests: `m21_1_completion.test.ts` (6/6 PASS), full `mealBuild` suite (25/25 PASS), food-calc suite (42/42 PASS), `npx tsc --noEmit` (0 errors), and `compile_applet` (succeeded).
- 2026-08-09: Implemented Formalized Pure Projectors (`plan §3A`) and Bi-directional Agent Reflection Loop:
  - Created `src/mealBuild/projectors.ts` with standalone stage input masks (`projectScoutInput`, `projectResolverInput`, `projectCalculatorInput`, `projectDietitianInput`) preventing context bloat and raw payload dilution.
  - Created `src/mealBuild/reflection.ts` providing `evaluateResolverConfidence` and `buildVisionCropReQuery` to trigger targeted crop re-queries for low-confidence (<60%) candidate matches before category fallback.
  - Created unit tests `src/mealBuild/__tests__/projectors.test.ts` and `src/mealBuild/__tests__/reflection.test.ts`.
- 2026-08-09: Implemented Initiative J (True Server Background Workers & Crash Recovery):
  - Added `recoverInterruptedServerJobs()` in `serverJobs.ts` to scan and resume interrupted in-memory and Supabase running jobs following server restart/crashes.
  - Integrated worker recovery invocation into `server.ts` boot sequence.
  - Added unit test suite `src/jobs/__tests__/ServerJobRecovery.test.ts` validating crash detection and job resumption.
- 2026-08-09: Completed Phase 3, 5, 6 Roadmap items from `plan/MEAL_BUILD_DURABLE_STATE.md`:
  - Integrated `migrateMealSchema` into `storageUtils.ts` for clean client-side local storage pull schema migration.
  - Enhanced `FoodEvaluationComparisonCard.tsx` and `TaskPlaceholderCard.tsx` to project Mode D `ComparisonSet` option meals with side-by-side macro grids and recommendations.
  - Implemented `rebaseUserEdit` and `rebaseJobMealEdit` OCC 409 rebase logic with tombstone preservation and `staleDietitianNarrative` flags in `consolidate.ts` and `JobStore.ts`.
- 2026-08-09: Completed Phases 2–6 of Meal Build durable state (`plan/MEAL_BUILD_DURABLE_STATE.md`). Implemented Supabase sync for `mealBuild` / `stageLedger` / `historyLog`, early R2 photo URL synchronization on client submit, Mode D multi-meal ComparisonSet summary rendering in TaskPlaceholderCard, and client-side OCC 409 rebase loop with `rebaseUserEdit` and `rebaseJobMealEdit` in JobStore. All 250 unit tests across 32 test files passing cleanly, linter zero errors, applet compiled successfully.
- 2026-08-09: AI Studio verified and shipped M21 (Meal Build Durable State). All M21 gates passed.
- 2026-08-09: AI Studio verified and shipped M20. All gates passed.

- 2026-08-09: Agent governance + domain rulebooks + sync/biomarker/food regression tests prepared on Desktop. Ship path = M20 via AI Studio.
- 2026-08-09: Verified `node scripts/assert-agent-governance.mjs` (exit 0), all 87 vitest regression tests (passed), `tsc --noEmit` (clean), and `compile_applet` (succeeded).
- 2026-08-09: Bug Tracker & Snapshot overhaul completed:
  1. Mobile screenshot viewport positioning with scroll translation (`window.scrollX`/`window.scrollY`).
  2. Immediate modal opening flow on snapshot FAB click (open -> brief hide -> capture -> reopen).
  3. Multi-image selection support for bug snapshot attachments.
  4. Automatic page/category preselection based on active tab.
  5. Interactive bug tag problem viewer showing previously identified problems and open items.
  6. Cleaned up Capture Pack UI text.
  7. Interactive data-sharing checkboxes (a11y tree, overview & logs, session data, photos, nutrient calculation, debug JSON) controlling exported payload.
  8. Prominent console and network error buffer capture in snapshot payloads.
  9. Fixed "View Status" button in Bug Tracker modal to reliably trigger status view.
  10. Refined error detection in Log History so non-fatal log lines containing "error" don't display as "Failed processing".
- 2026-08-10: Meal Pipeline Continuity, Lazy Loading, and Code Hygiene:
  1. Fixed portion clarify continuity by embedding `resolvedDbCandidates` into Turn 1 pause payload and restoring them on Turn 2 (`skipScout=true`), bypassing redundant database re-scans.
  2. Fixed log history truncation by preserving `turn1Logs` across pause turns in `serverJobs.ts` and stitching them with Turn 2 logs for complete R2 diagnostic traces.
  3. Fixed Portion Clarify UI rendering by mapping `needsPortionClarify` and `portionClarify` into `assistantMsg.data` and updating `JobStore` to `awaiting_user`.
  4. Fixed `/api/jobs/status` and `/api/jobs/debug` to prioritize in-memory server jobs, ensuring zero-latency status and seamless local/offline dev operation.
  5. Implemented proxy-first R2 log fetching (`/api/r2/log-proxy`) with localStorage fallback in `LogChat.tsx` and `FullScreenLogViewer.tsx`, eliminating browser CORS drop errors.
  6. Fixed Diagnostic Log History viewer to cache R2 logs per URL/request ID, ensuring immediate log updates when switching requests in the dropdown.
  7. Updated domain rulebooks (`docs/agent/domains/food-calc.md`, `biomarkers.md`, `sync.md`) with multi-turn continuity, biomarker badging immutability, and proxy-first laws.
  8. **Task 2 (Lazy Loading & Asset Retention):** Enhanced all image rendering pathways (`ImageSlider.tsx`, `LogChat.tsx`, `FoodHistoryTab.tsx`) with automatic `loading="lazy"`, `decoding="async"`, and viewport-deferred `IntersectionObserver` rendering, eliminating burst photo downloads on page refresh and large history feeds.
  10. **Health Trends Multi-Page Navigation:** Fixed food item linking from Health Trends (`TrendsTab.tsx` → `FoodHistoryTab.tsx`) so clicking any historical meal calculates its page offset (`Math.floor(targetIdx / itemsPerPage) + 1`), auto-navigates across pagination boundaries, clears any conflicting search filters, and smoothly scrolls to center the expanded food log card.
  11. All 283 unit tests across 38 suites and all M22 governance gates pass with exit code 0.
- 2026-08-10: Comparison and Pending Food Log Fixes:
  1. Added `comparison`, `comparisonSet`, and `scoutContentType` to the backend persistent `cleanResult` payload in `serverJobs.ts`, enabling seamless comparison data transmission to the frontend.
  2. Fixed comparison preview card metrics (0kcal/0g protein, Save Log button) and modal duplication issues by ensuring `pendingFoodLog` resolves to `null` on comparison (Mode D) runs.
- 2026-08-11: Free-Tier Reliability (M23-M28) Completed:
  1. Auth Verification (M27): Added robust `verifyFirebaseIdToken` and ensured full tokens are passed to `/api/sync/supabase-push` and `/api/jobs/*`.
  2. Gemini Retry (M28): Added `withGeminiRetry` exponential backoff wrapper in `server.ts` to handle AI Studio rate limits (429s).
  3. Payload Optimization (M26): Removed `mealBuild` object from `AgentJob` frontend/backend sync payloads to save R2/database bandwidth.
  4. Tested and verified `scripts/assert-free-tier-complete.mjs` with exit code 0.
- 2026-08-11: Food Analyze TypeError & Dietitian Safeguards:
  1. Fixed `TypeError: Cannot set properties of undefined (setting 'calories')` by adding defensive null/type guards in `server_vision_scout.ts` (for `newItem.rawNutritionLabel`), `server.ts` (for `parsedData.itemsBreakdown` and `activeMeal.itemsBreakdown` array items), `server_pure_helpers.ts`, `server_budget_reconcile.ts`, and `server_nutrient_aggregation.ts`.
  2. Protected dietitian execution flow from degrading into fallback state due to unhandled property assignment errors on null/undefined nutrient objects or component array entries.
  3. Fixed `brand_official` fetch logic: Removed `brand_menu_` prefix from IDs before querying the database, allowing successful nutrient extraction from `brand_menu_items`. Also added explicit logic to read `nutrients_per_100g` to handle `per_dish` vs `per_100g` basis correctly.
  4. Fixed `Sanity Check` logic in `server.ts`: Added `latte`, `coffee`, `tea`, `milk`, `drink`, `juice`, and `smoothie` to the `isSolidMeal` exclusion list so the backend no longer aggressively autocorrects low-calorie beverages up to a 600 kcal generic solid baseline.
  5. Verified `npx tsc --noEmit` (0 errors), `compile_applet` (build succeeded), and Vitest unit tests (68 tests passed).
- - Plan snapshots (`STATUS_CONSOLIDATED`, REMAINING_ROADMAP) dated 2026-08-08 — verify before acting.

---

## 8. Doc layout

```text
AI_HANDOVER.md                 ← THIS FILE = WIP status + handoff (update freely)
AGENTS.md                      ← always-on laws (protected)
docs/agent/                    ← rulebooks + packs guide (protected)
plan/                          ← architecture / planned design
studio/                        ← ACTIVE: M20_AGENT_GOVERNANCE_AND_REGRESSION.md
  00_README.md
  ACTIVE_STATUS.md
archive/
  studio/completed-2026-08/
```

---

## 9. Changelog

| Date | Note |
|------|------|
| 2026-08-11 | M26-M28 Free Tier Reliability | M26 (thin jobs), M27 (Supabase pull/push auth verification), M28 (Gemini retry block with exponential backoff) applied and pass tests |
| 2026-08-08 | Full audit: Desktop gates all green; origin behind/ahead mess (5 commits stubs); archive consolidated; M15 sole active pack |
| 2026-08-06 | Master handover: modal M1–M2 done, M3 next (superseded by later Desktop work) |

---

*If this file ever shrinks back to “Admin Panel only”, restore this master content.*

- M30 Epic (Food Curator): Phases 0, 1, 2, 3, 4, 5 fully completed (M30 COMPLETE)