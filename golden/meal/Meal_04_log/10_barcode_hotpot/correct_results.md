# Correct results — Indonesian beef hotpot — barcoded groceries

## Status
**DRAFT** — frozen 8-macro GT from `prototype/meallog/runner.ts` proto `10`.
Barcode/receipt weights lock grams; nutrients stay estimates. 2-turn
portion-clarify/edit path (same harness class as 08). Not FINAL: no 32-key
ledger.

Do not invent macros: everything below is copied from the prototype sources listed.

## Frozen GT (runner `10`, also elastic GT)
```json
{
  "weight": 825,
  "calories": 616,
  "protein": 65.2,
  "carbs": 45.9,
  "fat": 23.5,
  "satFat": 6.2,
  "fibre": 17.8,
  "sodium": 380
}
```

## Best available prototype analysis

### Elastic benchmark (`final_elastic_benchmark_results.json`, caseId 10, DELEGATE)
- Pred: weight 1076g, cal 740.8, P 78.6, C 35.5, F 33.3, Na 326.8.
- Acc vs GT: W 69.6% / cal 79.7% / P 79.4% / C 77.3% / F 58.3% / Na 86.0%.

### Scout single-agent (`BENCHMARK_PERFORMANCE_SUMMARY.md` §1, Case 10)
- W 90.3% / cal 88.8% / P 75.3% / F 89.4% / Na 97.4%.
- Below-90%: cal, protein — crowded hotpot spread; minor condiments/weights
  split across items.

### Live HTTP bench (gemini-3.5-flash-lite)
- `CASE_10.log` (pre-fix): FAIL — Turn 1 scouted Beef+Veg Soup ~800g + Telur
  Ayam Negeri ~65g, then Turn 2 dropped items → 0 kcal. Same harness bug as 08.
- `CASE_10_rerun.log` (post-fix): PASS — Turn 1 portionClarify on the soup,
  Turn 2 Hotpot Sayur dan Daging ~650g 582kcal.
- Computed: 582kcal (−5.5%), P 66.2 (+1.5%), C 29 (−36.8%), F 22.4 (−4.7%).
- Latency 11.0s. 2-turn edit path is REQUIRED for this case.

### OCR / barcode lock
- Price-sticker + barcode OCR (Hari Hari Lokasari) per `test_ocr_cases.ts`
  (Case 10) and `audit_ocr_failures.ts` (Case 10); elastic harness locks exact
  gram weights into `crossReferenceIndex`
  (`run_all_11_elastic_benchmark.ts`, `test_elastic_case10_11_combined.ts`).
  Weights locked; nutrients estimated (`source: estimate` except weighed grams).

### Math note
- `meal_nutrient_calculator.ts` derives calories (4/4/9), unsaturatedFat,
  salt (Na×2.5/1000) in TS. Agent emits estimates; TS owns kcal.

## Must-pass gates
- Model: gemini-3.5-flash-lite
- Turn 1 must fire `portionClarify`; Turn 2 must preserve scout items
  (regression: CASE_10 0-kcal bug)
- Barcode-weighed grams respected; macros inside runner bands vs frozen GT
- Future: 32-key ledger → FINAL

## Sources
- `prototype/meallog/runner.ts` `benchmarkCases["10"]`
- `prototype/meallog/meal/final_elastic_benchmark_results.json` (caseId 10)
- `prototype/meallog/meal/BENCHMARK_PERFORMANCE_SUMMARY.md` §1
- `/workspace/gemini38-meal-review/cases/CASE_10.log`, `CASE_10_rerun.log`
