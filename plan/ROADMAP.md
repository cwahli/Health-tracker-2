# Roadmap — start here

**This is the only execute file.** There is no `studio/` pack folder. Four architecture files sit beside this one. Do not add a fifth.

| File | What it is |
|---|---|
| **This file** | What is left, in order — AI Studio works **this file** |
| [BIOMARKER_LIFECYCLE.md](./BIOMARKER_LIFECYCLE.md) | Pillar 1 architecture |
| [FOOD.md](./FOOD.md) | Pillar 2 — Process (stop at the module table) |
| [RELIABILITY.md](./RELIABILITY.md) | Pillar 3 — infra / quotas + how we fix the site (working process) |
| [QUALITY.md](./QUALITY.md) | Pillar 4 — how we test (§1.4 only unless Q-6/Q-7) |

Laws: `docs/agent/domains/{biomarkers,food-calc,sync}.md`  
WIP: `AI_HANDOVER.md` (header only) · Completed: `archive/` · `plan/archive/`

**As of 2026-09-04.** F-8.1–F-8.9 and F-9 PR1–PR4 bulk are in tree. F-10.1–F-10.5 and F-10.7 shipped. Production create still Scout→Dietitian on expand. EN/ID chrome shipped; leftover localisation is **Track L (parked)** except live leftover chrome in **Track S**. Site class-fixes from the 2026-09-03 live pass live in **Track S** (not a 10-case queue). Do not reopen USDA/curator or Q-1.

---

## AI Studio — how to run (PRE-APPROVED)

The human will say **work on the roadmap**. That means:

1. Read **this file** from the top through **Current work**, then the F-10 table.
2. Implement the **first open ID** that is not marked Grok-only.
3. Named gates for that ID (below). Never `npm test`. Never ask to confirm a **read**. If a file truncates, read the rest in the same turn.
4. When that ID’s gates are green, **immediately** start the next open non-Grok ID in this file. Do not wait for “continue.”
5. Stop when you hit a Grok-only row, `blocked_human`, or context pressure (then write one line on `AI_HANDOVER.md` **Now** table: which ID finished).

Do **not** open `archive/`, `plan/archive/`, `FOOD.md` Part A/B, or old F-9 packs.

---

## Current work — F-8.10

**Already done:** `src/mealBuild/shouldExpandMealAgent.ts` + vitest + `scripts/assert-f10-pr1.mjs`. Do not rewrite.

**Do:**
1. `server_food_analyze_run.ts` split into 400-600 line shards.

1. `server_derivation.ts` `calculateDerivedNutrients`: when protein, carbohydrates, and totalFat are all numbers, **calories = `computeCaloriesFromMacros`** (ignore `base.calories`). `deriveCarbohydratesFromEnergy` only when carbohydrates is missing. Printed-kcal lock stays in `finalizeDishLedger`, not this helper.
2. Append to `server_derivation.test.ts`:

```ts
it('ignores agent calories when P/C/F are present (F-10.2)', () => {
  const out = calculateDerivedNutrients({
    calories: 9999, protein: 25, carbohydrates: 50, totalFat: 20,
    saturatedFat: 5, transFat: 0, sodium: 400,
  });
  expect(out.calories).toBe(480);
  expect(out.unsaturatedFat).toBe(15);
  expect(out.salt).toBeCloseTo(1.02, 2);
});
```

**Do not:** `App.tsx` / `LogChat.tsx` / `JobStore.ts` · skip Dietitian in `server_food_analyze_run.ts` (that is F-10.7) · `npm test` · `npm run build` · edit `AGENTS.md` · leave `patch_*.mjs` at repo root · LLM `calories` on scout schema.

**Gates (this ID only):**

```bash
npx tsc --noEmit
npx vitest run src/mealBuild/__tests__/shouldExpandMealAgent.test.ts server_derivation.test.ts
node scripts/assert-f10-pr1.mjs
```

