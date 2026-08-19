# Roadmap — start here

**This is the only execute file.** Four architecture files sit beside it. Do not add a sixth plan.

| File | What it is |
|---|---|
| **This file** | What is left, in order |
| [BIOMARKER_LIFECYCLE.md](./BIOMARKER_LIFECYCLE.md) | Pillar 1 architecture (product model + ingest router) |
| [FOOD.md](./FOOD.md) | Pillar 2 — pipeline + meal document (not a lifecycle) |
| [RELIABILITY.md](./RELIABILITY.md) | Pillar 3 — infra / quotas |
| [QUALITY.md](./QUALITY.md) | Pillar 4 — how we test (class-first) |

Laws: `docs/agent/domains/{biomarkers,food-calc,sync}.md`  
WIP: `AI_HANDOVER.md` · Studio: `studio/` · Completed/abandoned: `archive/`

**As of GitHub `cwahli/Health-tracker-2` `main` @ `1c4f7f6` (2026-08-16).**  
`AI_HANDOVER.md` on that commit overclaims (“all tracks done”, 551 tests). This file is the remaining-work board.

```text
                    ┌─────────────────────┐
                    │  4. Quality loop     │
                    └──────────┬──────────┘
           ┌───────────────────┼───────────────────┐
           ▼                   ▼                   ▼
   1. Biomarkers         2. Food              3. Sync
```

**Standing rules (every task)**

1. Work item = **one class**, not a job id or “make EMIS all-green.”
2. Inner loop = **vitest, no Gemini.** Outer = one frozen example.
3. Allowed files only (`QUALITY.md` playbooks).
4. Two burned hypotheses → STOP.
5. Honest residual (pending / unmatched / flagged / MISS) is success.
6. Ship after COMPLETE (`tsc` + named gates). IMPACT before coding.

Locked converts never change: `1.293` / `1.411` / `3.362` / `79.56` / `13.68`.

---

## Which track now

| If you are… | Do |
|---|---|
| **Default** | **B0** (human Apply), then **B2 leftover hygiene**, then **real G-B2** |
| Food identity still wrong | **Track F** one class (`FALSE_FRIEND` first) |
| Quota / egress spike | **Track R** R-1 measure, then only the matching R-id |
| Golden is JSON-only / does not execute | **Track Q** — make that one example run the helper |

Do **not** start B7.4 Pending-store, B7.5 Calibrator, Track R D1, or a curator rebuild to make another track look done.  
Do **not** add more NHS aliases until G-B2 runs the lexer and G-B4 stays green.

---

# Remaining work

## Track B — Biomarkers (active)

**Architecture:** `BIOMARKER_LIFECYCLE.md`  
**Test method:** `QUALITY.md`  
**Laws:** `docs/agent/domains/biomarkers.md`  
**Gate always:** `node scripts/assert-biomarker-lifecycle-m31.mjs`

Ingest **code** for B1–B6 is on GitHub. Ingest **v1 is not shipped** until the remaining rows below are done.

### Still to do

| # | Item | Done when | Class |
|---|---|---|---|
| **B0.1–0.3** | Human Apply smoke on `job_medical_1786666223594` | Card shows HDL 50→**1.293**, TG 125→**1.411**, LDL 130→**3.362**, creat 0.9→**79.56**, bili 0.8→**13.68**; Apply writes history + Home; `observationMeta` raw kept; older SI rows (HDL 1.43, creat 100/72, bili 16/13) untouched | `APPLY_MISS` |
| **B0.5** | Only if Apply misses | Failing `APPLY_MISS` test, then fix hydrate / `enrichReviewModificationCommands` only | `APPLY_MISS` |
| **B2.1** | One raw injection | Extract prompt has no second `Chat History:` prefix (`server.ts`) | hygiene |
| **B2.2** | Drop `updated_at` from extract schema | Schema / prompt no longer ask the model for `updated_at` | — |
| **B2.3** | No `remainingText` echo | `remainingText` gone from extract path (`server.ts` → `LogChat` → `MedicalAgentExecutor` → `serverJobs`) | — |
| **B2.4** | Door packs | `lab_extract` vs `symptom_diary` actually route; G-B6 test **calls** the classifier | `WRONG_DOOR` |
| **B2.6** | Lexer shape goldens | G-B3 shifted-columns / UK `109/L` / panel skip exist and call `lexTable` | `CONFORMANCE_SHAPE` |
| **B4.3** | **Real G-B2** | `lexTable` + `buildIngestBatch` run on the 140-row fixture; assert **class counts from the lexer**, not `expected.json` labels | — |
| **B5.11** | G-B8 re-paste | Same report upserts; no second observation row | `UPSERT_IDENTITY` |
| **B6** | Inbox + capture | `golden-from-medical-debug.mjs`; inbox Biomarkers grouped by class (not a G-B1 stub); G-B5/7/9 tests **execute** the door / completeness / image path | — |
| **B7.4** | Real Pending store | Unknown names never become catalog keys; pending not a field on the `customBiomarkers` bag | `COMPLETENESS` |
| **B7.5** | Silent Calibrator | Overlay re-runs when demographic fingerprint (`ageBand\|gender\|ethnicity`) changes — product path, not only a helper | `CURRENCY` |
| **B7.6** | Name Deduper leftovers | Parallel keys from aliases / `metric_N` still in live profiles are merged or tombstoned | `IDENTITY_PARALLEL_KEY` |

**Stop if:** lexer writes observations · G-B4 fails · Parser is sent a high-confidence name.

Weight/height stay `droppedByApply` until a product decision.

### After B6 (do not start to unstick B0–B4)

