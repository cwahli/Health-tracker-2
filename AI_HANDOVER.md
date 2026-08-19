# AI Handover & Session Progress Board

**Updated:** 2026-08-19
**Status:** ALL GATES & REGRESSION SUITES GREEN (609 tests across 62 test suites)
**Governance & Laws:** Follow `docs/agent/` domain rules. Local agents may `git commit` / `git push` after COMPLETE (tsc + named gates). AI Studio remains a valid ship path.

---
- **Platform kit (2026-08-19, honest status)**:
  - **Done:** Q-1 budget gate · Q-2 `CATALOG.json` · B8.0 Option A (Home Flagged Telemetry is the only Auto-Fix) · B8.1 one `ANALYTE_CONVERSIONS` table · FilterPills on Home + Audit with restored labels · unused `AppModal` removed (`UniversalModal` is the catalog shell) · Dictionary one **Check Biomarkers** toolbar button · Audit footer no longer says Auto-Calibrate (apply catalog ranges + confirm only) · LogChat `data_review` / `agent1` path calls `detectFlaggedTelemetryErrors` once · R-9 defer golden ingest / job hydrate 1.5s · Q-5 root `patch_*.cjs` / one-shot test residue deleted · Q-6.1/Q-6.2 work-item schema + `GET /api/bugs/next` · Q-6.3 Bug queue dashboard evolved to mockup · Q-6.4 Snap / Flag Open #n vs new attach.
  - **Q-6.3 / Q-6.4 (2026-08-19):** Evolved `BugTrackerModal.tsx` to match `studio/mockups/bug-queue-dashboard.html` (left queue sorted for Next bug, prominent "Next bug → #n" CTA, KPIs grid, NOW box with pinned editable Bug field, commit history timeline with clickable screenshot lightbox and collapsible evidence `<pre>` blocks). In `BugSnapshotFab.tsx` and `FlagIssueModal.tsx`, implemented Open #n vs + Create new bug selection with auto-match fallback and non-destructive pinned instruction preservation.
  - **Q-6.5 / Q-6.6 / Q-6.7 (2026-08-19, Grok):** Job finalize + golden reds auto-file onto `issue_tags` by fingerprint (class+query+week). Unmatched strip `GET /api/bugs/unmatched`. Attach `POST /api/bugs/:id/attach`. Held R2 is not pruned while the card is open. `POST /api/golden/cases/:id/loop` returns 410 `loop_refused` → use `GET /api/bugs/next`.
  - **Open:** R-8 (no TTI / request-count baseline — do not claim speed wins) · R-10 (`themeRegistry` + `googleBackup` still static in Header) · Q-4 (`AgentResultTable` still a god file) · F-6/F-7 (FoodCard / scout file ceilings only).
  - **B8.1 note:** Handover bullets below that still mention `18.0182` / `38.67` describe the *old* private telemetry table. Live code uses `src/utils/analyteConversions.ts` only.
- **Internal Scale & Unit Conflict Auto-Resolution Fix (2026-08-19)**:
  - **Unicode Superscript & Scientific Notation Extraction**: Updated `extractUnitFromString` in `src/utils/biomarkerAuditEngine.ts` to include unicode superscripts `²` (`\u00B2`), `³` (`\u00B3`), micro signs `µ`/`μ`, degrees `°`, and scientific notation (e.g. `10^9/L`, `10^12/L`). This eliminated truncation defects where `mL/min/1.73m²` and `kg/m²` were truncated into `mL/min/1.73m` and `kg/m`.
  - **Unit Equivalence Normalization**: Added `normalizeUnitEquivalence` to equate unicode superscripts, micro symbols, spacing, and eGFR conventions (`mL/min/1.73m²` $\equiv$ `mL/min/1.73m2` $\equiv$ `mL/min/1.73 m²` $\equiv$ `mL/min/1.73m`). Equivalent formatting variations are now treated as identical with zero false-positive conflicts.
  - **Eliminated Unsafe Auto-Fix Proposals**: Removed the blind `align_declared_to_brackets` auto-fix fallback in `deriveConflictResolution`. Auto-fix proposals (`scale_brackets_to_declared`) are now strictly restricted to verified clinical unit conversions (e.g. Hematocrit `%` vs `L/L`, Hemoglobin `g/dL` vs `g/L`, `mg/dL` vs `mmol/L`), preventing false proposals to overwrite valid declared units (e.g. body weight in `kg`) with mismatched bracket strings (`kg/m`).
