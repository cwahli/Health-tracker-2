# Correct results — Mie Gacoan — menu/receipt as meal LOG

## Status
**DRAFT** — macros seeded from `prototype/meallog/runner.ts` groundTruth for proto `06`.
Expand with full OCR locks + 32-key nutrients from elastic/OCR benches before promoting to FINAL.

## Meal totals (seed)
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

## Must-pass gates
- Model: gemini-3.5-flash-lite
- Identity of visible dishes (no phantom)
- Macro band vs seed (calories within contract used by runner)
- Label lock when nutrition panel visible (case 08)
