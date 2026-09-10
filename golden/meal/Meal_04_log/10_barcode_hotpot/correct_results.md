# Correct results — Indonesian beef hotpot — barcoded groceries

## Status
**DRAFT** — macros seeded from `prototype/meallog/runner.ts` groundTruth for proto `10`.
Expand with full OCR locks + 32-key nutrients from elastic/OCR benches before promoting to FINAL.

## Meal totals (seed)
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

## Must-pass gates
- Model: gemini-3.5-flash-lite
- Identity of visible dishes (no phantom)
- Macro band vs seed (calories within contract used by runner)
- Label lock when nutrition panel visible (case 08)