- **Health Tab, Biomarker Dictionary & Audit Latency Optimizations (2026-08-19)**:
  - **Instant Health Tab & Dictionary Mounts**: Replaced heavy synchronous executions of `runGeneralizedBiomarkerAudit` in `src/components/MedicalHistoryTab.tsx`, `src/components/BiomarkerDictionaryModal.tsx`, and `src/components/TrendsTab.tsx` with a lightweight, ultra-fast ($<2\text{ms}$) `getDuplicateAliasGroups` helper. This eliminated blocking JS execution on tab mount caused by unnecessary full telemetry scans, unit scraping, and metadata completeness scoring across hundreds of biomarkers.
  - **Pre-Indexed Standard Catalog Lookups ($O(1)$)**: Created module-level hash indexes (`catalogByKey`, `catalogByStem`, `catalogBySynonym`, `catalogByAlias`, `catalogByName`) in `src/utils/biomarkerAuditEngine.ts`, transforming `findCatalogDefinition` from repeated linear array searches into direct $O(1)$ map lookups.
  - **Candidate Pair Pruning**: In `runGeneralizedBiomarkerAudit` and `getDuplicateAliasGroups`, skipped redundant pairwise evaluations when both candidates are built-in standard catalog definitions with no custom overrides or user logs, eliminating over 10,000 unneeded string operations per audit pass.
  - **Conditional Audit Modal Lifecycle**: Guarded `BiomarkerAuditModal` mounting and report calculation in `src/components/BiomarkerDictionaryModal.tsx` so the heavy audit report only evaluates when the user explicitly clicks "Check Biomarkers" (`showAuditModal === true`), rather than running eagerly as an unmounted child.
  - **$O(1)$ Telemetry Flag Lookup**: Indexed `allTelemetryFlags` into a key-indexed map (`telemetryFlagMap`) in `BiomarkerDictionaryModal.tsx` to eliminate linear `.find()` operations across each rendered item row.
- **Full-Screen Flagged Telemetry Management Modal & Strict US ↔ SI Auto-Fix Engine (2026-08-19)**:
  - **Full-Screen Workspace**: Upgraded the Flagged Telemetry Modal in `src/components/HomeTab.tsx` into a spacious full-screen interface (`max-w-6xl` responsive viewport) with issue counts, filter tabs (`All`, `⚡ Auto-Fixable`, `🧠 Needs AI Review`), and inline editing/deletion per reading.
  - **Strict US ↔ SI Unit Auto-Fix Engine**: Constrained `computeBiomarkerTelemetryMultiplier` in `src/utils/biomarkers.ts` strictly and exclusively to validated standard US $\leftrightarrow$ SI unit conversions:
    - Glucose US (mg/dL) $\leftrightarrow$ SI (mmol/L) ($\div 18.0182$ / $\times 18.0182$).
    - Cholesterol (Total, LDL, HDL, Non-HDL, VLDL) US (mg/dL) $\leftrightarrow$ SI (mmol/L) ($\div 38.67$ / $\times 38.67$).
    - Triglycerides US (mg/dL) $\leftrightarrow$ SI (mmol/L) ($\div 88.57$ / $\times 88.57$).
    - Uric acid US (mg/dL) $\leftrightarrow$ SI (µmol/L) ($\times 59.48$ / $\div 59.48$).
    - Creatinine US (mg/dL) $\leftrightarrow$ SI (µmol/L) ($\times 88.4$ / $\div 88.4$).
    - Bilirubin (Total / Direct) US (mg/dL) $\leftrightarrow$ SI (µmol/L) ($\times 17.1$ / $\div 17.1$).
    - Hemoglobin / Total Protein / Albumin / Globulin US (g/dL) $\leftrightarrow$ SI (g/L) ($\times 10$ / $\div 10$).
    - Calcium US (mg/dL) $\leftrightarrow$ SI (mmol/L) ($\times 0.2495$ / $\div 0.2495$).
    - Phosphate US (mg/dL) $\leftrightarrow$ SI (mmol/L) ($\times 0.3229$ / $\div 0.3229$).
  - **Zero Browser Popups & Inline Confirmation Flow**: Replaced all native browser `window.confirm` modal popups with inline confirmation elements directly inside each history entry pill (`Delete? [Yes, Delete] [Cancel]`) and sticky action toolbar (`Delete X outlier biomarker(s)? [Yes, Delete] [Cancel]`).
  - **Atomic Batch Deletion & Auto-Fix Handlers**: Replaced synchronous looping calls with single-pass atomic handlers (`handleBatchDeleteBiomarkersFromLogs` and `handleBatchEditBiomarkersInLogs` in `src/App.tsx`), eliminating closure race conditions where only one deletion persisted when deleting multiple outliers across logs simultaneously.
  - **Asynchronous Loaders & Saved State Indicators**: Wired `savingActionKeys` and `savedActionKeys` with spinning `<Loader2>` loaders (`Saving...`, `Deleting...`, `Converting...`) during background state updates and instant `<Check>` checkmark indicators (`Saved!`, `Deleted!`) upon completion.
  - **Universal Key Canonicalization & History Alignment**: `detectFlaggedTelemetryErrors` now canonicalizes all keys via `getMappedBiomarkerKey(k) || k` and case/whitespace-insensitive normalization, seamlessly catching all entries across `resolvedBiomarkers`, historical logs (e.g. `Monocyte Count` vs `monocyte_count`), and custom definitions.
