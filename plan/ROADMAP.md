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
| **Default (correctness)** | **B0** (human Apply), then **B2 leftover hygiene**, then **real G-B2** |
| Site is slow / UI keeps duplicating | **Q-1 budget gate**, then **B8.1** (one convert table), then **R-9** (defer mount). Do **not** start FoodCard / App.tsx / Dictionary splits first |
| Food identity still wrong | **Track F** one class (`FALSE_FRIEND` first) |
| Quota / egress spike | **Track R** R-1 measure, then only the matching R-id |
| Golden is JSON-only / does not execute | **Track Q** — make that one example run the helper |

Do **not** start B7.4 Pending-store, B7.5 Calibrator, Track R D1, a curator rebuild, or a god-file rewrite to make another track look done.  
Do **not** add more NHS aliases until G-B2 runs the lexer and G-B4 stays green.  
Do **not** add a sixth plan file — platform / speed / kit IDs live here under **Q / R / B8 / F-6**.

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

### B8 — One math path, one door (platform continuity)

Does **not** replace B0–B7. Same pillar, same `convertViaTable` law. Trigger: second conversion table + restored Auto-Fix landed after B0.4. Method: `QUALITY.md` §7.

| # | Item | Done when | Class | Who |
|---|---|---|---|---|
| **B8.0** | Human: one Auto-Fix surface | Choice written in `AI_HANDOVER.md`: **(A)** Flagged Telemetry modal is the only Auto-Fix, or **(B)** Auto-Fix banned again | product | Human |
| **B8.1** | Telemetry Auto-Fix calls `convertViaTable` only | `computeBiomarkerTelemetryMultiplier` has no private factors; extra pairs live in `ANALYTE_CONVERSIONS`; locked `1.293` / `1.411` / `3.362` / `79.56` / `13.68` unchanged | `SECOND_MATH_PATH` | Grok (constants) |
| **B8.2** | One Check-Biomarkers control | Dictionary toolbar **or** Cleaning menu, not both | `CLONE_UI` | Gemini |
| **B8.3** | One audit mount | `runGeneralizedBiomarkerAudit` / `detectFlaggedTelemetryErrors` not re-run from Dictionary + Medical History + Trends + LogChat on the same paint | `EAGER_MOUNT` | Gemini after Grok names call sites |

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
| **F-6** | `FoodCard.tsx` ceiling | Catalog 4200; file ~4037. Done when net-zero toward ~3800 or pack lists growth. New portion/receipt UI stays in `PortionClarifyCard` / `NutritionLabelTable` / `ComprehensiveNutrientsTable` | New food table / +100 lines “enhance” |
| **F-7** | Scout prompt budget as a gate | `server_vision_scout.ts` net-zero (L12 enforced by `assert-budgets.mjs`, not English) | Prompt-only unit math |

Q-1 (`assert-budgets.mjs`) is **green**. F-6 / F-7 are unblocked. They do **not** rebuild the curator (M30 stays).

### F-8 — Single-path add/edit (calorie host must die)

**Architecture:** [FOOD_SINGLE_PATH.md](./FOOD_SINGLE_PATH.md) · [FOOD.md](./FOOD.md) Process  
**Laws:** `docs/agent/domains/food-calc.md`

**Shipped (2026-08-30…31):** F-8.1–F-8.9 (gate, finalize map, edit executor, debug, tiles, packaged bind, heal slim, host deleted, thin HTTP adapter, compiler uses finalize, evidence-job TS fixture 1635 g).

| ID | Still to do | Done when | Do not |
|---|---|---|---|
| **F-8.10** | Goldilocks-split the pipeline owner | `server_food_analyze_run.ts` (~3772, ceiling 3800) split into 400–600 owners (scout dispatch, DB search, prompt assembly). Delete leftover `STANDARD_FOOD_FACTORS` mock table if unused. HTTP adapter stays ≤700 | 40-line shards; a second kcal writer |
| **F-8.11** | Evidence soak (outer) | One live Gemini replay of `job_1788115766430_v2z5q9hpz` (or same 6-photo class): one meal id, 7–8 FoodItem tiles, no inherit `cal=0`, narrative = table. Inner check already exists (`server_meal_edit.test.ts` 1635 g) | `POST /loop` until meal-green |
| **F-8.12** | Packaged catalog residual | Hemaviton-class drink: vitamin C / labelled kcal from **brand or printed OCR** when those facts exist. Bind-attempt + `BIND_MISS` is already honest | Invent 1000 mg vitamin C |
| **F-8.13** | Debug download vs sample | A real job download matches [after-F-8 sample](./samples/debug-job_1788115766430_v2z5q9hpz.after-f8.md): instruction + reply once per dispatch, Errors = gate, no logger-echo | Hash-only prompts; hide schema |

