# Correct results — YOLK chicken sandwich & sides (branded restaurant plate)

## Status
**DRAFT** — frozen 8-macro GT from `prototype/meallog/runner.ts` proto `01`.
Not FINAL: no verified 32-key (`NUTRIENT_KEYS`) ledger, no nutrition-label lock
(branded plate, no panel). Promote only with weighed/label-derived 32-key ledger.

Do not invent macros: everything below is copied from the prototype sources listed.

## Frozen GT (runner `01`, also elastic GT)
```json
{
  "weight": 600,
  "calories": 950,
  "protein": 49.0,
  "carbs": 92.0,
  "fat": 42.0,
  "satFat": 8.5,
  "fibre": 11.5,
  "sodium": 1250
}
```

## Best available prototype analysis

### Elastic benchmark (`prototype/meallog/meal/final_elastic_benchmark_results.json`, caseId 1, DELEGATE)
- Pred: weight 670g, cal 755, P 44.7, C 84, F 27.7, Na 1120.
- Acc vs GT: W 88.3% / cal 79.5% / P 91.2% / C 91.3% / F 66.0% / Na 89.6%.
- Read: protein/carbs track; fat under-called (hidden commercial cooking fat).

### Scout single-agent (`prototype/meallog/meal/BENCHMARK_PERFORMANCE_SUMMARY.md` §1, Case 1)
- W 95.0% / cal 94.3% / P 96.9% / F 70.2% / Na 81.6%.
- Below-90%: fat, sodium — §2 root cause: restaurant roast oils/batter
  estimated lean; sodium invisible. TS `diningEnvironment × cookingMethod`
  critic territory (F-10.6), not a second LLM by default.

### Live HTTP bench (`/workspace/gemini38-meal-review/cases/CASE_01.log`, gemini-3.5-flash-lite)
- PASS (contract + runner ±35% kcal / ±40% macro bands).
- 3 items: Chicken Sandwich Halves ~300g 360kcal; Roasted Broccoli+Cabbage
  ~180g 118kcal; Roasted Baby Potatoes ~200g 236kcal.
- Computed: 714kcal (−24.8%), P 35.9 (−26.7%), C 85 (−7.6%), F 25.5 (−39.3%).
- Latency 6.0s, scout tokens 5494. Single turn, no portionClarify.

### OCR / label lock
- None — branded restaurant plate. Identity is visual only; fats/sodium are
  estimates, never `label_lock`.

### Math note
- `meal_nutrient_calculator.ts` derives calories (4/4/9), unsaturatedFat,
  salt (Na×2.5/1000) in TS. Agent emits estimates; TS owns kcal.

## Must-pass gates
- Model: gemini-3.5-flash-lite
- Identity of visible dishes (no phantom)
- Calories/macros inside runner tolerance bands vs frozen GT above
- Restaurant fat/Na gaps go to F-10.6 TS multipliers, not invented precision

## Sources
- `prototype/meallog/runner.ts` `benchmarkCases["01"]`
- `prototype/meallog/meal/final_elastic_benchmark_results.json` (caseId 1)
- `prototype/meallog/meal/BENCHMARK_PERFORMANCE_SUMMARY.md` §1–§2
- `/workspace/gemini38-meal-review/cases/CASE_01.log` + `CASE_01.json`