B7.4 / B7.5 / B7.6 above. Helpers for 7.1–7.3, 7.7, 7.8 already exist — do not rebuild them.

### Landed — do not redo

| Wave | What is already on GitHub |
|---|---|
| **B0.4** | No Home Auto-Fix / Inspect / Review; no Dictionary Auto-Calibrate / Quick Approve |
| **B1** | `IngestTrace` / `ClassId`; passthrough on medical jobs; `tests/Golden_biomarker/`; G-B1 convert locks; `assert-biomarker-ingest.mjs`; inbox Food \| Biomarkers **tab** |
| **B2 (partial)** | `lexTable` / `buildIngestBatch` / `shouldAbortTablePath`; table path in `serverJobs` |
| **B3** | Shared `getMappedBiomarkerKey`; urine ≠ serum; `convertViaTable` only |
| **B4 (partial)** | NHS aliases; leftover unmatched → Parser; abort when 0 high-confidence |
| **B5 (partial)** | Flagged → Review `update_biomarker`; staged apply; new dates can insert; pending filtered from Home/coach |
| **B6 (fixtures)** | G-B5/6/7/9 JSON examples exist — they do **not** yet execute the pipeline |
| **B7.1–7.3, 7.7, 7.8** | Catalog cleanup helper; relabel XOR convert UI; `observationMeta` backfill; telemetry writers stripped; `biomarker_dictionary_store` deprecated |

`customBiomarkers` is still the synced bag. That is why B7.4 remains.

**Ingest v1 ships** when: B0 Apply verified · G-B1 green · G-B2 green **from the lexer** · no high-confidence names in Parser prompt · no `remainingText` · batch confirm · M31 0.

**Lifecycle done** when: ingest v1 + B7.4–7.6 · unknown names never catalog keys · relabel cannot rewrite numbers · Home/coach never consume pending/flagged.

**Out of Track B:** food pipeline, rename agent ids, delete instruction packs, fuzzy auto-approve, `approve_all`, vision required, new health-planning agents until B0 + `USE_SURFACE_LEAK` are green.

---

## Track F — Food identity quality

**Architecture:** `FOOD.md` (do **not** rebuild curator — M30 assert is green)  
**Method:** `QUALITY.md` + `FALSE_FRIEND` / `DISH_DROP` / `OPENING_WRONG` / `SILENT_REPAIR`  
**Laws:** `docs/agent/domains/food-calc.md`

M21/M22 meal document and M30 curator stay. F-5 TypeError `.calories` is **done**.

| ID | Still to do | Done when | Do not |
|---|---|---|---|
| **F-1** | Self-heal KPI | Same query no longer needs curator / live USDA after one good resolve | Rebuild curator |
| **F-2** | Catalog-first as default | Analyze gaps hit catalog before live USDA; USDA still allowed for research | Ban USDA |
| **F-3** | Golden meals still red in production | One class playbook per session (picnic / lassi / ham…). Fixture tests in `golden_meals.test.ts` are **not** this item | `POST /loop` until all-green |
| **F-4** | Alias hit rate / duplicate active rows | Measured hit rate; dups gated, not silently merged | Silent merge |

Execute **one class** per session. Inner = vitest (`server_fdc_resolve` / scout merge). Outer = one golden example.

---

## Track R — Reliability (core done; start only on trigger)

**Architecture:** `RELIABILITY.md`  
**Laws:** `docs/agent/domains/sync.md`  
**Core:** M23–M28 `assert-free-tier-complete.mjs` **PASS**. Do not re-migrate images or re-kill chat Firestore writes.

| ID | Still to do | Trigger |
|---|---|---|
| **R-1** | Re-measure Firestore writes / Supabase egress | Quota or bill spike |
| **R-2** | Cloudflare Pages for `dist/` | Static latency actually hurts |
| **R-3** | Playwright E2E | After soak; not instead of class goldens |
| **R-4** | Finish `server.ts` router split | Already touching the monolith (`server_routes_{jobs,biomarkers,food}.ts` exist; `server.ts` still huge) |
| **R-5** | D1 as primary SQL | **After** R-1 still fails free tier |
| **R-6** | Job recovery soak | Interrupted jobs still orphan (unit test exists; not a soak) |

R-7 knip / `getBiomarkerStatus` memo as a reliability gate is **abandoned**.

---

## Track Q — Quality loop (remaining method work)

**Architecture:** `QUALITY.md`

Rules unchanged: work item = class · inner = vitest · outer = one example · honest residual · firewall.

| Still to do | Done when |
|---|---|
| Make G-B2/5/6/7/9 **execute** the helper they name | Tests call `lexTable` / door classifier / completeness path; fixture-label-only tests are not enough |
| Medical capture script | `golden-from-medical-debug.mjs` exists (never food’s `golden-from-debug.mjs`) |
| Inbox by class | Biomarkers tab lists examples grouped by class, not a single G-B1 card |
| Stale header in `QUALITY.md` | File no longer says “not started as code” |

Session replay: **abandoned**.  
Q work is usually **inside** B2/B4/B6 or F-3, not a separate calendar.

---

## Always-run gates

```bash
npx tsc --noEmit
# Track B
node scripts/assert-biomarker-lifecycle-m31.mjs
node scripts/assert-biomarker-ingest.mjs
npx vitest run src/utils/biomarkerLifecycle.test.ts src/utils/biomarkerIdentity.test.ts src/utils/biomarkerSanitize.test.ts tests/golden_biomarker.test.ts
# Track F (when touching resolver)
node scripts/assert-food-curator-m30.mjs
# Track R (when touching sync)
node scripts/assert-free-tier-complete.mjs
npx vitest run src/utils/syncUtils.regression.test.ts
```
