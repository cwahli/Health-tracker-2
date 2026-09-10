# Correct results — Seafood prep + Mr Oat rolled oats (brackets)

## Status
**DRAFT (approximate GT)** — GT below is the runner's explicitly approximate
`benchmarkCases["11"]` value ("Approximate GT — used for portion defaults /
band checks; refine later if needed"). The elastic file carries a DIFFERENT
GT for the same plate (recorded below). Do not treat either as clinical truth.
FINAL requires a refined weigh + 32-key ledger.

Do not invent macros: everything below is copied from the prototype sources listed.

## Frozen GT — runner `11` (APPROXIMATE, portion-default grade)
```json
{
  "weight": 700,
  "calories": 900,
  "protein": 55.0,
  "carbs": 80.0,
  "fat": 30.0,
  "satFat": 8.0,
  "fibre": 10.0,
  "sodium": 1200
}
```
Note: the scaffold `expected.json` previously omitted satFat/fibre/sodium
(null). Values above restore the runner's approximate GT — they are
placeholders for band checks, not measured truth.

## Conflicting GT — elastic file (`final_elastic_benchmark_results.json`, caseId 11)
```json
{
  "weightGrams": 892,
  "calories": 822,
  "protein": 95.1,
  "carbohydrates": 69,
  "totalFat": 20.8,
  "sodium": 473
}
```
Keep both on record. Do not average or merge them.

## Best available prototype analysis

### Elastic benchmark (caseId 11, DELEGATE, GT = elastic GT above)
- Pred: weight 942g, cal 817.46, P 97.5, C 66.27, F 21.55, Na 572.
- Acc vs elastic GT: W 94.4% / cal 99.4% / P 97.5% / C 96.0% / F 96.4% /
  Na 79.1%. High vs its own GT; that GT disagrees with the runner approx.

### Scout single-agent (`BENCHMARK_PERFORMANCE_SUMMARY.md` §1, Case 11)
- W 96.6% / cal 93.7% / P 98.0% / F 81.2% / Na 97.7%.
- Below-90%: fat only.

### Live HTTP bench (`CASE_11_rerun.log`, gemini-3.5-flash-lite)
- PASS (contract). Bracket edit applied: user prompt
  "I had [Mr Oat Rolled Oats 70g] and all food in the pictures".
- 2 items: Seafood and Vegetable Hotpot Prep ~657g 429kcal;
  Mr Oat Rolled Oats ~70g 294kcal.
- Computed vs RUNNER approx GT: 723kcal (−19.7%), P 83.1 (+51.1% ⚠️),
  C 68 (−15.0%), F 12.9 (−57.0% ⚠️). Protein/fat deltas reflect the GT
  conflict, not just model error.
- Latency 5.2s. Bracket-text edit path is REQUIRED for this case.

### OCR / receipt
- Thermal receipt OCR + raw seafood ingredient photo + Mr Oat pack per
  `test_ocr_cases.ts` (Case 11) and `audit_ocr_failures.ts` (Case 11);
  elastic harness locks receipt grams into `crossReferenceIndex`
  (`test_elastic_case11.ts`). Receipt grams locked; nutrients estimated.

### Math note
- `meal_nutrient_calculator.ts` derives calories (4/4/9), unsaturatedFat,
  salt (Na×2.5/1000) in TS. Agent emits estimates; TS owns kcal.

## Must-pass gates
- Model: gemini-3.5-flash-lite
- Identity: hotpot prep + Mr Oat oats (bracket grams honored, no phantom)
- Bracket-text edit path exercised
- Verdict must cite the GT conflict; never silently pass protein/fat against
  one GT while the other disagrees

## Sources
- `prototype/meallog/runner.ts` `benchmarkCases["11"]` (approximate)
- `prototype/meallog/meal/final_elastic_benchmark_results.json` (caseId 11)
- `prototype/meallog/meal/BENCHMARK_PERFORMANCE_SUMMARY.md` §1
- `/workspace/gemini38-meal-review/cases/CASE_11_rerun.log`, `SUMMARY.md`