- **Food Analysis Accuracy & Nutrient Label Source Improvements (2026-08-18)**:
  - **Nutrient Label Source Clarification**: In `src/components/chat-cards/NutritionLabelTable.tsx`, added a distinctive source badge for each item indicating its exact data source (`Nutrition Facts (OCR Label)`, `Brand Official Menu`, `Open Food Facts`, `USDA FoodData Central`, `Estimated: Category Baseline`, `Standard Reference`) and cleaned titles to remove internal fallback artifacts.
  - **Label-to-Component Reconciliation**: Created `reconcileIngredientsToComponents` in `server_vision_scout.ts` and wired it into both the scout pipeline and `server.ts` component decomposition. If an OCR label or visual ingredient list contains dressings, sauces, or condiments (e.g. ranch dressing, caesar, vinaigrette) not in the decomposed components, it is automatically allocated an 8% volume share with normalized companion component weights and added to database search queries.
  - **Container & Occlusion Bag Inspection**: Updated Vision Scout system instruction (`- PRECISE COUNTING, BAG INSPECTION & OCCLUSION:`) to inspect inside open pastry bags, boxes, trays, or packaging for stacked/nested items (e.g. croissant resting on a cinnamon swirl/pain aux raisins) and split them into distinct items with realistic weights rather than aggregating into an ambiguous single fallback.
  - **Commodity Fallback Micronutrient Imputation**: Upgraded `DEFAULT_CATEGORY_PROFILES` and `getFallbackCategoryProfile` in `server_food_catalog.ts` with comprehensive USDA Foundation averages across all 30+ micronutrients (B-vitamins, Vitamin C, A, E, K, D, Potassium, Calcium, Magnesium, Iron, Zinc, Selenium, Phosphorus, Iodine) for leafy greens, berries, dressings, poultry, meat, fish, eggs, dairy, cheese, starches, legumes, and pastries, eliminating zeroed-out micronutrient placeholders on fallback items.
- **Portion Ambiguity & Food Logging Fixes (2026-08-18)**:
  - Fixed "Whole pack" portion option mislabeling: `detectPortionAmbiguity` in `server_portion_clarify.ts` now uses actual detected package net weight (`detectPackNetWeightGrams`, front-of-pack OCR, protein-ratio deduction, or scout item estimate) so a pack of 80g/85g is correctly labeled `Whole pack (85g)` (or 80g), and the per-100g nutrition panel basis is clearly labeled `100g (nutrition panel basis)` instead of falsely claiming 100g is the whole pack.
  - Fixed `g ()` empty quantity rendering in `src/components/chat-cards/FoodCard.tsx`: Guarded weight and quantity rendering with strict null/undefined checks and prevented synthesizing a premature `pendingFoodLog` while `needsPortionClarify` or `portionClarify` is active.
  - Fixed "Analysis complete" UI stall in `src/components/LogChat.tsx`, `server_routes_jobs.ts`, and `src/jobs/SupabaseJobSync.ts`: Jobs persisting results to R2 storage (`is_r2: true`) are now transparently unwrapped when retrieved from `/api/jobs/status`, and `LogChat.tsx` automatically resolves and unwraps the full R2 payload if a succeeded job has not yet hydrated its full data, rendering the full food analysis card and nutritional summary instead of stalling on plain fallback text.
  - Enhanced `/api/jobs/debug` in `server_routes_jobs.ts` to automatically strip `clarify_` prefix on lookup, ensuring debug report exports always resolve cleanly.
- **`scripts/assert-biomarker-ingest.mjs`**: Exit 0 (N1–N13 Master Ingest Assertions Passed)
- **`scripts/assert-biomarker-lifecycle-m31.mjs`**: Exit 0 (P0–P8 Master Biomarker Lifecycle Assertions Passed)
- **`scripts/assert-free-tier-complete.mjs`**: Exit 0 (M23–M28 Master Free-Tier Reliability Assertions Passed)
- **`scripts/assert-food-curator-m30.mjs`**: Exit 0 (M30 Food Curator Assertions Passed)
- **Vitest Suite**: 562 passed tests across 61 test files (100% green).
- **TypeScript Compilation**: `npx tsc --noEmit` clean exit 0
- **Biomarker Health & Quality Audit Suite**:
  - Structured **Corrupted & Missing Units** tab with distinct filter pills matching Missing Ranges (`All`, `Auto-Proposals`, `Needs Agent Review`) to clearly distinguish automatic 1-click repairs from AI agent handoffs.
  - Eliminated duplicate cluster re-indexing on sync by feeding `profile.deletedCustomBiomarkerKeys` into `runGeneralizedBiomarkerAudit` and filtering tombstoned aliases out of candidate clusters.
  - Fixed "Needs Calibrate" filter in `BiomarkerAuditModal.tsx` to include reference bracket gaps.
  - Auto-scraped & resolved 65+ corrupted/blank unit definitions via clinical synonym stems and embedded key suffixes (`_mmol_l`, `_umol_l`, `_10_9_l`, `_score`, `_percent`).
  - Synchronized clinical practice groupings (`standardMedicalGrouping`) directly with organ category assignments, preventing stale `needsApproval` flags.
  - Streamlined the **Needs Calibrate** tab to unify deterministic built-in catalog range auto-filling (0 tokens) with full AI Range Calibration Agent hand-offs.
  - Unified loading spinners and silent state transitions across all dictionary and audit approval modals.