Then start **F-10.3** (same file, F-10 table). Skip **F-10.6** and **F-9.5** (Grok).

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
| **AI Studio / Gemini (default)** | **Current work** above, then the next open F-10 ID. This file only. |
| **Grok leftover** | **F-9.5:** `App.tsx` poller still `JobStore.updateJob`. Do not mix with F-10. |
| Tests feel huge / every edit runs everything | **Q-7:** named map rows only. Do not `npm test`. Do not recreate missing asserts. |
| Food create architecture | **F-10** (one Meal Agent + TS expand). Not a Dietitian critic. |
| Food calories / debug file | **F-8.10, F-8.12, F-8.13** (split, packaged bind, debug). Soak is **F-10.8**, not a replay of always-dietitian. |
| Food identity still wrong | One **class** playbook (`FALSE_FRIEND` first). **Not** F-1/F-2 USDA. M30 curator stays. |
| Biomarkers | **B0** Apply smoke, then B2 leftover hygiene, then real G-B2. Chat UX = fill-template (one agent + TS batch), not 10 personas. |
| Site is slow | **R-8** measure (Q-1 is already green). Then R-9 defer. Not FoodCard/App splits first |
| Quota / egress spike | **R-1** measure, then only the matching R-id |
| Localisation leftover | **Parked** except live leftover chrome then **S-1**. Do not start L-2 to L-5 until the human reopens Track L. |
| Website / live-pass bugs | **Track S** below. One class, named vitest. Not the next live case. |
| New feature or update | [RELIABILITY.md](./RELIABILITY.md) **§10** gate table in the same change, then the F / B / L id. Do not start with a live case matrix. |

Do **not** start: USDA/FDC workstream, curator rebuild, B7.4/B7.5, Track R D1, god-file rewrite to look done, more NHS aliases before G-B2 lexer + G-B4 green, a Commercial Cooking Critic LLM, production wiring of fill-template before C1–C7 green, **Track L-2 to L-5** (parked), a 10-case live replay queue.  
Do **not** add a sixth plan file. F-10 lives here + [FOOD.md](./FOOD.md) Process.

---

## Agent Consolidation & Deprecation Strategy (2026-09-03)

The following multi-agent sprawl is scheduled for removal to streamline the architecture:

1. **Biomarker Agents Replacement**:
   - **Agents to be removed**: Lab Parser (`medical` / `agent1`), Range Calibrator (`data_review` / `agent5`), Categoriser (`agent2`), and Biomarker Reviewer (`biomarker_review`).
   - **Single Unified Replacement**: The new Biomarker Agent developed and benchmarked on the biomarker prototype (`prototype/biomarkers/` with cases C1–C7) will replace all four fragmented biomarker agents with a single-dispatch pipeline.
2. **Peripheral Agent Removals**:
   - **Agents to be removed**: Culinary Ideation Agent (`food_idea`) and Daily Actions Agent (`daily_recommendation`).
3. **Front Desk Routing Strategy**:
   - Plan all routing accordingly: Front Desk operates as the primary intake passation gateway and will route directly to:
     - **Unified Biomarker Agent** for clinical lab panels, blood tests, and reference range queries.
     - **Adaptive Meal Agent** (`food`) for all dietary logging and nutritional breakdown.
     - **Health Coach** (`health_baseline`) for metabolic baseline and lifestyle habit planning.
     - **Front Desk Inline** (`general_receptionist`) for direct profile updates, single vitals, and general Q&A.

---

## Track S — Site class-fixes (2026-09-04)

**Standing process for all new work:** [RELIABILITY.md](./RELIABILITY.md) §10. **This table** is only the 2026-09-03 live-pass burn-down. **Test method:** [QUALITY.md](./QUALITY.md).
**Do not** treat unrun live cases (C4, C6, UC-03 to UC-08) as a to-do list. They are examples for the class they hit.

Landed on GitHub `155a49a` (2026-09-04): empty-demo chat wipe, vision-scout heal so Vision Scout Corrupted does not reach the user, some Meal-06/10 EN/ID chrome, receptionist form locale plus empty-reply fallback.

