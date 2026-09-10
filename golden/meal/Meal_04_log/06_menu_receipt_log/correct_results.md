# Correct results — Mie Gacoan — menu/receipt as meal LOG

## Status
**DRAFT** — frozen 8-macro GT from `prototype/meallog/runner.ts` proto `06`.
Mode A log of an Indonesian noodle meal (menu pages as input), not a Mode D
compare. Not FINAL: no weighed 32-key ledger; noodle oil/fried-wonton fat and
commercial salt are estimates.

Do not invent macros: everything below is copied from the prototype sources listed.

## Frozen GT (runner `06`, also elastic GT)
```json
{
  "weight": 570,
  "calories": 780,
  "protein": 27.0,
  "carbs": 111.0,
  "fat": 25.0,
  "satFat": 5.0,
  "fibre": 4.0,
  "sodium": 1250
}
```

## Best available prototype analysis

### Elastic benchmark (`final_elastic_benchmark_results.json`, caseId 6, COMPLETE)
- Pred: weight 690g, cal 950, P 27, C 140, F 31.5, Na 1385.
- Acc vs GT: W 78.9% / cal 78.2% / P 100% / C 73.9% / F 74% / Na 89.2%.

### Scout single-agent (`BENCHMARK_PERFORMANCE_SUMMARY.md` §1, Case 6)
- W 87.7% / cal 89.5% / P 94.4% / F 74.8% / Na 86.0%.
- Below-90%: cal, fat, sodium — §2 root cause: fried wontons / noodle oil
  estimated lean; commercial salt under-called.

### Live HTTP bench (`/workspace/gemini38-meal-review/cases/CASE_06.log`, gemini-3.5-flash-lite)
- PASS. 3 items: Mie Suit ~220g 328kcal; Siomay ~120g 197kcal;
  Es Petak Umpet ~350g 145kcal.
- Computed: 670kcal (−14.1%), P 22.5 (−16.7%), C 98 (−11.7%), F 20.8 (−16.8%).
- Latency 5.2s. Single turn, no portionClarify.

### OCR / receipt
- Indonesian menu item + price OCR per `test_ocr_cases.ts`
  ("Mie Suit", "Siomay", "Es Petak Umpet") and `audit_ocr_failures.ts` Case 6.
  Menu text identifies dishes; it does not lock nutrients — all macros stay
  estimates (`source: estimate`).

### Math note
- `meal_nutrient_calculator.ts` derives calories (4/4/9), unsaturatedFat,
  salt (Na×2.5/1000) in TS. Agent emits estimates; TS owns kcal.

## Must-pass gates
- Model: gemini-3.5-flash-lite
- Identity: Mie Suit + Siomay + Es Petak Umpet (no phantom, no compare groups)
- Macros inside runner bands vs frozen GT above
- Must not be scored as Mode D compare output

## Sources
- `prototype/meallog/runner.ts` `benchmarkCases["06"]`
- `prototype/meallog/meal/final_elastic_benchmark_results.json` (caseId 6)
- `prototype/meallog/meal/BENCHMARK_PERFORMANCE_SUMMARY.md` §1–§2
- `prototype/meallog/meal/test_ocr_cases.ts` (Case 6 focus)
- `/workspace/gemini38-meal-review/cases/CASE_06.log`