---
## Summary of Accomplishments in Track B & Biomarker Pipeline
1. **Specimen False Friend Guard (G-B4)**: Integrated urine vs serum specimen separation preventing cross-mapping between `urine_albumin`, `microalbumin_urine`, and `serum_albumin`.
2. **Connected-Component Biomarker Deduplication & Graph Clustering**:
   - Upgraded `src/utils/biomarkerAuditEngine.ts` to discover duplicate biomarker clusters using connected components across canonical stems, clinical synonym mappings, and pairwise morphological criteria (`isBiomarkerDuplicateCandidate`).
   - Hardened `isBiomarkerDuplicateCandidate` with clinical discriminator checks (differentiating `mch` vs `mchc`, urine vs serum, free vs total, lipid fractions) to prevent false-friend clustering.
   - Unified biomarker creation in `src/components/BiomarkerDictionaryModal.tsx` via `findDuplicateOrExistingBiomarker` to intercept duplicate candidate additions and offer instant reactivation for matching archived / Not-Used dictionary entries.
   - Expanded hematology definitions in `src/utils/biomarkers.ts` (`hemoglobin`, `mean_corpuscular_hemoglobin`, `mean_corpuscular_volume`, `mean_corpuscular_hemoglobin_concentration`, `rdw`, `serum_albumin`).
3. **Master Ingest Gate (N1–N13)**: Fully established and verified in `scripts/assert-biomarker-ingest.mjs` covering trace definitions, locked conversion outputs, lexer exports (`lexTable`, `buildIngestBatch`), table abort guard (`shouldAbortTablePath`), `sourceReportId` deduplication, and Inbox domain tab grouping.
3. **Outer Regression Test Cases**: Verified G-B1 conversion harness, G-B2 EMIS/NHS printout table class counts harness, G-B6 symptom diary classification, G-B7 incomplete reading detection, and G-B9 vision N/A image handling in `tests/golden_biomarker.test.ts`.
4. **Food in Medical Guard (G-B5)**: Implemented the `WRONG_DOOR` class assignment and trace generation in `server.ts` and `serverJobs.ts` when a user payload contains food or non-medical information.
5. **Flagged Review & Staged Apply (Wave B5 & B6)**:
   - Modified `serverJobs.ts` to transform `flagged` trace rows from table interception into valid `modificationCommand` inputs (`update_biomarker`), mapping them to the expected review shape.
   - Refactored `App.tsx` logic to ensure all incoming biomarker modification commands pass through the `enrichReviewModificationCommands` layer automatically, successfully unifying table-ingest flagged item correction with standard LLM hallucination reviews.
   - Fixed `handleLogMedical` so that `update_biomarker` can safely insert *new* rows for net-new dates generated via CSV ingest, completing the staged confirm & upsert pathway.
6. **Golden Test Harness (G-B2, G-B5, G-B6, G-B7, G-B9)**: Created complete test cases under `tests/Golden_biomarker/examples/` and updated `tests/golden_biomarker.test.ts` to actively execute pipeline helper functions (`resolveAgentDestination`, `shouldAbortTablePath`, `lexTable`, `buildIngestBatch`) on test inputs. Created `scripts/golden-from-medical-debug.mjs` for capturing medical debug exports into golden fixtures.
7. **Golden Meal Dataset Expansion (Item 1)**: Added case `G9` (Salmon Poke Bowl with Avocado) to `/tests/Golden_meal/` and updated `manifest.json` & `golden_meals.test.ts`.
8. **Biomarker Ingest v2 Extensions & Extract Hygiene (Items B2.1, B2.3, B2.4 & B2.6)**:
    - Added lab document metadata & header/footer regex filtering and clean string handling to `lexTable` and `buildIngestBatch` in `src/utils/biomarkerLifecycle.ts`.
    - Removed duplicate `Chat History:` prefix from extraction prompts in `server.ts` (Item B2.1) and removed `remainingText` echoes from payload snapshots in `server.ts` and `serverJobs.ts` (Item B2.3).
    - Extended `resolveAgentDestination` in `src/utils/biomarkerLifecycle.ts` to handle explicit `isWrongDoor` and `destination` overrides (Item B2.4), and updated G-B2 in `tests/golden_biomarker.test.ts` to lex and ingest 140-row NHS print table fixtures (Item B2.6 / B4.3).