| ID | Class | Status | Gate (inner) | Frozen example (outer, only after green) | Do not |
|---|---|---|---|---|---|
| **S-1** | `LEAK_EN_CHROME` | Partial | `src/utils/i18n.test.ts` plus leftover-string list in that test | One Kosong Front Desk plus one meal chrome check after the list is green | Unpark L-2 to L-5; translate food names |
| **S-2** | `LEAK_EN_AGENT` | Open | `agents/dietitianInstructions.i18n.test.ts` plus receptionist/coach `withAgentLanguage` | **L-1** one Indonesian meal-log proof (verdict/advice) | Treat old saved English analyses as chrome bugs |
| **S-3** | `SCOUT_PARSE_FATAL` | Landed; live replay pending | `server_vision_scout.test.ts` | One Meal-10 replay only | 10-case food loop; claim first-pass live green |
| **S-4** | `SCOUT_UNDERCOUNT` | Open | golden meal locks plus card chrome (kcal/P/C/F visible) | Meal-06 / Meal-10 numbers vs GT | Paint expected.json to match the undercount |
| **S-5** | `CHAT_STALE` | Landed | `src/utils/storageUtils.test.ts` | — | Re-find by logging Kosong live every session |
| **S-6** | `HANDOFF_I18N` | Partial | `src/server/receptionist/handoffContract.test.ts` driven by `prototype/receptionist/benchmark/UC-0x.json` | One UC-02 vitality after the test is green | Full receptionist click-through of UC-01 to 09 |

**Parked leftovers under S-1 (do not dump a 50-key i18n pass):** 1 serving; Preparation:; View Diagnostic Logs; receipt internals (Item Sub-Total / Estimated / Printed Packaging Label); Gender/debug chrome.

**Who runs Track S:** OpenCode plus Token Plan Qwen (DeepSeek PAYG after Token Plan is gone) for one class / one PR. Antigravity only on chiwah.liu@gmail.com for a large class-fix. Grok Bot triages a red golden or reviews a short diff and does not click the next seven cases. Skip Aider+Qwen and Alibaba Qwen Code / Lingma.

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

**Same agent pattern as F-10:** typical chat is **one** Review / fill-template dispatch. TypeScript owns identity, `convertViaTable`, status labels, and batch size. Expand to Parser chunks / specialists only when n≥20 or `sourceKind` is table/image leftovers (`BIOMARKER_LIFECYCLE.md` §4.3). Do not add Lab Parser + Review + Calibrator on a C1-sized send. Fill-template remaining work: [BIOMARKER_FILL_TEMPLATE_CASES.md](./BIOMARKER_FILL_TEMPLATE_CASES.md) (C1–C7 green **before** modal wiring).

### B8 — One math path, one door (platform continuity)

Does **not** replace B0–B7. Same pillar, same `convertViaTable` law. Trigger: second conversion table + restored Auto-Fix landed after B0.4. Method: `QUALITY.md` §7.

| # | Item | Done when | Class | Who |
|---|---|---|---|---|
| **B8.0** | Human: one Auto-Fix surface | Choice written in `AI_HANDOVER.md`: **(A)** Flagged Telemetry modal is the only Auto-Fix, or **(B)** Auto-Fix banned again | product | Human |
| **B8.1** | Telemetry Auto-Fix calls `convertViaTable` only | `computeBiomarkerTelemetryMultiplier` has no private factors; extra pairs live in `ANALYTE_CONVERSIONS`; locked `1.293` / `1.411` / `3.362` / `79.56` / `13.68` unchanged | `SECOND_MATH_PATH` | Grok (constants) |
| **B8.2** | One Check-Biomarkers control | Dictionary toolbar **or** Cleaning menu, not both | `CLONE_UI` | Gemini |
| **B8.3** | One audit mount | `runGeneralizedBiomarkerAudit` / `detectFlaggedTelemetryErrors` not re-run from Dictionary + Medical History + Trends + LogChat on the same paint | `EAGER_MOUNT` | Gemini after Grok names call sites |

---

## Track F — Food identity quality + create agent

**Architecture:** `FOOD.md` Process (Meal Agent + TS expand) + Part A catalog (do **not** rebuild curator — M30 assert is green)  
**Method:** `QUALITY.md` + `FALSE_FRIEND` / `DISH_DROP` / `OPENING_WRONG` / `SILENT_REPAIR`  
**Laws:** `docs/agent/domains/food-calc.md`

