# AI Handover & Session Progress Board

**Updated:** 2026-08-17
**Status:** ALL GATES & REGRESSION SUITES GREEN (562 tests across 61 test suites)
**Governance & Laws:** Follow `docs/agent/` domain rules and ship code via AI Studio only.

---
## Current Status & Verification
- **`scripts/assert-biomarker-ingest.mjs`**: Exit 0 (N1–N13 Master Ingest Assertions Passed)
- **`scripts/assert-biomarker-lifecycle-m31.mjs`**: Exit 0 (P0–P8 Master Biomarker Lifecycle Assertions Passed)
- **`scripts/assert-free-tier-complete.mjs`**: Exit 0 (M23–M28 Master Free-Tier Reliability Assertions Passed)
- **`scripts/assert-food-curator-m30.mjs`**: Exit 0 (M30 Food Curator Assertions Passed)
- **Vitest Suite**: 562 passed tests across 61 test files.
- **TypeScript Compilation**: `npx tsc --noEmit` clean exit 0
- **Supabase Cloud State**: 0 uncalibrated rows remaining in Supabase Postgres. Schema-aligned queries in `server_routes_sync.ts` verified.
- **Supabase Egress & Payload Diet**: 
  - Omitted `payload` from `/api/bug-tracker/overview` listing queries in `serverIssueBacklog.ts`.
  - Configured `serverBugSnapshot.ts` to write heavy DOM/a11y/debug blobs to R2 only, storing thin pointers in Supabase `issue_backlog`.
  - Migrated legacy `issue_backlog` rows from ~7.5 MB down to ~38 KB (99.5% reduction), capping daily egress comfortably under 5 MB/day.

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
- System in fully verified state with all master gates green.


- Pack M23 Free Tier Reliability and M31 Biomarker Lifecycle have been fully completed, verified against master gates, and safely archived. Ready to receive the chat prompt for the next active pack (M30 Food Curator).