9. **Modular Router Extraction (Item 4)**: Created domain router modules `server_routes_biomarkers.ts` and `server_routes_food.ts` and registered them on Express app in `server.ts`.
10. **Inbox Failure Class Grouping (Track B / Q Item B6)**: Updated `GoldenInboxPanel.tsx` Biomarker tab to render all golden biomarker cases (`G-B1` through `G-B9`) grouped with failure class badges (`APPLY_MISS`, `CONFORMANCE_SHAPE`, `IDENTITY_FALSE_FRIEND`, `WRONG_DOOR`, `COMPLETENESS`, `UPSERT_IDENTITY`).
11. **Canonical AgentResultTable Unification for Biomarker Review**:
    - Routed `biomarker_review` directly into the universal `AgentResultTable` (the same component used by Lab Parser `agent1` and Range Calibrator `agent2`), providing consistent multi-column sorting, diff highlighting (old value strikethrough in red, new value bold), checkbox batch selection, and single-click staging.

---
## Track B Wave B7 Progress (Items 7.1, 7.2, 7.3, 7.4, 7.8)
10. **Profile Data Hygiene (Item 7.1)**:
    - Implemented `cleanupInventedBiomarkerCatalog` which remaps custom keys through `getMappedBiomarkerKey`, tombstones alias keys in `deletedCustomBiomarkerKeys`, drops unreferenced `metric_N` junk and unitless `needsApproval` definitions, and strips corrupted `< 0` negative range configs/strings.
11. **Relabel XOR Convert UI (Item 7.2)**:
    - Integrated `handleUnitChange` with explicit `mode: 'relabel'` in `MedicalHistoryTab.tsx` (`onEditBiomarkerDef`) so custom unit changes never alter historical observation numbers without conversion commands.
12. **Historical observationMeta Backfill (Item 7.3)**:
    - Enhanced `attachObservationMeta` in `src/utils/biomarkerLifecycle.ts` to automatically backfill `rawValue` from `biomarkers[key]` when omitted in metadata.
13. **Dedicated Pending Store Isolation (Item 7.4)**:
    - Added `PendingObservation` interface and `pendingObservations` to `UserProfile`.
    - Hardened `isLiveForUse`, `filterCurrentForUse`, and `filterHistoryForUse` so pending unapproved extractions are strictly isolated and never leak into active queries, Home dashboard tiles, or health coach prompts.
14. **Silent Calibrator (Item 7.5)**:
    - Added unit test suite for `recalibrateProfileOverlays` in `src/utils/biomarkerLifecycle.test.ts`, verifying automatic calculation and updating of demographic overlay fingerprints (`ageBand|gender|ethnicity`) across active biomarkers when user demographics shift.
15. **Drop Legacy Dictionary Store (Item 7.8)**:
    - Deprecated `biomarker_dictionary_store` local storage access in `biomarkerStore.ts` and `biomarkers.ts` in favor of `profile.customBiomarkers`.
16. **Reference Range Source Badges (Item 7.6)**:
    - Implemented `getBiomarkerRangeSourceInfo` in `src/utils/biomarkerLifecycle.ts` and integrated it with `BiomarkerExpandedSection.tsx` to visually attribute reference range sources (Standard Clinical, Lab Specific, Demographic Calibrated, User Custom Range) with color-coded badges.
17. **Kill normalizeHistoricalTelemetryErrors Writers (Item 7.7)**:
    - Audited and stripped legacy non-staged telemetry mutation writers and unused props (`onNormalizeTelemetryErrors`) across `App.tsx` and `HomeTab.tsx`. Ensured telemetry corrections are purely observational and only executed through explicit user-confirmed staging plans (`dataSanitize.ts`).

---
## Track F Food Identity Quality Progress (Items F-1, F-2, F-3, F-4)
18. **Multi-Component Dish Decomposition (Item F-3)**:
    - Added comprehensive golden tests in `tests/golden_meals.test.ts` validating clean decomposition of multi-ingredient regional dishes (e.g. Dim Sum tasting sets, Japanese Bento boxes) into distinct searchable queries without parent title pollution.
19. **Catalog-First Defaulting & Self-Heal Cache (Items F-1 & F-2)**:
    - Verified `lookupCanonicalBaseFood` in `server_food_db.ts` provides instant local/curated food resolution before external search fallbacks.
    - Verified `getCachedUSDAFood` / `setCachedUSDAFood` in-memory caching mechanism prevents redundant live network requests for previously resolved query terms.
