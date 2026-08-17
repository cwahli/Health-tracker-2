# Layer-1 EMIS ingest fix — apply on GitHub via AI Studio

Replace these files in the Health-tracker-2 tree (same paths):

- `src/utils/biomarkerLifecycle.ts`
- `src/utils/biomarkerLifecycle.test.ts`
- `src/utils/biomarkers.ts`
- `tests/golden_biomarker.test.ts`
- `server.ts`
- `serverJobs.ts`

## What this does

NHS/EMIS Web pastes are **one quoted CSV line** (space between records, not newlines). The old lexer saw 1 row / 399 columns and skipped pre-processing, so Lab Parser got the full 11k blob and the UI table was empty.

Now:

1. Split `"DD-Mon-YYYY"` concatenated records into rows.
2. Map known print names; parse `143 mmol/L` into value + unit; attach the row date.
3. High-confidence SI rows are staged (no LLM). Unit mismatches go to Review. Unknown / qualitative names go to Parser as a **small leftover table only**.
4. The parser card always gets Layer-1 `extractedData` merged in, so the table is not empty.

On `debug-job_medical_1786926900885` this yields ~84 high-confidence, ~14 flagged, ~29 leftover (STI/HIV/GPPAQ…), 12 panel skips. Parser no longer sees Serum sodium / HbA1c / creatinine.

## Verify

```bash
npx tsc --noEmit
node scripts/assert-biomarker-lifecycle-m31.mjs
node scripts/assert-biomarker-ingest.mjs
npx vitest run src/utils/biomarkerLifecycle.test.ts tests/golden_biomarker.test.ts
```