Execute **one class** per session. Inner = named vitest. Outer = one frozen example, not meal-green.

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
| **R-8** | Measure client TTI + request count on Home / Health / first chat | Numbers in `AI_HANDOVER.md` (no “60% faster” claim) | Page feels slow (now true) |
| **R-9** | Defer `startGoldenIngestWatcher` + full `hydrateUserJobs` past first paint | Not in the first `App` mount turn; `requestIdleCallback` or ≥1.5s | After R-8 baseline |
| **R-10** | Header code-split | `themeRegistry` audit, Drive backup, `FoodCatalogAdminTab`, quota checkers lazy; Header line count may not grow | After R-9 |
| **R-11** | `HomeTab` / `LogChat` stay out of other tabs’ first paint | Already lazy-tabbed; do not eagerly import them from Insights / History | Regression after R-10 |

R-7 knip / `getBiomarkerStatus` memo as a reliability gate is **abandoned**.  
R-8–R-11 are **client speed**, not a free-tier redo. Do not re-migrate images or re-kill Firestore writes.  
`App.tsx` extract (`useSyncOrchestrator`) stays **parked inside R-4** — only if a later pack already touches that file. Grok owns any `App.tsx` / `LogChat.tsx` / `Header.tsx` split. Gemini may do R-9 FIND/REPLACE from a named pack.

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
| **Q-1** Budget gate | `scripts/assert-budgets.mjs` exit 0; fails on god-file net growth, a second convert table, a second Auto-Fix surface, or scout prompt growth. Wired into later packs the way free-tier is | 
| **Q-2** Component catalog | `src/components/CATALOG.json` lists the allowed primitive ids (`AppModal`, `DataGrid`, `FilterPills`, `ConfirmBar`, `NutritionLabelTable`, `ComprehensiveNutrientsTable`, `PortionClarifyCard`, `convertViaTable`, `lazyWithRetry`). A new `*Modal.tsx` / `*Card.tsx` / `*Table.tsx` without a catalog id fails Q-1 |
| **Q-3** First kit extract | `AppModal` + `FilterPills` exist under `src/components/ui/`, each ≤300 lines, each with a vitest; Home + Audit pills call `FilterPills`; no third pill bar |
| **Q-4** `AgentResultTable` thin | Grid behavior only; agent YAML / apply / localStorage missing-keys **out**. Call sites pass data. Grok-owned |
| **Q-5** Delete one-shot patch scripts | `scripts/patch-*.ts` / `fix-*.ts` residue gone after the last class they served |
| **Q-6** Unified bug queue | Snap + auto + golden tape are **one `#n`**. Inbox is not a second list. Named bug first; extra tape reds = series remaining (or sibling `#n`). Promote (photos + class test) → official `G*` / G-B fail-safe. No `/loop`. See `QUALITY.md` §14–14.4. Mocks: `studio/mockups/bug-queue-combined-flow.html` | 

Session replay: **abandoned**.  
Golden-execution Q work is usually **inside** B2/B4/B6 or F-3.  
**Q-1 is the first platform pack.** It does not cancel B0. File-collision rule: B0 and R-9 both touch `App.tsx` → serialize those two only.

### Platform program order (not a fifth pillar)

Same reward change as class-first goldens (`QUALITY.md` §0): green means the **class** is closed, not “the page still works.”

```text
Q-1 budget + Q-2 catalog     ← stop the bleeding (Grok writes, Gemini may fill the assert)
B8.0 human Auto-Fix choice
B8.1 one convert table       ← first repair the new gate fails (Grok)
Q-3 AppModal + FilterPills   ← Grok API, Gemini implement + wire
R-8 measure → R-9 defer      ← Grok numbers, Gemini FIND/REPLACE
B8.2 / B8.3 one door         ← Gemini
F-6 / F-7 FoodCard + scout   ← Gemini from a Grok pack; net-zero
Q-4 / R-10 / R-4 god files   ← Grok only (Studio/Gemini weak here)
Q-5 patch-script cleanup     ← Gemini last
```

Do **not** open Q-4 or a Dictionary/FoodCard/App.tsx breakup until Q-1 is red on that file **and** the pack names a catalog id.

### Who does which (Gemini vs Grok)

| | **Gemini** (large context, FIND/REPLACE, Studio) | **Grok** (this workspace) |
|---|---|---|
| Prefer | Q-1 assert body from a spec; B8.2; B8.3; Q-3 implement+wire; R-9 defer; F-6 moves into **existing** cards; F-7 net-zero prompt; Q-5 delete residue | Audit / catalog ids; B8.1 factors; primitive **APIs**; Q-4; any split of `App.tsx` `LogChat.tsx` `Header.tsx` `BiomarkerDictionaryModal.tsx` `AgentResultTable.tsx`; R-8 measure; review Gemini push vs catalog |
| Do not ask | “Refactor FoodCard / Dictionary / App”; invent `BiomarkerDataGrid`; add L15 prose; restore a third Auto-Fix | Parallel rewrite of the same god file Gemini is in |

Packs stay ≤6 IDs. One class per pack. Grok authors the pack; Gemini (or Grok) implements; Grok reviews the push (line counts + catalog). Local ship is allowed after COMPLETE.

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
# Track Q platform (UI / convert / scout pack)
node scripts/assert-budgets.mjs
```