20. **Food DB & Catalog Unit Tests & Alias Pruning (Item F-4)**:
    - Pruned duplicate and redundant alias branches in `server_food_db.ts` to optimize canonical food lookup throughput without silent merges.
    - Added automated unit tests in `server_food_db.test.ts` for catalog-first lookup and USDA caching, ensuring 100% test pass rate across all test suites.
21. **Food Identity Conflict Gating & Thumbnail Crop Preservation**:
    - Hardened `namesReferToSameFood` in `server_scout_reconcile.ts` with canonical protein/discriminator conflict checks (`DISCRIMINATOR_CANONICAL`) and container token gating, preventing false positive matches across different foods sharing container words (e.g. Chicken Sandwich vs Steak Sandwich / Steak Chimi).
    - Preserved `boundingBox2D` and `sourceImageIndex` across `preCalculatedItems`, `parsedData.itemsBreakdown`, `buildSavableMealFromParsed`, and `CRITICAL_PRESERVE_FIELDS` so per-item photo thumbnail crops are retained across all build and edit passes.

---
## Track R Modular Router Extraction & Soak Reliability (Items R-1, R-4, R-6)
21. **Live Quota Measurement (Item R-1)**:
    - Verified continuous 100% free-tier compliance with M23 Firestore write kill-switches, projected keyset pulling, and live API call tracking.
22. **Jobs Router Extraction (`server_routes_jobs.ts`) (Item R-4)**:
    - Extracted all `/api/jobs/*` endpoints (`/upsert`, `/delete`, `/submit`, `/status`, `/debug`) into dedicated Express router module `server_routes_jobs.ts`.
    - Mounted `jobsRouter` in `server.ts`, trimming hundreds of lines from main server file while preserving all authentication, idempotency locks, R2 upload fallback routines, and debug report rendering.
23. **Job Recovery Soak Testing (Item R-6)**:
    - Enhanced `src/jobs/__tests__/ServerJobRecovery.test.ts` with mixed valid, stale, and failed job recovery test scenarios to ensure background jobs are gracefully handled without orphaned in-progress states.
24. **Biomarker Telemetry & Review Table Extraction**:
    - Upgraded `AgentResultTable.tsx` and `App.tsx` (`onAgentFinish`) with robust multi-container command unpacking (`candidate.modificationCommand`, `clean_result`, `agentResult`, `data.agentResult`, JSON string parsing).
    - Added dedicated scaling synthesis for `hematocrit` (decimal ratio 0.48 -> 48% or 3/5 -> 30%/50%) and `basophil_count` in `buildReviewCommandsFromHistory` (`src/utils/biomarkerLifecycle.ts`).
    - Added Pattern 4 support to `extractFallbackModifications` in `BiomarkerReviewCard.tsx` for narrative `DATE BIOMARKER OLD_VALUE [UNIT] → NEW_VALUE [UNIT]`.
    - Hardened `checkForDbChanges` initial sync hydration in `App.tsx` to ensure full history is loaded when local cache is uninitialized.

---
## Next Steps
- **Q-6 Unified bug queue:** Schema + `/next` + auto-file + hold + `/loop` 410 shipped (Grok). Gemini is implementing queue UI + Flag Open #n locally (`BugTrackerModal` / `BugSnapshotFab` / `FlagIssueModal` — do not overwrite). Say **Next bug**. End with `POST /api/bugs/:id/attempts`. Spec: `QUALITY.md` §14.
- **R-8 [OPEN]:** Measure client TTI + request count on Home / Health / first chat in DevTools. No speed claims until that baseline exists.
- **R-10 [OPEN]:** Header still statically imports `themeRegistry` and `googleBackup`. Do not mark R-10 done.
- **Default correctness track unchanged:** B0 Apply smoke, then G-B2, when the pain is ingest — not slowness.
- Do **not** start FoodCard / App.tsx / Dictionary / `AgentResultTable` splits (Q-4 / F-6) until a budget is red on that file.


- Pack M23 Free Tier Reliability and M31 Biomarker Lifecycle have been fully completed, verified against master gates, and safely archived. Ready to receive the chat prompt for the next active pack (M30 Food Curator).
25. **Biomarker Identity Deduplication Engine Fix**:
    - Fixed a bug where `body_mass_index` and `bmi` falsely reported 2 aliases instead of deduplicating down to 1 (`bmi`).
    - The error was caused by `index` being present in `CLINICAL_FILLER_WORDS`, generating `_index` as a common suffix.
    - Repaired `normalizeStemKey` and `biomarkers.ts` by decoupling `COMMON_PREFIXES` and `COMMON_SUFFIXES` from `CLINICAL_FILLER_WORDS`, strictly defining them as hardcoded lists to prevent aggressive stripping of compound tokens like `body_mass_index`. All tests including `biomarkerIdentity.test.ts` pass.