M21/M22 meal document and M30 curator stay. F-5 TypeError `.calories` is **done**.  
Live USDA/FDC is a **last-resort gap filler** on Analyze, not a workstream. Do not open F-1/F-2.

| ID | Status | Done when / parked why | Do not |
|---|---|---|---|
| **F-1** | **Parked** | Self-heal KPI unmeasured. Reopen only as a named soak (same query, no curator) during identity-class work | Rebuild curator; “fix USDA” |
| **F-2** | **Parked** | Catalog/M30 is the identity path. USDA still allowed as last resort / research | Ban USDA; make Analyze USDA-first |
| **F-3** | Open | One class playbook per session (picnic / lassi / ham…). Fixture tests in `golden_meals.test.ts` are **not** this item | `POST /loop` until all-green |
| **F-4** | Open | Measured alias hit rate; dups gated, not silently merged | Silent merge |
| **F-6** | Open | `FoodCard.tsx` ~4121 / catalog 4200. Net-zero toward ~3800 or pack lists growth. New portion/receipt UI stays in existing cards | New food table / +100 lines “enhance” |
| **F-7** | **Gate green** | `assert-budgets.mjs` PROMPT_BUDGET/scout. Keep net-zero on prompt edits (L12) | Prompt-only unit math |

Q-1 (`assert-budgets.mjs`) is **green**. They do **not** rebuild the curator (M30 stays).

### F-8 — Single-path add/edit (calorie host must die)

**Architecture:** [FOOD_SINGLE_PATH.md](./FOOD_SINGLE_PATH.md) · [FOOD.md](./FOOD.md) Process  
**Laws:** `docs/agent/domains/food-calc.md`

**Shipped (2026-08-30…31):** F-8.1–F-8.9 (gate, finalize map, edit executor, debug, tiles, packaged bind, heal slim, host deleted, thin HTTP adapter, compiler uses finalize, evidence-job TS fixture 1635 g).

| ID | Still to do | Done when | Do not |
|---|---|---|---|
| **F-8.10** | Goldilocks-split the pipeline owner | `server_food_analyze_run.ts` (~3560, ceiling 3800) split into 400–600 owners (**Meal Agent dispatch**, optional workers, DB search, prompt assembly). Delete leftover `STANDARD_FOOD_FACTORS` mock table if unused. HTTP adapter stays ≤700. Do this **with** F-10, not as a scout-vs-dietitian file split | 40-line shards; a second kcal writer |
| **F-8.11** | **Superseded by F-10.8** | Do not soak the old always-dietitian create path. Evidence job still required on the F-10 pipeline | Replay scout+dietitian as “done” |
| **F-8.12** | Packaged catalog residual | Hemaviton-class drink: vitamin C / labelled kcal from **brand or printed OCR** when those facts exist. Bind-attempt + `BIND_MISS` is already honest. F-10 does not replace catalog bind | Invent 1000 mg vitamin C |
| **F-8.13** | Debug download vs sample | A real job download: instruction + reply **once per dispatch that ran** (lead, each worker, edit). Errors = gate, no logger-echo. Shorter because create is one role | Hash-only prompts; hide schema |

Execute **one class** per session. Inner = named vitest. Outer = one frozen example, not meal-green.

### F-9 — Job session (one current turn)

**Architecture:** [FOOD.md](./FOOD.md) Process · `docs/agent/domains/sync.md` jobs  
**Class:** `STALE_TURN` (preview/chat shows a previous turn while a new one is running)  
**Not:** food-calc, F-8.10 split, meal-green. Do **not** mix with F-8.10 in the same PR (`App.tsx` / `LogChat.tsx` collision = `8742686`).

F-8 made calories have one owner. F-9 makes “what is on the preview” have one owner: `job.currentTurn` + `status` + `result` (null while not terminal). Flags (`inFlightTurnAt`, `mealSnapshotKey`) remain as fallback until F-9.5 finishes — do not add siblings.

