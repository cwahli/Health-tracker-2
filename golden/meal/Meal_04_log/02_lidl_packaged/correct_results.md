# Correct results — Lidl chicken bites + chocolate muffin (brand packaged)

## Status
**DRAFT** — macros seeded from `prototype/meallog/runner.ts` groundTruth for proto `02`.
Expand with full OCR locks + 32-key nutrients from elastic/OCR benches before promoting to FINAL.

## Meal totals (seed)
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

## Must-pass gates
- Model: gemini-3.5-flash-lite
- Identity of visible dishes (no phantom)
- Macro band vs seed (calories within contract used by runner)
- Label lock when nutrition panel visible (case 08)
