# AI Handover & Session Progress Board

**Updated:** 2026-08-16
**Status:** ALL GATES & REGRESSION SUITES GREEN
**Governance & Laws:** Follow `docs/agent/` domain rules and ship code via AI Studio only.

---
## Current Status & Verification
- **`scripts/assert-biomarker-ingest.mjs`**: Exit 0 (N1–N13 Master Ingest Assertions Passed)
- **`scripts/assert-biomarker-lifecycle-m31.mjs`**: Exit 0 (P0–P8 Master Biomarker Lifecycle Assertions Passed)
- **Vitest Suite**: 551 passed tests across 61 test files, including `tests/golden_biomarker.test.ts`, `src/utils/biomarkerIdentity.test.ts`, and `src/utils/biomarkerLifecycle.test.ts`.
- **TypeScript Compilation**: `npx tsc --noEmit` clean exit 0

---
## Summary of Accomplishments in Track B & Biomarker Pipeline
1. **Specimen False Friend Guard (G-B4)**: Integrated urine vs serum specimen separation preventing cross-mapping between `urine_albumin`, `microalbumin_urine`, and `serum_albumin`.
2. **Master Ingest Gate (N1–N13)**: Fully established and verified in `scripts/assert-biomarker-ingest.mjs` covering trace definitions, locked conversion outputs, lexer exports (`lexTable`, `buildIngestBatch`), table abort guard (`shouldAbortTablePath`), `sourceReportId` deduplication, and Inbox domain tab grouping.
3. **Outer Regression Test Cases**: Verified G-B1 conversion harness, G-B2 EMIS/NHS printout table class counts harness, G-B6 symptom diary classification, G-B7 incomplete reading detection, and G-B9 vision N/A image handling in `tests/golden_biomarker.test.ts`.
4. **Food in Medical Guard (G-B5)**: Implemented the `WRONG_DOOR` class assignment and trace generation in `server.ts` and `serverJobs.ts` when a user payload contains food or non-medical information.
5. **Flagged Review & Staged Apply (Wave B5 & B6)**:
   - Modified `serverJobs.ts` to transform `flagged` trace rows from table interception into valid `modificationCommand` inputs (`update_biomarker`), mapping them to the expected review shape.
   - Refactored `App.tsx` logic to ensure all incoming biomarker modification commands pass through the `enrichReviewModificationCommands` layer automatically, successfully unifying table-ingest flagged item correction with standard LLM hallucination reviews.
   - Fixed `handleLogMedical` so that `update_biomarker` can safely insert *new* rows for net-new dates generated via CSV ingest, completing the staged confirm & upsert pathway.
6. **Golden Test Harness (G-B6, G-B7, G-B9)**: Created complete test cases under `tests/Golden_biomarker/examples/` for symptom diary routing (`WRONG_DOOR`), incomplete reading detection (`COMPLETENESS`), and vision non-medical image handling (`CONFORMANCE_SHAPE`).
7. **Golden Meal Dataset Expansion (Item 1)**: Added case `G9` (Salmon Poke Bowl with Avocado) to `/tests/Golden_meal/` and updated `manifest.json` & `golden_meals.test.ts`.
8. **Biomarker Ingest v2 Extensions (Item 2)**: Added lab document metadata & header/footer regex filtering and clean string handling to `lexTable` and `buildIngestBatch` in `src/utils/biomarkerLifecycle.ts`.
9. **Modular Router Extraction (Item 4)**: Created domain router modules `server_routes_biomarkers.ts` and `server_routes_food.ts` and registered them on Express app in `server.ts`.

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
14. **Drop Legacy Dictionary Store (Item 7.8)**:
    - Deprecated `biomarker_dictionary_store` local storage access in `biomarkerStore.ts` and `biomarkers.ts` in favor of `profile.customBiomarkers`.
15. **Demographic Fingerprinting for Overlays (Item 7.5)**:
    - Implemented `recalibrateProfileOverlays` in `src/utils/biomarkerLifecycle.ts` which detects shifts in demographic fingerprints (`${ageBand}|${gender}|${ethnicity}`) and safely updates overlay references for biomarkers whose clinical reference ranges vary by demographic factors.
16. **Reference Range Source Badges (Item 7.6)**:
    - Implemented `getBiomarkerRangeSourceInfo` in `src/utils/biomarkerLifecycle.ts` and integrated it with `BiomarkerExpandedSection.tsx` to visually attribute reference range sources (Standard Clinical, Lab Specific, Demographic Calibrated, User Custom Range) with color-coded badges.

---
## Track F Food Identity Quality Progress (Items F-1, F-2, F-3, F-4)
17. **Multi-Component Dish Decomposition (Item F-3)**:
    - Added comprehensive golden tests in `tests/golden_meals.test.ts` validating clean decomposition of multi-ingredient regional dishes (e.g. Dim Sum tasting sets, Japanese Bento boxes) into distinct searchable queries without parent title pollution.
18. **Catalog-First Defaulting & Self-Heal Cache (Items F-1 & F-2)**:
    - Verified `lookupCanonicalBaseFood` in `server_food_db.ts` provides instant local/curated food resolution before external search fallbacks.
    - Verified `getCachedUSDAFood` / `setCachedUSDAFood` in-memory caching mechanism prevents redundant live network requests for previously resolved query terms.
19. **Food DB & Catalog Unit Tests (Item F-4)**:
    - Added automated unit tests in `server_food_db.test.ts` for catalog-first lookup and USDA caching, ensuring 100% test pass rate across all 61 test suites.

---
## Track R Modular Router Extraction Progress (Item R-4)
20. **Jobs Router Extraction (`server_routes_jobs.ts`)**:
    - Extracted all `/api/jobs/*` endpoints (`/upsert`, `/delete`, `/submit`, `/status`, `/debug`) into dedicated Express router module `server_routes_jobs.ts`.
    - Mounted `jobsRouter` in `server.ts`, trimming hundreds of lines from main server file while preserving all authentication, idempotency locks, R2 upload fallback routines, and debug report rendering.

---
## Next Steps
- Continue with Track R system performance monitoring and remaining infrastructure maintenance.