**Shipped in tree (2026-09-01, `3cf21ff`):** F-9.1 laws/vite assert · F-9.2 `jobPreview` + `JobSession.contract.test.ts` (4/4) · F-9.3 `sessionLog` + cloned `useJob` on the card · F-9.4 `current_turn` column/increment/await upsert/LogChat increment · F-9.5 `JobStore.apply` + sync/runner. Named vitest 26/26 + `assert-f9-pr1` + `assert-dev-serves-vite` green.

| ID | Status | Still to do | Do not | Who |
|---|---|---|---|---|
| **F-9.1** | **Shipped** | — | Add flags; `npm run build` as sync | — |
| **F-9.2** | **Shipped** | — | Store-only tests | — |
| **F-9.3** | **Shipped** (residual) | Session section on **debug download**; log `ignored_stale_turn` (today every commit is `accepted`/`completed`) | New modal | Optional later |
| **F-9.4** | **Shipped** (residual) | Delete `inFlightTurnAt` / `mealSnapshotKey` only after F-9.5; App poller does not send `currentTurn` | Infer turn from calories | Grok with 9.5 |
| **F-9.5** | **Partial** | `App.tsx` poller (~15 `updateJob` sites) still writes status/result. LogChat submit still `updateJob` (not `SubmitStarted`). Wrapper `updateJob` → `commit` is OK until those call sites move | God-file rewrite; second merge path | **Grok** |

Gemini leftover from PR4 (do not treat as architecture): one-shot `patch_*.mjs` / `fix_*.mjs` at repo root — **deleted in this review**. Do not restore.

### F-10 — Adaptive Meal Agent (one role, expand when TS says so)

**Architecture:** [FOOD.md](./FOOD.md) Process · `docs/agent/domains/food-calc.md`  
**Class:** `ALWAYS_SECOND_AGENT` (create always ran Scout then Dietitian)  
**Evidence:** `prototype/meallog/meal/` (`compare_1_vs_2_agent.ts`, `run_all_11_elastic_benchmark.ts`, `BENCHMARK_PERFORMANCE_SUMMARY.md`)  
**Not:** USDA, curator rebuild, F-9.5, a Commercial Cooking Critic LLM, LLM-emitted calories.

Production today still **always** dispatches Vision Scout then Dietitian on create (`server_food_analyze_run.ts`). Prototype 1-agent (scout does identity + P/C/F + verdict; TS Atwater) matched or beat the hierarchical 2-agent path on the 11-case set. Elastic COMPLETE/DELEGATE showed simple packaged meals finishing in ~2.5s with one call; complex hotpots needed extra capacity. **Do not copy the prototype blindly:** the model picked DELEGATE poorly (airline tray COMPLETE’d and Na accuracy went to 0%), and the elastic schema emitted `calories` (F-8 forbidden).

Same pattern as biomarkers: one Review for n=1–5; TypeScript decides batch/expand; specialists only when the dispatcher expands.

| ID | Item | Done when | Do not | Who |
|---|---|---|---|---|
| **F-10.1** | **Shipped** | `src/mealBuild/shouldExpandMealAgent.ts` + vitest + `assert-f10-pr1.mjs`. Do not rewrite. | Trust lite-model self-assessment | — |
| **F-10.2** | **Shipped** | `server_derivation.ts` (`calculateDerivedNutrients`) + vitest. P/C/F present → Atwater; agent kcal ignored. | Ship elastic `calories`; carbs-from-energy on the hot path | — |
| **F-10.3** | **Shipped** | `src/mealBuild/workerMerge.ts` + vitest. Workers receive **locked grams + dish crop**, merged strictly by dishId. | Re-OCR; second kcal book | — |
| **F-10.4** | **Shipped** | `src/mealBuild/narration.ts` + vitest. Saved message numbers derive from finalize ledger table. | Dietitian `itemsBreakdown` rebuild; narrate from pre-finalize estimates | — |
| **F-10.5** | **Shipped** | `server_meal_edit.ts` + `ModeDAndEdit.test.ts`. `modificationCommand` / `[]` / `estimate` executor. | New persona; Mode Rewrite | — |
| **F-10.6** | Fat/Na TS critic | `diningEnvironment` × `cookingMethod` multipliers in finalize (restaurant fry oil, commercial Na). Honest residual on restaurant fat | Default to a second critic LLM; claim 90% fat on Case 4/9 | **Grok** constants |
| **F-10.7** | **Shipped** | `server_food_analyze_run.ts` adaptive create cutover via `shouldExpandMealAgent`. Dietitian LLM skipped on single-agent paths; D8 scale preserved. | Wrap the old dietitian create as fallback forever | — |
| **F-10.8** | Soak (replaces F-8.11) | Inner: 11 prototype cases, no Gemini. Outer: one live replay of evidence-job class. Restaurant fat/Na residual named, not painted green | `POST /loop`; soak old scout+dietitian | Grok reviews |

