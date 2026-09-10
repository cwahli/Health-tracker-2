# Correct results — Sunrise Rolled Oats — nutrition label + portion clarify

## Status
**DRAFT** — macros seeded from `prototype/meallog/runner.ts` groundTruth for proto `08`.
Expand with full OCR locks + 32-key nutrients from elastic/OCR benches before promoting to FINAL.

## Meal totals (seed)
```json
{
  "weight": 220,
  "calories": 212,
  "protein": 5.0,
  "carbs": 35.0,
  "fat": 5.8,
  "satFat": 0.8,
  "fibre": 5.0,
  "sodium": 0
}
```

## Must-pass gates
- Model: gemini-3.5-flash-lite
- Identity of visible dishes (no phantom)
- Macro band vs seed (calories within contract used by runner)
- Label lock when nutrition panel visible (case 08)