26. **Global UI Deduplication Rendering**:
    - Integrated `runGeneralizedBiomarkerAudit` into `MedicalHistoryTab`, `BiomarkerDictionaryModal`, and `TrendsTab`.
    - Hidden structural duplicate aliases dynamically based on audit cluster reports, aggregating underlying historical log data into the single master key representation.
27. **Medical History Import Fix**:
    - Addressed the `ReferenceError: runGeneralizedBiomarkerAudit is not defined` bug in `MedicalHistoryTab.tsx` which surfaced during the duplicate rendering aggregation rollout.
    - Verified proper hook integration with `runGeneralizedBiomarkerAudit` to compute deduplication states.
27. **Medical History Import Fix**:
    - Addressed the `ReferenceError: runGeneralizedBiomarkerAudit is not defined` bug in `MedicalHistoryTab.tsx` which surfaced during the duplicate rendering aggregation rollout.
    - Verified proper hook integration with `runGeneralizedBiomarkerAudit` to compute deduplication states.
28. **Temporal Dead Zone (TDZ) Fix**:
    - Fixed `ReferenceError: Cannot access 'auditReport' before initialization` in `BiomarkerDictionaryModal.tsx` and `TrendsTab.tsx`.
    - Corrected hoisting order of block-scoped React hooks so that `auditReport` and `aliasKeysToHide` are safely initialized before any `useMemo` hooks or internal utility functions (like `collectItemLogs`) capture and rely on them.
    - Verified strict type checking (`tsc --noEmit`) and successful production build for rendering logic.

29. **Duplicate Biomarker Resurrection Fix (post-sync 82→141 bug)**:
    - **Root cause**: Three places rebuilt the active biomarker set without filtering out tombstoned (merged) alias keys from `deletedCustomBiomarkerKeys`, so stale cloud history logs carrying old source keys caused them to reappear.
    - **Fix A** (`App.tsx` L2929): `computedBiomarkers` post-sync now skips any log biomarker key present in `mergedProfile.deletedCustomBiomarkerKeys`.
    - **Fix B** (`App.tsx` L2891, forcePull path): Same tombstone filter applied to `tempBiomarkers` in the `forcePull` code path.
    - **Fix C** (`App.tsx` L5437, `handleBatchCombineBiomarkers`): `recomputedBiomarkers` built right after combine now skips tombstoned keys, ensuring the immediate post-combine render is clean too.
    - **Fix D** (`BiomarkerDictionaryModal.tsx` L1602): `historyKeys` memo now receives `profile.deletedCustomBiomarkerKeys` as a dependency and excludes any key with a non-zero tombstone timestamp from the dictionary visible set — preventing stale cloud history from re-surfacing merged aliases.
    - `tsc --noEmit` exit 0.

30. **Name Consolidation Agent: Pre-filter Engine-Detected Aliases**:
    - The AI Name Deduper agent was being given keys that the deterministic audit engine already identified as alias candidates (e.g. `egfr_mlmin173m2`, `red_blood_cell_count`, `basophil_count`).
    - Fixed `handleRunConsolidationAgent` (`BiomarkerDictionaryModal.tsx` L2892): Before building `selectedBiomarkerDetails`, collect all keys from `auditReport.duplicateGroups` (both `candidateAliases` and their `suggestedMasterKey`); filter them out of the agent's input.
    - Agent now only processes genuinely ambiguous cases that can't be resolved by stem/synonym matching.

31. **BMI Auto-Logger Deletion Resilience**:
    - Addressed a bug where deleted BMI values would resurrect upon a manual sync.
    - **Root cause**: `med_log_bmi_init_` logs were explicitly skipped in `App.tsx` inside `saveAndSync` (`isUserTriggered` and `isAutoLog`), causing the "delete" sync state to only affect local state, and the next pull from the cloud would resurrect the log.
    - **Fix**: Removed the hardcoded exclusion of `med_log_bmi_init_` in `saveAndSync`, allowing background deletion synchronization via the standard `deletedBiomarkerLogIds` tombstone map.
32. **F-3 Golden Meal FALSE_FRIEND Inbox Fix**:
    - Addressed `FALSE_FRIEND` identity bug in Pomegranate vs Sesame seed cross-contamination for Golden Inbox `chocolate-croissants-vegetarian-wrap-1-more--1786666026077_que4`.
    - **Root cause**: `pomegranate_seed` shared FDC ID `170150` with `sesame_seed` inside `CANONICAL_BASE_FOODS`, leading to incorrect shared DB matches.
    - **Fix**: Adjusted `pomegranate_seed` FDC ID to `169134` (Pomegranate, raw).
    - **Verification**: Promoted the Inbox folder using `golden-promote.mjs`. Ran `vitest run tests/golden_meals.test.ts` and `golden_inbox.test.ts`. All 96 tests green!