**Do not mix** F-10 with F-9.5 (`App.tsx` collision). Catalog bind (F-8.12) and M30 curator stay — 1-agent OCR is not a replacement for identity.

---

## Track R — Reliability (core done; start only on trigger)

**Architecture:** `RELIABILITY.md`  
**Laws:** `docs/agent/domains/sync.md`  
**Core:** M23–M28 `assert-free-tier-complete.mjs` **PASS**. Do not re-migrate images or re-kill chat Firestore writes.

| ID | Still to do | Trigger |
|---|---|---|
| **R-1** | Re-measure Firestore writes / Supabase egress | Quota or bill spike |
| **R-2** | Cloudflare Pages for `dist/` | Static latency actually hurts |
| **R-3** | Playwright leftover-English plus demo-empty smoke | After **S-1** string list is green; not instead of class goldens |
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

**Landed — do not redo:** Q-1 (`assert-budgets.mjs` PASS) · Q-2 (`CATALOG.json` primitives) · Q-3 (`AppModal` + `FilterPills` + tests; Audit uses FilterPills) · QUALITY.md header already “Waves 0–7” · `scripts/golden-from-medical-debug.mjs` exists.

| Still to do | Done when |
|---|---|
| Make G-B2/5/6/7/9 **execute** the helper they name | Tests call `lexTable` / door classifier / completeness path; fixture-label-only tests are not enough |
| Inbox by class | Biomarkers tab lists examples grouped by class, not a single G-B1 card |
| **Q-4** `AgentResultTable` thin | Grid behavior only; agent YAML / apply / localStorage missing-keys **out**. Call sites pass data. Grok-owned |
| **Q-5** Delete one-shot patch scripts | Root `patch_*.ts` / `fix-*.ts` residue gone after the last class they served. F-9 `patch_*.mjs` already removed |
| **Q-6** Unified bug queue | Snap + auto + golden tape are **one `#n`**. Inbox is not a second list. Named bug first; extra tape reds = series remaining (or sibling `#n`). Promote (photos + class test) → official `G*` / G-B fail-safe. No `/loop`. See `QUALITY.md` §14–14.4 |
| **Q-7** Test + golden hygiene | COMPLETE = `tsc` + matching regression-map rows, not `npm test`. Ghost `assert-*.mjs` citations gone. G1 asserted once (`golden_meals.test.ts`). Frozen create fixture is Meal Agent JSON (no kcal), not scout→dietitian `scout.json`. Inbox / `golden:loop` not on every food PR. See `QUALITY.md` §1.4–1.5 |

Session replay: **abandoned**.  
Golden-execution Q work is usually **inside** B2/B4/B6 or F-3.  
File-collision rule: B0 and R-9 both touch `App.tsx` → serialize those two only. F-9.5 also touches `App.tsx` — serialize with B0/R-9.

### Platform program order (not a fifth pillar)

Same reward change as class-first goldens (`QUALITY.md` §0): green means the **class** is closed, not “the page still works.”

```text
Q-1 + Q-2 + Q-3              ← landed
F-10.2 then 10.3–10.5, 10.7  ← Gemini from this file (Current work)
F-9.5 App poller             ← Grok (serialize vs B0/R-9)
F-10.6 fat/Na TS             ← Grok constants
F-8.10 + F-8.12 + F-8.13     ← with F-10, not old dietitian
F-10.8 soak                  ← after 10.7
B0 / fill-template C1–C7     ← Track B
```

Do **not** open Q-4 or a Dictionary/FoodCard/`App.tsx` breakup unless Q-1 is red on that file.

### Who does which

