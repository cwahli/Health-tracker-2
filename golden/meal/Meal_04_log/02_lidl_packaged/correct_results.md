# Correct results — Lidl chicken bites + chocolate muffin (brand packaged)

## Status
**DRAFT (strong)** — frozen 8-macro GT from `prototype/meallog/runner.ts` proto `02`.
Strongest 8-macro agreement in the suite, but still not FINAL: no verified
32-key (`NUTRIENT_KEYS`) ledger and no transcribed per-100g `lockedLabelTruth`
in this repo. Promote only with a label-locked 32-key ledger.

Do not invent macros: everything below is copied from the prototype sources listed.

## Frozen GT (runner `02`, also elastic GT)
```json
{
  "weight": 195,
  "calories": 557,
  "protein": 21.7,
  "carbs": 58.0,
  "fat": 26.5,
  "satFat": 7.5,
  "fibre": 3.0,
  "sodium": 628
}
```

## Best available prototype analysis

### Elastic benchmark (`final_elastic_benchmark_results.json`, caseId 2, COMPLETE)
- Pred: weight 195g, cal 594, P 21.7, C 60.98, F 29.5, Na 728.
- Acc vs GT: W 100% / cal 93.4% / P 100% / C 94.9% / F 88.7% / Na 84.1%.

### Scout single-agent (`BENCHMARK_PERFORMANCE_SUMMARY.md` §1, Case 2)
- ALL ≥ 90% — W 100% / cal 100% / P 100% / F 100% / Na 96.8%.
  "Perfect Packaged Match": standardized brand pack, minimal cooking transform.
- 1-vs-2 comparison (`comparison_1_vs_2_results.json`, caseId 2, a1):
  539kcal / P 21.7 / C 57.9 / F 24.5 / Na 608
  (96.8 / 100 / 92.5 / 96.8%) — single agent ≥ two-agent here.

### Live HTTP bench (`/workspace/gemini38-meal-review/cases/CASE_02.log`, gemini-3.5-flash-lite)
- PASS. 2 items: Double Chocolate Muffin ~120g 417kcal;
  Southern Fried Style Minced Chicken Breast Bites ~85g 154kcal.
- Computed: 571kcal (+2.5%), P 20.7 (−4.6%), C 61 (+5.2%), F 27 (+1.9%).
- Latency 6.3s. Single turn, no portionClarify.

### OCR / label lock
- Brand packaging legible (Lidl chicken bites + chocolate muffin); OCR focus
  per `test_ocr_cases.ts` is brand/pack text, not a transcribed per-100g table.
  Treat macros as high-confidence estimates, not `label_lock`, until the panel
  is transcribed into `lockedLabelTruth`.

### Math note
- `meal_nutrient_calculator.ts` derives calories (4/4/9), unsaturatedFat,
  salt (Na×2.5/1000) in TS. Agent emits estimates; TS owns kcal.

## Must-pass gates
- Model: gemini-3.5-flash-lite
- Identity: exactly the 2 packaged items (no phantom sides)
- Macros inside runner bands vs frozen GT above
- Any future label panel transcription must land in `lockedLabelTruth` + `source: label_lock`

## Sources
- `prototype/meallog/runner.ts` `benchmarkCases["02"]`
- `prototype/meallog/meal/final_elastic_benchmark_results.json` (caseId 2)
- `prototype/meallog/meal/BENCHMARK_PERFORMANCE_SUMMARY.md` §1
- `prototype/meallog/meal/comparison_1_vs_2_results.json` (caseId 2)
- `/workspace/gemini38-meal-review/cases/CASE_02.log`