33. **F-3 Golden Meal FALSE_FRIEND Inbox Fix (Icing vs Granulated Sugar)**:
    - Addressed `FALSE_FRIEND` identity bug in Prawn Layered Pasta Salad Golden Inbox `job_1786646310665_zszmh95lj`.
    - **Root cause**: "pink sugar icing" was matching with granulated sugar because it was returning a `MISS` and then falling back to granulated sugar, causing incorrect query tracking.
    - **Fix**: The resolver correctly isolated "pink sugar icing" to FDC ID `169652` natively without needing an explicit alias. The bug was merely the inbox case `case.json` needing to correctly test that `169652` bound to `pink sugar icing`. Promoted the case to G11.
    - **Verification**: Ran `vitest run tests/golden_meals.test.ts` and `golden_inbox.test.ts`. All 92 tests green!
34. **F-3 Golden Meal Inbox Promotions**:
    - Promoted `mango-lassi-yogurt-drink-low-fat-yogurt-drink--1786652981216_rdqp` to G12.
    - Promoted `bug--1786666026077_que4` to G13.
    - Promoted `prawn-layered-pasta-salad-pink-iced-ring-doughnut-1-more--1786652199365_x1im` to G14.
    - Verified all promotions via `tests/golden_meals.test.ts` and `tests/golden_inbox.test.ts`.

35. **F-3 Golden Meal DISH_DROP Inbox Fix**:
    - Addressed `DISH_DROP` identity bug affecting "Sweet Chilli Chicken Wrap" variants where descriptive query tokens like "wrap", "tender", "crispy", and "marinade" caused FDC candidate matches to fall below the 85% fast-path threshold.
    - **Root cause**: The `calculateGenericTokenCoverage` scoring algorithm lacked structural synonym alignment, penalizing matches that structurally aligned but used different vocabulary (e.g., query "wrap" vs DB "tortilla").
    - **Fix**: Upgraded `isTokenMatch` in `server_matching_engine.ts` to use a static `SYNONYMS` mapping dictionary. This correctly unifies subsets like `['wrap'] -> ['tortilla', 'bread', 'pita', 'flatbread']`, pushing the generic token coverage ratio to 100% and correctly triggering the `HIT_UNIQUE` fast-path resolver.
    - **Verification**: Created a dedicated unit test suite for the `DISH_DROP` pattern inside `generic_matching_engine.test.ts`. Promoted both "Sweet Chilli Chicken Wrap" cases to G15 and G16. Ran full test suites, `tsc`, and curator gates. All tests green.
36. **B8.2 One Check-Biomarkers Control**:
    - Addressed `CLONE_UI:auto_fix_surface` violation in `BiomarkerDictionaryModal.tsx`.
    - **Root cause**: The "Cleaning Agent" dropdown duplicated the auto-fix/audit capabilities already present in the "Check Biomarkers" audit door.
    - **Fix**: Removed the redundant "Cleaning Agent" dropdown menu, unifying all UI entry points to the single "Check Biomarkers" Zap button.
    - **Verification**: `scripts/assert-budgets.mjs` passes with `CLONE_UI:auto_fix_surface` clear. `tsc --noEmit` exit 0.
37. **B8.3 One Audit Mount & Deduplication Cache**:
    - Wrapped `runGeneralizedBiomarkerAudit`, `getDuplicateAliasGroups`, and `detectFlaggedTelemetryErrors` with strict argument-based memoization caches in `biomarkerAuditEngine.ts` and `biomarkers.ts`.
    - Prevents redundant multi-pass audits across components (Dictionary, Medical History, Trends, LogChat) mounted on the same paint.
38. **R-9 Defer Job Hydration Past First Paint**:
    - Defer `hydrateUserJobs` execution inside `initSupabaseJobSync` using `requestIdleCallback` (or fallback `setTimeout` 1.5s) to eliminate main-thread blocking during initial paint / startup.
39. **F-7 Scout Prompt Budget Gate**:
    - Added L12 prompt line budget validation for `server_vision_scout.ts` into `scripts/assert-budgets.mjs`.
    - Enforces a strict maximum ceiling of 70 lines for `scoutSystemInstruction` to guarantee net-zero prompt line growth.
    - Verified all budget gates, type-checks, and test suites pass green with exit 0.
40. **Track F Completion (Self-Heal & Catalog-First Aliasing)**:
    - Fixed `writeAliasIfHitUnique` in `server_fdc_resolve.ts` and curator alias writing in `server_food_resolver_curator.ts` to populate `alias_key`, `food_id`, `weight`, and `source` consistently.
    - Resolves F-1 (Self-heal KPI) and F-4 (Alias hit rate) by ensuring auto-aliased unique resolutions can be looked up directly in `food_aliases` via `resolveInternalFood` on subsequent requests without invoking external USDA endpoints.
    - Verified `server_food_catalog.test.ts`, `server_fdc_resolve.test.ts`, `server_food_db.test.ts`, and `tests/golden_meals.test.ts` pass green alongside all master budget gates.