| | **Gemini** (AI Studio — this ROADMAP) | **Grok** |
|---|---|---|
| Prefer | F-10.2–10.5, 10.7; B8.2/8.3; R-9 FIND/REPLACE; F-6 net-zero in existing cards | F-9.5 `App.tsx`; F-10.6 constants; Q-4; any split of `App.tsx` / `LogChat.tsx` / `Header.tsx` |
| Do not | `App.tsx` poller; `npm test`; critic LLM; USDA; invent a pack file | Mix F-10 into an open F-9.5 edit |

---

## Track L — Localisation (parked)

**Parked 2026-09-02.** Human said park remaining localisation. Do **not** start L-* while Current work is F-10, or until the human reopens this track.

**Architecture:** `src/utils/translations.ts` (`en` source of truth, `id` key-parity) · `src/utils/i18n.ts` (`t()`, English fallback, `withAgentLanguage` / `withScoutLanguage`) · named gates `src/utils/i18n.test.ts` and `agents/dietitianInstructions.i18n.test.ts`.
**Scope:** English + Indonesian only. `fr` / `zh` stay incomplete and fall back to English. More languages later.

### Landed — do not redo

EN/ID UI chrome for login, home, chat, food history, insights, trends/health, profile menu; status badges; nutrient display names; health category headings; BMI/BMR panel; Insights step blurbs; job Ready/Active/Queued chip; chat empty-state; demo/credits; skip-dietitian verdict/advice templates; agent instructions follow `profile.language`. Food identity names stay untranslated. Native file-picker chrome cannot be translated.

### Still to do (parked)

- **L-1 Live Indonesian meal-log proof.** One demo meal on id UI: verdict/advice is Indonesian, not English Supports Sustained Metabolic Energy. Food names may stay English. Do not treat old saved analyses as a chrome bug.
- **L-2 Seeded / demo content.** Clinical-action item texts, daily-benefit item texts, Insights literature card titles/blurbs, outlier preciseCause sentences follow profile.language or are stored per-locale. Do not translate food names or expand fr/zh.
- **L-3 Catalog display names.** Biomarker catalog names and medical-condition names have en+id display labels; stored keys stay English. Do not change catalog keys or enums.
- **L-4 Admin / leftover widgets.** Theme editor titles; nutrition-browser admin; audit FilterPills labels; ImageSlider / BatchNavigator / AgentResultTable Previous; AppModal callers pass language. Patient chrome already shipped.
- **L-5 More languages.** New locale in SUPPORTED_LOCALES; pack in translations.ts; add to REQUIRED_COMPLETE_LOCALES only when that language is a milestone. Do not make fr/zh complete as a side quest.

**Out of Track L:** dish/brand names, JSON keys / nutrient codes / biomarker keys, native Choose File, old saved meal-analysis sentences (re-log to refresh).

**Gates when reopened:** named i18n vitest only (i18n.test.ts and dietitianInstructions.i18n.test.ts).

## Gates (named rows, not a pile)

**Every COMPLETE:** `npx tsc --noEmit` + the [DOMAIN_REGRESSION_MAP.md](../docs/agent/DOMAIN_REGRESSION_MAP.md) row(s) for files you touched. That is the whole default. See `QUALITY.md` §1.4.

**Soak** (`npm test`) is optional and slow (~97 files). Do not make it the inner loop. `tests/golden_inbox.test.ts` stays excluded.

Track-specific (only if that track’s files changed):

```bash
# Track B
node scripts/assert-biomarker-lifecycle-m31.mjs
node scripts/assert-biomarker-ingest.mjs
npx vitest run src/utils/biomarkerLifecycle.test.ts src/utils/biomarkerIdentity.test.ts src/utils/biomarkerSanitize.test.ts tests/golden_biomarker.test.ts
# Track F curator
node scripts/assert-food-curator-m30.mjs
# Track R sync
node scripts/assert-free-tier-complete.mjs
npx vitest run src/utils/syncUtils.regression.test.ts
# Track Q platform (prompt / god-file size)
node scripts/assert-budgets.mjs
```

Do **not** invent missing `scripts/assert-*.mjs` names from old map rows (Q-7).
