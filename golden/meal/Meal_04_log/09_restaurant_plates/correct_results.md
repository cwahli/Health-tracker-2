# Correct results — Steak + fish & chips plates

## Status
**DRAFT** — frozen 8-macro GT from `prototype/meallog/runner.ts` proto `09`.
Multi-image restaurant plates. Not FINAL: batter/butter fat is estimated and
under-called in every prototype run; no 32-key ledger.

Do not invent macros: everything below is copied from the prototype sources listed.

## Frozen GT (runner `09`, also elastic GT)
```json
{
  "weight": 1135,
  "calories": 1340,
  "protein": 78.0,
  "carbs": 102.0,
  "fat": 67.0,
  "satFat": 16.0,
  "fibre": 10.0,
  "sodium": 1850
}
```

## Best available prototype analysis

### Elastic benchmark (`final_elastic_benchmark_results.json`, caseId 9, DELEGATE)
- Pred: weight 1100g, cal 1420, P 75.5, C 134, F 63, Na 1690.
- Acc vs GT: W 96.9% / cal 94.0% / P 96.8% / C 68.6% / F 94.0% / Na 91.4%.
- Best fat call in the suite for this plate (94%), but carbs over-called.

### Scout single-agent (`BENCHMARK_PERFORMANCE_SUMMARY.md` §1, Case 9)
- W 95.2% / cal 82.8% / P 92.7% / F 60.4% / Na 94.3%.
- Below-90%: cal, fat — §2 root cause: fish batter oil absorption +
  sizzling butter/oil base estimated lean.

### Live HTTP bench (`/workspace/gemini38-meal-review/cases/CASE_09.log`, gemini-3.5-flash-lite)
- Contract PASS with fat ⚠️. 3 items: Beef Steak w/ Gravy+Veg ~450g 520kcal;
  Fish and Chips ~400g 505kcal; Iced Tea ~300g 88kcal.
- Computed: 1113kcal (−16.9%), P 84 (+7.7%), C 112 (+9.8%), F 36.4 (−45.7%).
- Latency 11.7s. Single turn, no portionClarify.

### OCR / label lock
- None — restaurant plates + drink. All macros are estimates
  (`source: estimate`). Known gap class: hidden commercial cooking fat.

### Math note
- `meal_nutrient_calculator.ts` derives calories (4/4/9), unsaturatedFat,
  salt (Na×2.5/1000) in TS. Agent emits estimates; TS owns kcal.

## Must-pass gates
- Model: gemini-3.5-flash-lite
- Identity: steak plate + fish&chips plate + iced tea across both photos
  (no phantom, no dropped plate)
- Macros inside runner bands vs frozen GT above; fat under-call is a known,
  documented gap (F-10.6 TS critic), not a silent pass

## Sources
- `prototype/meallog/runner.ts` `benchmarkCases["09"]`
- `prototype/meallog/meal/final_elastic_benchmark_results.json` (caseId 9)
- `prototype/meallog/meal/BENCHMARK_PERFORMANCE_SUMMARY.md` §1–§2
- `/workspace/gemini38-meal-review/cases/CASE_09.log`
