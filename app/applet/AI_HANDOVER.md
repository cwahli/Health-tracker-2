# AI Handover & WIP Board

## Current Status
- **Bug Fix (USDA API Robustness)**: Fixed an issue where the USDA API occasionally returned HTML maintenance pages instead of JSON, which caused the food catalog to fail matching raw ingredients. Added content-type validation and retry logic in `server.ts`.
- **Bug Fix (Trial Balance Ledger)**: Updated `extractLedgerBooks` in `src/utils/goldenLedger.ts` to prioritize printed label calories (`rawNutritionLabel.calories`) when summing Scout opening calories, preventing trial balance drift when OCR labels are attached.
- **Verification**: `npx tsc --noEmit` (0 errors) and `npx vitest run --exclude tests/golden_inbox.test.ts` (73 test files, 688 tests) pass cleanly.

