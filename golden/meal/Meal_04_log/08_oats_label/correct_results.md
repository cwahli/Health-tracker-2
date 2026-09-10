# Correct results — Sunrise Rolled Oats — nutrition label + portion clarify

## Status
**DRAFT (label-locked, 8 macros)** — frozen 8-macro GT from
`prototype/meallog/runner.ts` proto `08`. Label panel is legible and the flow
is a 2-turn portion-clarify/edit (Turn 1 `portion_clarify`, Turn 2 confirmed
grams). Still not FINAL: no transcribed per-100g `lockedLabelTruth` table or
verified 32-key ledger in this repo.

Do not invent macros: everything below is copied from the prototype sources listed.

## Frozen GT (runner `08`, also elastic GT)
```json
{
  "weight": 220,
  "calories": 212,
  "protein": 5.0,
  "carbs": 35.0,
  "fat": 5.8,
  "satFat": 0.8,
  "fibre": 5.0,
  "sodium": 0
}
```

## Best available prototype analysis

### Elastic benchmark (`final_elastic_benchmark_results.json`, caseId 8, COMPLETE)
- Pred: weight 260g, cal 240, P 6, C 42, F 7, Na 0.
- Acc vs GT: W 81.8% / cal 86.8% / P 80% / C 80% / F 79.3% / Na 100%.

### Scout single-agent (`BENCHMARK_PERFORMANCE_SUMMARY.md` §1, Case 8)
- ALL ≥ 90% — W 97.7% / cal 90.6% / P 90.0% / F 91.4% / Na 100%.
  "Perfect Single-Dish OCR": direct label read, minimal cooking transform.

### Live HTTP bench (gemini-3.5-flash-lite)
- `CASE_08.log` (pre-fix): FAIL — Turn 1 scouted Rolled Oats Porridge ~60g
  then Turn 2 dropped `scoutItems` → 0 items / 0 kcal. Harness bug, not model.
- `CASE_08_rerun.log` (post-fix: Turn 2 inherits
  `portionClarify.scoutItems`, `portionChoices` by `scoutIndex`, images
  attached): PASS — Turn 1 portionClarify
  ("Label is per 100g — pick a portion so we don't guess"), Turn 2
  Rolled Oats ~45g 180kcal.
- Computed: 180kcal (−15.1%), P 4.5 (−10%), C 31.5 (−10%), F 5.3 (−8.6%).
- Latency 7.4s. 2-turn edit path is REQUIRED for this case.
- `CASE_08_probe_keys.json`: Turn 1 `mode: portion_clarify`,
  `scoutItems_len: 1`.

### OCR / label lock
- Back-of-pack Nutrition Facts per-100g + serving size per
  `test_ocr_cases.ts` (Case 8) and `audit_ocr_failures.ts` (Case 8).
  This is the suite's label-lock case: per-100g values lock, portion grams
  come from the clarify turn. Until the panel is transcribed into
  `lockedLabelTruth`, `expected.json` keeps `source: label_lock` as intent,
  macros as frozen GT.

### Math note
- `meal_nutrient_calculator.ts` derives calories (4/4/9), unsaturatedFat,
  salt (Na×2.5/1000) in TS. Agent emits estimates; TS owns kcal.

## Must-pass gates
- Model: gemini-3.5-flash-lite
- Turn 1 must fire `portionClarify` (label per 100g); Turn 2 must preserve
  scout items and return the confirmed portion (regression: CASE_08 0-kcal bug)
- Macros inside runner bands vs frozen GT above
- Future: transcribe panel → `lockedLabelTruth` + full 32-key ledger → FINAL

## Sources
- `prototype/meallog/runner.ts` `benchmarkCases["08"]`
- `prototype/meallog/meal/final_elastic_benchmark_results.json` (caseId 8)
- `prototype/meallog/meal/BENCHMARK_PERFORMANCE_SUMMARY.md` §1
- `/workspace/gemini38-meal-review/cases/CASE_08.log`,
  `CASE_08_rerun.log`, `CASE_08_probe_keys.json`, `SUMMARY.md`
