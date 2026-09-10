# Correct results — Seafood prep + Mr Oat rolled oats (brackets)

## Status
**DRAFT** — macros seeded from `prototype/meallog/runner.ts` groundTruth for proto `11`.
Expand with full OCR locks + 32-key nutrients from elastic/OCR benches before promoting to FINAL.

## Meal totals (seed)
```json
{
  "weight": 700,
  "calories": 900,
  "protein": 55,
  "carbs": 80,
  "fat": 30,
  "satFat": null,
  "fibre": null,
  "sodium": null
}
```

## Must-pass gates
- Model: gemini-3.5-flash-lite
- Identity of visible dishes (no phantom)
- Macro band vs seed (calories within contract used by runner)
- Label lock when nutrition panel visible (case 08)
